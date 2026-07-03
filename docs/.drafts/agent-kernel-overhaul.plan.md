---
covers: "Full implementation plan for the kernel overhaul: identity + local storage, usage tracing, prompt revisions, runtime consolidation, and PromptLab analytics."
concepts: [implementation-plan, identity, containers, sqlite, usage-tracing, pi-extension, prompt-json, prompt-revisions, runtime-consolidation, prompt-lab]
status: draft
date: 2026-07-01
depends-on: [agent-kernel-platform.design.md, agent-kernel-contracts.design.md, ../10-system-design/60-prompt-system-model.md]
---

# Agent Kernel Overhaul — Implementation Plan

Five phases plus a spec commit. Each phase is independently shippable and has
its own exit criteria. Phases 1 and 4 are breaking; everything else is
additive. The milestone that matters lands after Phase 3: every run in a local
SQLite file, with token counts, linked to the exact prompt revision that
produced it.

```text
Phase 0  spec commit                      1-2 days    docs only
   |
Phase 1  identity + storage               1.5-2 wk    BREAKING
   |________________________________
   |            |                   |
Phase 2         Phase 3             Phase 4
usage + emitter prompt.json +       runtime overhaul
~1 wk           revisions           2-3 wk  BREAKING
additive        0.5-1 wk additive   (4a manifest, 4b consolidation)
   |____________|
   |
Phase 5  PromptLab persistence + analytics   1-1.5 wk   additive
```

Migration posture for the whole plan: the only consumers are
`examples/simple-research-kernel` and the gc-decomp-harness reference. No
published versions exist. Breaking phases therefore migrate consumers in the
same change set and delete old paths — no compatibility shims, no dual models.

---

## Phase 0 — Spec Commit

Goal: every later phase implements a written contract, not a conversation.

Deliverables:

1. Amend the prompt-system decision log (`docs/10-system-design/60-prompt-system-model.md`):
   - Revise D2/D3: the canonical prompt artifact is the serialized
     `PromptDocument` JSON. TypeScript builders are a construction library,
     not a source format.
   - Resolve D66: the prompt UI reads and writes `prompt.json` directly.
     No codegen back into builder code, ever.
   - Add decisions: sessions-as-containers, per-kernel SQLite trace DB,
     extension-primary event emission with tailer demoted to backfill,
     prompt revisions keyed by content hash at the session level.
2. New one-page identity spec (`docs/10-system-design/15-identity-model.md`):
   the container/session/run/turn nesting, the linkage invariants (the trace
   doctor checklist below), and one worked example.
3. Doc hygiene: remove the dead `ARCHITECTURE_UPDATE.md` README links, fix the
   stale "frontmatter parsing" row in `docs/00-foundation/30-boundaries.md`,
   move `PROMPT SKILLS DESIGN SESSION.md` into `docs/.drafts/`.

Exit criteria: docs merged; no code changed.

---

## Phase 1 — Identity + Storage (BREAKING)

Goal: one grouping primitive (containers with kinds), one required identity on
every event, one local SQLite database per kernel, and an executable invariant
checker.

### Target identity model

```text
Container (kind + key, tree)          <- the only grouping primitive
  Agent session (Pi conversation)     <- promptHash, frozen system prompt
    Run (message in -> response out)  <- trigger, status, usage rollup
      Turn (one model call)           <- input/output/cache tokens
```

An app "session" is not a separate identity system. It is a container of
`kind: "session"`. Spectre sessions, melee run/epoch/claim trees, and the
research example all become container rows with different kinds.

### Envelope (packages/protocol)

Before:

```ts
interface TraceEvent {
  eventId: string;
  appSessionId: string;        // required, Spectre legacy
  containerId?: string;        // optional
  userId: string;              // required
  ...
}
```

After:

```ts
interface TraceEvent {
  eventId: string;
  containerId: string;         // required — primary grouping identity
  type: EventType;
  source: TraceSource;         // "kernel" | "app" | "agent" | open
  traceLevel: TraceLevel;
  eventData: EventData;
  agentId?: string;
  runId?: string;              // NEW — explicit run linkage on the envelope
  spanId?: string;
  parentEventId?: string;
  userId?: string;             // demoted to optional actor correlation
  timestamp: string;           // ISO 8601
  piSessionUuid?: string;      // transport-only, resolved at write time
}
```

`appSessionId` is deleted, not renamed. Host correlation happens through
container `kind` + `appKey`. `runId` is promoted onto the envelope because the
Phase 2 in-process emitter knows it at emit time — relationships are emitted,
not reconstructed.

Work: every factory in `packages/protocol/src/factories.ts` changes signature
(mechanical, large). `ui_ask_requested/answered` are removed from the core
catalog in the same pass (apps re-register them as open-string types).

### Container identity (packages/kernel)

Promote the melee bridge's stable-UUID hack into a kernel API:

```ts
// Deterministic, idempotent container identity.
const container = await kernel.container({
  kind: "epoch",                            // app-defined vocabulary
  key: [projectId, sessionId, runId, epochId],
  parent: runContainer,                     // optional parent container
  label: `Epoch ${epochId}`,
  phase: "build",
  metadata: { ... },                        // opaque to the kernel
});
// container.id === uuidv5(kernelNamespace(kernelId), `${kind}\n${key.join("\n")}`)
```

Same `(kernelId, kind, key)` always yields the same id; the call upserts.
This deletes ~400 lines of hand-rolled identity code per harness
(see `references/gc-decomp-harness/.../bridge/session-mapping.ts`).

The kernel runtime stamps `containerId` and `runId` onto every event from
`RunContext` automatically. Adapters can no longer mislabel identity.

### Schema (packages/db) — dialect-portable, SQLite default

One database file per kernel: `.agent-kernel/trace.db` (WAL mode, Bun's
built-in SQLite driver through Drizzle). Postgres remains a supported dialect
for shared planes; it stops being the default. `kernel_registrations` shrinks
to a local manifest file (`.agent-kernel/kernel.json`) — discovery of shared
watch roots is no longer needed when the DB is local.

```sql
CREATE TABLE containers (
  id                  TEXT PRIMARY KEY,       -- derived uuidv5, see above
  kernel_id           TEXT NOT NULL,
  kind                TEXT NOT NULL,          -- 'session' | 'run' | app-defined
  app_key             TEXT NOT NULL,          -- JSON array of key segments
  label               TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  parent_container_id TEXT REFERENCES containers(id),
  phase               TEXT,
  phase_vocabulary    TEXT,                   -- JSON array
  working_dir         TEXT,
  metadata            TEXT,                   -- JSON, opaque to kernel
  -- usage rollups: columns land now, populated in Phase 2
  usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cache_read    INTEGER NOT NULL DEFAULT 0,
  usage_cache_write   INTEGER NOT NULL DEFAULT 0,
  usage_cost_estimate REAL,
  created_at          TEXT NOT NULL,
  started_at          TEXT,
  ended_at            TEXT,
  UNIQUE (kernel_id, kind, app_key)
);

CREATE TABLE pi_agent_sessions (
  id                  TEXT PRIMARY KEY,
  container_id        TEXT NOT NULL REFERENCES containers(id),
  parent_session_id   TEXT REFERENCES pi_agent_sessions(id),
  parent_tool_use_id  TEXT,                   -- set when spawned by a tool call
  agent_name          TEXT NOT NULL,
  display_label       TEXT,
  model               TEXT,
  prompt_hash         TEXT,                   -- Phase 3: revision at creation
  status              TEXT NOT NULL,
  phase               TEXT,
  usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  ended_at            TEXT
);

CREATE TABLE agent_runs (
  id                  TEXT PRIMARY KEY,
  pi_session_id       TEXT NOT NULL REFERENCES pi_agent_sessions(id),
  container_id        TEXT NOT NULL REFERENCES containers(id),
  parent_run_id       TEXT REFERENCES agent_runs(id),
  parent_tool_use_id  TEXT,
  agent_name          TEXT NOT NULL,
  trigger             TEXT NOT NULL,          -- 'operator'|'parent-tool'|'steer'|'resume'|'system'
  inbound_event_id    TEXT,                   -- the message that opened the run
  outbound_event_id   TEXT,                   -- the response that closed it
  display_label       TEXT,
  phase               TEXT,
  status              TEXT NOT NULL,          -- 'running'|'done'|'error'|'aborted'|'turn-limit'
  usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cache_read    INTEGER NOT NULL DEFAULT 0,
  usage_cache_write   INTEGER NOT NULL DEFAULT 0,
  usage_cost_estimate REAL,
  started_at          TEXT NOT NULL,
  ended_at            TEXT
);

CREATE TABLE trace_events (
  event_id        TEXT PRIMARY KEY,           -- idempotent insert key
  container_id    TEXT NOT NULL,
  run_id          TEXT,
  pi_session_id   TEXT,
  agent_id        TEXT,
  user_id         TEXT,
  type            TEXT NOT NULL,              -- open string
  source          TEXT NOT NULL,              -- open string
  trace_level     INTEGER NOT NULL,
  event_data      TEXT NOT NULL,              -- JSON
  span_id         TEXT,
  parent_event_id TEXT,
  timestamp       TEXT NOT NULL
);
CREATE INDEX idx_events_container_ts ON trace_events (container_id, timestamp);
CREATE INDEX idx_events_run          ON trace_events (run_id);
```

### Trace doctor (new, small — lives in packages/kernel or a cli entry)

`bunx agent-kernel doctor <db-path>` scans one kernel DB and reports:

| # | Invariant |
|---|---|
| 1 | Every `trace_events.container_id` exists in `containers` |
| 2 | Every `agent_runs.container_id` and `.pi_session_id` resolve |
| 3 | Every child `pi_agent_sessions.parent_session_id` resolves and carries `parent_tool_use_id` |
| 4 | Every run reaches a terminal status, or its session is still active |
| 5 | Every `tool_call_start` has a matching end, or its run ended abnormally |
| 6 | Container tree has no cycles; every container has a `kind` |
| 7 | Every `trace_events.run_id` resolves to an existing run |
| 8 | (Phase 2) sum of turn usage == run rollup == session rollup == container rollup |

Wired into CI against the example kernel. This converts "I'm not confident the
linkage code is right" into a green check, after which the messy linkage code
can be refactored safely.

### Work items, in order

1. Protocol: envelope + factories + remove ask events.
2. DB: new schema, both dialects, bootstrap helper, read helpers rewritten
   container-first (no app-session fallback).
3. Kernel: `kernel.container()` derivation, RunContext auto-stamping,
   run `trigger` plumbing through spawn options.
4. Viewer-core: `buildTraceSpans` reads the new shapes (container grouping is
   already mostly explicit after the recent linkage work).
5. Trace doctor + CI wiring.
6. Migrate the example; update observability-model and db docs.

Exit criteria: `bun run dev:simple-research` runs end-to-end against a single
SQLite file with no Postgres and no Docker; doctor reports zero violations;
`bun run test` green.

Risk: the factories rewrite is wide but shallow — the danger is drift between
factory signatures and emit-site call sites. Mitigate by changing the envelope
type first and letting the type checker enumerate every call site.

---

## Phase 2 — Usage + Extension Emitter (additive)

Goal: token counts on every turn, rolled up to run/session/container; events
emitted in-process by a Pi extension every kernel ships; tailer demoted to a
backfill tool.

### Before / after

```text
BEFORE                                   AFTER
Pi session --> JSONL file                Pi session --> kernel emitter extension
                 |                          |                (knows RunContext:
            tailer daemon                   |                 containerId, runId)
            watcher/cursors/                |--> traceWriter --> SQLite
            marker binding                  |
                 |                       Pi session --> JSONL (Pi's own durable
            marker resolves                              transcript, unchanged)
            app identity                                    |
                 |                                    `agent-kernel backfill`
            Postgres                                  (crash recovery / import)
```

The marker-based session binding dance is deleted: the in-process emitter has
identity at emit time. JSONL stays as Pi's durable raw transcript and the
recovery source.

### Emitter (packages/kernel)

A Pi `ExtensionFactory` appended automatically to every session the spawn
pipeline creates:

```ts
export function createKernelEmitter(deps: {
  traceWriter: TraceWriterSink;
  runContext: () => RunContext;      // async-local accessor
}): ExtensionFactory;
```

It subscribes to the same session event stream the pipeline already uses for
streaming and turn limits, and maps to protocol events (reusing the tailer's
`EventMapper` logic, moved into the kernel): user/assistant messages, tool
call start/end, turn start/end with usage, lifecycle.

### Usage data model (packages/protocol)

```ts
interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;               // the model that actually served the turn
  costEstimate?: number;       // from kernel-config price table, when present
}
// carried on: pi_turn_end.eventData.usage
// rolled up on: agent_run_end.eventData.usage
```

Write path increments the denormalized rollup columns from Phase 1:
turn -> run -> session -> container. Doctor invariant #8 activates.

### Run boundaries

The emitter closes the run-semantics gap: a run opens when the pipeline
delivers an inbound message (recording `trigger` and `inbound_event_id`) and
closes on the final assistant response (`outbound_event_id`) or an abnormal
end. Steering messages emit a `run_steered` event (steering is currently an
unobservable control action — that violates the core principle).

### Tailer demotion (packages/tailer)

- Delete from the default story: daemon posture, health port, directory
  watcher loop, registration-row discovery.
- Keep and rename the core as `agent-kernel backfill <pi-sessions-dir> --db <path>`:
  reader + mapper + idempotent batch insert. Used for crash recovery and for
  importing sessions that ran outside the kernel.

### Viewer

Token counts appear on span cards and the detail panel (display only; the
analytics views wait for Phase 5).

Exit criteria: run the example with no tailer process; every run and container
shows real token numbers in the viewer; kill the server mid-run and
`backfill` restores the lost tail from JSONL; doctor #8 green.

---

## Phase 3 — prompt.json + Revisions (additive)

Goal: the prompt is data; every prompt state is content-addressed; every
session records which revision it ran.

### Hash flow

```text
prompt.json --canonicalize--> canonical bytes --sha256--> "pk1-<hex>"
     |                                                        |
     | registry boot / lab save                               |
     v                                                        v
prompt_revisions row  <-------- pi_agent_sessions.prompt_hash
(document + rendered text)      (stamped at session creation,
                                 system prompt is frozen there)
```

Revisions bind to sessions, not runs: the spawn pipeline freezes the system
prompt at Pi session creation, so all runs in a session share one hash.
Editing a prompt never mutates an existing session; the next session picks up
the new revision.

### Canonicalization rules (packages/prompt-kit)

- `ensurePromptNodeIds` runs before serialization — every block node has a
  stable id (this is what makes Phase 5 block-level diffs possible).
- Deterministic key order (schema-defined), no `undefined` members, sorted
  metadata keys, LF, UTF-8.
- `hash = "pk1-" + sha256(canonicalBytes)` — the `pk1` prefix versions the
  canonicalization itself, independent of `schemaVersion` inside the document.
- Ship a JSON Schema for `PromptDocument` — shared by the registry, the lab
  save endpoint, and any external tooling.

### Bundle change (packages/kernel registry + example)

```text
agent-catalog/<agent-name>/
  agent.ts        (unchanged this phase)
  prompt.json     <- canonical PromptDocument, replaces prompt.ts
  context.ts
  tools.ts
```

- Registry discovers `prompt.json` as the prompt source; validates against the
  JSON Schema and `declaredVariables`; computes the hash; upserts a
  `prompt_revisions` row (`source: "registry-boot"`).
- One-time migration script renders the three example agents' `prompt.ts`
  documents to `prompt.json`; the `prompt.ts` registry path is deleted (full
  switch, no dual support).
- Builders remain exported from prompt-kit as the programmatic way to
  construct documents (scripts, generators, tests).

### Schema addition (packages/db)

```sql
CREATE TABLE prompt_revisions (
  hash            TEXT PRIMARY KEY,      -- "pk1-<sha256>"
  agent_name      TEXT NOT NULL,
  schema_version  TEXT NOT NULL,         -- "prompt-kit/v1"
  document        TEXT NOT NULL,         -- canonical JSON
  rendered_text   TEXT NOT NULL,         -- XML-tagged Markdown at save time
  source          TEXT NOT NULL,         -- 'registry-boot'|'lab-save'|'migration'
  created_at      TEXT NOT NULL
);
```

### Reviewability

Each agent directory gains a committed, derived `prompt.rendered.md`
(generated by the renderer, enforced by a snapshot test, headed "derived — do
not edit"). PR diffs show the behavioral contract in the format the model
receives.

Exit criteria: edit `prompt.json`, rerun the example; two sessions in the same
container show different `prompt_hash` values resolving to two revision rows;
snapshot test fails if `prompt.rendered.md` is stale.

---

## Phase 4 — Runtime Overhaul (BREAKING, splittable into 4a / 4b)

Goal: the manifest is data, the runtime contract stops speaking "frontmatter",
the eight-adapter spawn bundle collapses into kernel config, and the overrides
harnesses actually need become sanctioned.

### 4a — Manifest as data + internal rename

Target bundle (end state — the UI can edit everything except the two code files):

```text
agent-catalog/<agent-name>/
  agent.json           <- manifest: data, JSON-Schema validated
  prompt.json          <- Phase 3
  prompt.rendered.md   <- derived snapshot
  context.ts           <- code sidecar, discovered by filename
  tools.ts             <- code sidecar, discovered by filename
```

```json
{
  "$schema": "agent-kernel/agent-v1",
  "name": "research-coordinator",
  "description": "Coordinates a research request through scouts and synthesis.",
  "model": "strong",
  "thinking": "low",
  "maxTurns": 12,
  "canSpawnSubagent": true,
  "coreTools": ["read"],
  "toolProfiles": ["reader"],
  "variables": {
    "researchMemoryDir": { "default": "research-memory", "description": "..." },
    "userPrompt": { "description": "Current operator request." }
  },
  "variants": {
    "cheap": { "model": "fanout", "maxTurns": 4 },
    "deep":  { "model": "strong", "thinking": "high", "maxTurns": 24 }
  }
}
```

- Registry discovers the directory by `agent.json`; `context.ts`/`tools.ts`
  attach by filename convention. `agent.ts` is deleted from the catalog
  layout. `defineAgent` survives as the typed generator/validator for these
  files (and its validation logic becomes the shared JSON Schema check).
- Internal rename: `ParsedAgent.frontmatter` -> `ParsedAgent.config`;
  `AgentFrontmatter` type retired. Touches spawn pipeline, system-prompt
  resolver, Pi session factory, registry, tests
  (`packages/kernel/src/spawn-pipeline/types.ts:32` is the anchor).

### 4b — Consolidation + sanctioned overrides

Before / after of the adapter surface:

```text
BEFORE  createSpawnAgent({          AFTER   createKernel({
  loadAgent,                          id: "melee",
  loadAgentResolver,                  db: { url: ".agent-kernel/trace.db" },
  buildPrivateRegisterFactory,        catalog: { roots: [...] },
  buildToolFactories,                 models: {
  createContextCatalog,                 aliases: { strong: "codex-lb/gpt-5.5",
  createSpawnContext,                             fanout: "codex-lb/gpt-5-mini" },
  getDb,                                prices: { ... },        // powers costEstimate
  createAppSessionBinding,            },
  logger,                             toolProfiles: {
})                                      sourceEditing: ["read","glob","grep",
+ separate createKernel()                               "bash","edit","write"],
+ separate tailer wiring              },
+ separate read-api service           loaders: [myWorkflowLoader],
                                      sharedTools: (rt) => [...],
                                      appContext: (spawn) => ({ stateManager }),
                                      concurrency: { maxBackgroundAgents: 8 },
                                    })
                                    // returns: spawnAgent, agentManager,
                                    //   container(), traceWriter,
                                    //   readApiService, doctor(), dispose()
```

Injected functions remain only for the genuinely app-shaped slots:
`appContext`, custom `loaders`, `sharedTools`. Everything else is config.

Sanctioned per-spawn overrides (kills the melee frontmatter-mutation hack):

```ts
kernel.spawnAgent("worker", prompt, {
  variant: "deep",                   // from agent.json variants
  variables: { targetId },
  container: { kind: "worker", key: [runId, epochId, claimId] },
  trigger: "parent-tool",
  parentToolUseId,
});
```

Model aliases resolve at spawn; the *resolved* model is what lands on the
session row and in turn usage — so fleet-wide retargeting is one config edit
and cost attribution stays truthful.

### Validation: the melee port

Exit criteria for the whole phase is porting
`references/gc-decomp-harness/apps/server/src/infrastructure/kernel/bridge/`
(~3,500 lines today) to the new API with a target of under ~300 lines:

| Bridge file today | Lines | Fate |
|---|---|---|
| session-mapping.ts | 397 | deleted — `kernel.container({kind,key})` |
| spawn-agent.ts | 403 | deleted — variants/aliases/profiles |
| spawn-context.ts | 544 | mostly deleted — config + appContext |
| tailer.ts | 493 | deleted — Phase 2 emitter |
| read-api.ts | 254 | mostly deleted — `readApiService` from instance |
| database.ts | 60 | deleted — local SQLite default |
| loaders.ts / workflow-trace.ts | 373 | survives — genuinely app-specific |

Whatever else refuses to shrink is either app-specific or the next promotion
candidate — either way the port answers it.

---

## Phase 5 — PromptLab Persistence + Analytics (additive)

Goal: the lab saves for real, keeps history, and shows each revision's cost —
the closed loop made visible in one panel.

### Editor transactions (packages/prompt-kit ui)

```ts
interface PromptTransaction {
  id: string;
  baseHash: string;              // revision this edit started from
  steps: PromptStep[];
  timestamp: string;
}

type PromptStep =
  | { op: "insert";  path: PromptNodePath; node: PromptBlockNode }
  | { op: "remove";  path: PromptNodePath; removed: PromptBlockNode }
  | { op: "move";    from: PromptNodePath; to: PromptNodePath }
  | { op: "update";  id: string; before: Partial<PromptBlockNode>;
                     after: Partial<PromptBlockNode> };
```

Every existing editor-model operation (insert/move/remove/update/duplicate)
becomes a step producer. Undo/redo = applying inverse steps. This is the
ProseMirror transaction *pattern* only — no rich-text library, and the inline
model stays `string | variable | reference` (no formatting marks).

### Catalog write API (new, mounted beside the read API)

```text
GET  /kernel/catalog/agents                       registry listing
GET  /kernel/catalog/agents/:name                 manifest + prompt + validation
PUT  /kernel/catalog/agents/:name/prompt          body: PromptDocument
GET  /kernel/catalog/agents/:name/revisions       history (hash, date, source)
GET  /kernel/catalog/agents/:name/revisions/:hash/stats
```

Save flow (`PUT .../prompt`):

```text
PromptDocument from lab
  -> JSON Schema + declaredVariables validation   (400 on failure)
  -> canonicalize + hash
  -> write prompt.json + regenerate prompt.rendered.md
  -> upsert prompt_revisions (source: "lab-save")
  -> respond { hash }
```

Local-dev trust model: the write API mutates catalog files on disk, so it is
enabled only when the kernel runs in dev mode; production harnesses ship
read-only catalogs.

### Revision analytics

`GET .../revisions/:hash/stats` is one join, possible only because Phases 2
and 3 landed:

```sql
SELECT count(r.id)                                   AS runs,
       sum(r.usage_input_tokens + r.usage_output_tokens) AS total_tokens,
       avg(r.usage_input_tokens + r.usage_output_tokens) AS avg_tokens,
       sum(r.usage_cost_estimate)                    AS cost,
       sum(CASE WHEN r.status IN ('error','turn-limit',"aborted")
                THEN 1 ELSE 0 END)                   AS failures
FROM agent_runs r
JOIN pi_agent_sessions s ON s.id = r.pi_session_id
WHERE s.prompt_hash = :hash;
```

### Lab UI additions (packages/viewer-ui)

- Save button on `PromptInlineLab` (dirty draft -> PUT -> new revision chip).
- Revision history panel: list of revisions with block-level diff between any
  two (stable node ids make this a tree walk: inserted / removed / moved /
  edited blocks — no text diffing).
- Per-revision stats strip in the inspector: runs, median tokens, failures,
  cost — next to the blocks being edited.

Exit criteria: edit a prompt in the lab, save, run the agent, and see the new
revision's run count and token numbers appear in the lab inspector; undo/redo
works across a save boundary; block diff between two revisions renders.

---

## Cross-Cutting

Testing strategy per phase:

- Phase 1: doctor in CI + boundary tests + typecheck as the migration net.
- Phase 2: emitter unit tests against recorded Pi event fixtures; a
  kill-and-backfill integration test.
- Phase 3: canonicalization golden tests (same document, permuted key order,
  same hash) + rendered snapshot tests.
- Phase 4: the melee port is the test.
- Phase 5: transaction inverse-property tests (apply + undo == identity);
  write-API validation tests.

Explicitly out of scope (recorded, not built): budget enforcement /
abort-on-cost (needs Phase 2 data in the wild first), outcome/verdict scoring
on runs, central observer federation (the observer read paths stay reserved;
transport becomes HTTP-per-kernel when it happens), retention/partitioning
(document the plan, don't build), Turso/libSQL remote sync (config swap
later), prompt A/B tooling.

Rough sizing: Phases 0-3 ≈ 3.5 focused weeks and deliver the closed loop.
Phase 4 ≈ 2-3 weeks, schedule by how much the decomp harness hurts.
Phase 5 ≈ 1-1.5 weeks. Total ≈ 6-8 weeks.
