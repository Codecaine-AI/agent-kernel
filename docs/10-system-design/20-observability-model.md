---
covers: "Observability model for containers, Pi agent sessions, agent runs, trace events, prompt revisions, trace blobs and request snapshots, storage, usage rollups, explicit linkage rules, transcript backfill, the read surface, and the trace doctor."
concepts: [observability, containers, pi-agent-sessions, agent-runs, trace-events, prompt-revisions, trace-blobs, request-snapshots, explicit-linkage, usage-rollups, kernel-emitter, backfill, sqlite, read-api, catalog-api, trace-doctor]
code-ref: packages/db/src/schema/, packages/db/src/actions/read-api.ts, packages/kernel/src/emitter/, packages/kernel/src/spawn-pipeline/streaming/request-snapshot.ts, packages/kernel/src/read-api.ts, packages/kernel/src/doctor.ts
depends-on: [../00-foundation/20-principles.md, 15-identity-model.md, 30-event-protocol.md]
---

# Observability Model

The kernel observability model answers a simple question: what work ran, where did it belong, who spawned it, what did it cost, and what happened inside it?

---

## Core Records

| Record | Meaning |
|---|---|
| Kernel manifest | Local JSON file (`.agent-kernel/kernel.json`) describing one kernel: id, display name, Pi sessions directory, viewer link. Replaces the old `kernel_registrations` table — with one SQLite database per kernel there is no shared plane to register with. |
| Container | The single grouping primitive. It has a deterministic id derived from `(kernelId, kind, key)`, a kind, an app key, label, status, optional parent container, phase label, phase vocabulary, working paths, metadata, and usage rollup columns. |
| Pi agent session | Pi SDK conversation identity for one agent session, including `prompt_hash` (the prompt revision frozen at session creation) and usage rollups. This is the durable link to JSONL-sourced events. |
| Agent run | One processing loop inside a Pi session: message in, response out. Carries trigger, inbound/outbound event refs, status, and usage rollups. |
| Trace event | Time-ordered event row for prompts, context, messages, tools, lifecycle, containers, phases, warnings, and errors. |
| Prompt revision | Content-addressed snapshot of one `prompt.json` (`pk1-<sha256>` hash, canonical document, rendered text, source: `registry-boot` \| `lab-save`). Sessions point at revisions through `prompt_hash`. |
| Trace blob | Content-addressed payload row (system prompts, sanitized messages, images, tool rosters) referenced by hash from request-snapshot events, so large payloads are stored once and never inlined into the event stream. |

## Storage

Storage is one local SQLite database per kernel — standard path `<root>/.agent-kernel/trace.db` — opened in WAL mode so viewer reads never block the kernel writer. The schema is created idempotently on kernel start; there is no migration tooling. Container ids are derived, never minted: the same `(kernelId, kind, key)` inputs always resolve to the same row, so apps map their domain work units to containers through kind vocabulary without the kernel learning app workflow semantics. Trace-event inserts are idempotent by event id (`INSERT OR IGNORE`), which is what lets the in-process emitter and a later JSONL backfill of the same session coexist without duplicates.

A Postgres mirror of the schema exists for shared-plane deployments — same column names, row shapes, and constraints — but the actions layer is SQLite-first; the packaging decision lives at [30-db.md](../20-implementation/30-db.md).

## Identity Layers

Identity is container-first — see [15-identity-model.md](15-identity-model.md) for the full nesting and invariants.

`containerId` is the single required grouping identity on every event. There is no separate app-session identity: an app session is a container of `kind: "session"`, and host correlation happens through container kind + app key. `kernel.container({ kind, key })` derives the same id for the same inputs every time, so apps never mint or persist their own grouping ids.

`runId` identifies a kernel-created run and lives on the envelope. The in-process emitter knows it at emit time, so it is emitted, not reconstructed.

`piSessionId` links events to the Pi session row. Live emission resolves it directly; backfill resolves the JSONL transport session id at write time.

`kernelId` identifies one kernel. It namespaces container derivation and appears in the local kernel manifest.

## Linkage Rule

If a relationship is known at emit time, write the relationship explicitly:

- every trace event carries envelope `containerId`; events inside a run carry envelope `runId`
- every run carries `containerId`, `piSessionId`, and a `trigger` (`operator`, `parent-tool`, `steer`, `resume`, or `system`)
- a run records its `inbound_event_id` when it opens and `outbound_event_id` when it closes
- a run in an app phase carries `phase`
- a subagent spawned by a tool carries `parentToolUseId`
- a nested run carries `parentRunId` when known
- a child Pi session carries `parentSessionId`

The viewer may use timestamps for ordering, but not for structural parentage when an explicit ID is available.

## Event Sources

The primary emission path is the in-process kernel emitter: an extension the spawn pipeline attaches to every Pi session it creates. It has full identity from the run context at emit time and writes through the kernel trace writer into the local database. It maps user and assistant messages, tool call start/end, and turn start/end (with `TurnUsage`) to protocol events, and marks spawner tool calls with `toolKind: "spawner"` plus their `spawns` allowlist.

Pi's JSONL transcript remains the durable raw record. The kernel's transcript-recovery module is a backfill tool over it, not a daemon: disaster rebuild after loss or corruption, importing sessions that ran outside the kernel, and re-deriving trace rows through updated event mapping. Pi JSONL starts with Pi's own session id; envelope identity — required `containerId` and optional `runId` — arrives through the session-binding marker the spawn pipeline writes into every transcript, so the backfill mapper holds events pending until it sees the marker, then stamps and releases them. Emitter and backfill derive identical deterministic event ids from the same protocol helpers ([30-event-protocol.md](30-event-protocol.md)), so a backfill after live emission inserts zero duplicate rows; the backfill summary reports mapped, inserted, and skipped counts.

Kernel-side and app-side events flow through the same trace writer. The viewer treats everything as one trace stream; source is used for display and debugging, not for splitting the mental model.

## Usage Rollups

Every `pi_turn_end` carries `TurnUsage` (input/output/cache tokens, the model that actually served the turn, and a cost estimate from the kernel-config price table when present). The write path folds usage upward: turn → run → session → container, as denormalized rollup columns on each row. `agent_run_end` also carries the run's rolled-up usage in its payload.

## Request Snapshots

A request snapshot is the exact context window one turn ran on, captured into content-addressed trace blobs and referenced by a `pi_request_snapshot` trace event. It is what makes "what did the model actually see?" answerable after the fact (D90, [60-prompt-system-model.md](60-prompt-system-model.md)). Capture is on by default and disableable per kernel or per spawn; snapshots share the emitter's envelope identity, so they land in the run's trace beside its turn events. Capture never breaks a turn: it is synchronous at the capture point, defers hashing and writes behind a serialized tail, and every failure is caught and logged.

There are two capture paths, and only one is live per run:

- **Transcript capture** — on each turn start, the messages Pi would send, filtered by Pi's own sent-to-model selection. This is the path for pass-through agents, and it corresponds 1:1 with turns.
- **Built-request capture** — the exact array the three-section builder assembled, plus its section boundaries. From the first built request onward, transcript capture stops: the built request *is* the request, and capturing both would double-count. This path fires once per *provider request*, so a provider retry inside one turn produces an extra snapshot — accurate, because it is a real request that really went out — after which snapshot numbering runs ahead of turn events. Readers correlating the two should treat `turn_number` as "the nth captured request", not as a key into turn events.

The system prompt is read off the session on both paths and stored as its own blob — it is section ①, never part of the message list.

**Blobs.** Each captured message is sanitized before hashing: inline base64 image payloads are removed and stored as their own `image` blobs, leaving a hash reference on the message. Per snapshot the recorder writes one text blob for the system prompt, one JSON blob per sanitized message, one blob per image, and — when captured — one JSON blob for the tool roster. Content addressing plus a written-hash set means the prefix-stable transcript costs only its new tail on repeat turns. The snapshot event payload carries the turn number, blob hashes, `prompt_hash`, per-message refs (role, index, sizes), totals, and optionally `sections`, `tools_blob_hash`, and `tool_count`.

**Tool roster.** Tools can change call to call, so the roster is captured *per request*: what the agent could do on turn 7 is not necessarily what it could do on turn 0. It is read off the session — like the system prompt, and unlike the messages, which the builder may have rewritten — in provider-visible order, with descriptions and parameter schemas passed through verbatim; an active name with no registry entry is recorded as `{ name }` alone. The roster fields are optional and **absent whenever the roster was not captured**; readers must never read absence as "the agent had no tools". A captured roster of zero tools is a different thing and is written honestly as an empty array. Every roster-capture failure degrades to absence, and the snapshot is still recorded.

**Section tags.** `sections` is the three-section builder's half-open `[start, end)` ranges over the snapshot's ordered message refs — emitted in order, never overlapping, empty sections omitted. It is optional and absent on transcript-captured turns, including every snapshot written before section tags existed. Readers must treat a missing `sections` as "untagged" and fall back to a flat rendering — this is the compatibility rule the whole downstream chain, viewer included, follows ([40-viewer-model.md](40-viewer-model.md)).

**Read path.** `GET /kernel/runs/:runId/turns/:n/context` resolves a snapshot into a readable turn: the latest snapshot event matching the turn number, its system-prompt and message blobs resolved, plus refs, totals, optional `sections` and `tools`, and `warnings`. A missing or unparseable blob becomes a `missing_blob` placeholder plus a warning rather than a failed request; a named tool-roster blob that cannot be resolved yields no `tools` key plus a warning, because a partial roster would be worse than none. Raw blob bytes serve from `GET /kernel/blobs/:hash`, which is how the viewer renders images without inlining base64.

## Read Surface

The read API is the stable route surface between kernel trace storage and viewer-core. The kernel ships a route factory apps mount inside their own HTTP service (default prefix `/kernel`), driven by a service contract: `getContainerTrace(containerId, query)` required, session-container listing optional. The kernel instance provides the default container-backed service over the local trace db (flushing pending trace writes before each read); apps with custom auth, tenancy, or payload shapes supply their own service behind the same routes.

Trace routes are container-first:

| Route | Purpose |
|---|---|
| `GET /kernel/containers/:containerId/trace` | Primary read: the full trace for one container subtree — root container, container tree, Pi sessions, agent runs, trace events |
| `GET /kernel/trace-sessions` | List containers of kind `"session"` when the service provides list support |
| `GET /kernel/trace-sessions/:id` | Container-backed alias — a trace session is a container of kind `"session"`, so the detail route delegates to the container trace |
| `GET /kernel/runs/:runId/turns/:n/context` | Request-snapshot resolution (above) |

Trace routes accept `after` for incremental reads and `limit`, clamped by route options — defaults are intentionally conservative (5000 fallback, 10000 maximum).

Beside the trace routes, the kernel serves the catalog API over the agent registry and prompt revisions: registry listing, per-agent manifest + prompt document + rendered text, prompt save (validate, canonicalize + hash, write `prompt.json`, regenerate its markdown render, upsert a `lab-save` prompt revision), revision history, and per-revision run analytics joined through `pi_agent_sessions.prompt_hash`. The prompt-save route mutates catalog files on disk, so it is dev-gated: mounted only when the kernel runs in dev mode; production harnesses ship read-only catalogs. The prompt side of this surface is governed by [60-prompt-system-model.md](60-prompt-system-model.md).

Route paths are exported constants from viewer-core, including the container-first cross-kernel observer paths (`/kernels`, `/kernels/:kernelId`, per-container trace) for the future observer plane — see [50-read-api.md](../20-implementation/50-read-api.md).

## Trace Doctor

`runTraceDoctor` (and the CLI: `bun run packages/kernel/src/doctor-cli.ts <db-path>`) checks one kernel database against eight linkage and usage invariants — container references, run/session resolution, parent linkage, terminal statuses, tool-call pairing, tree acyclicity, run-id resolution, and usage-rollup consistency. The invariant list lives in [15-identity-model.md](15-identity-model.md). The kernel instance exposes the same check as `kernel.doctor()`.
