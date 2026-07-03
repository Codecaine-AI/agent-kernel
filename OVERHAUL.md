# Kernel Overhaul — What Landed and What's Next

This document summarizes the `kernel-overhaul` branch (37 commits, plus 2 in
the `prompt-kit` submodule): what was implemented, how it was verified, and
the follow-up work it sets up. The full implementation plan that drove it is
[docs/.drafts/agent-kernel-overhaul.plan.md](docs/.drafts/agent-kernel-overhaul.plan.md);
decisions are recorded as D70–D80 in
[docs/10-system-design/60-prompt-system-model.md](docs/10-system-design/60-prompt-system-model.md).

---

## What Was Implemented

### Identity and storage — container-first, one SQLite file per kernel

- The trace envelope requires `containerId` and carries `runId`;
  `appSessionId` is gone. An app session is a container of `kind: "session"` —
  one grouping primitive, deterministic ids via
  `kernel.container({ kind, key })` (UUIDv5, collision-safe encoding).
- Each kernel owns a local SQLite database (`.agent-kernel/trace.db`, WAL) —
  no Postgres, no Docker, no service processes. `kernel_registrations` became
  a local `kernel.json` manifest. A Postgres schema mirror remains at
  `@agent-kernel/db/schema/pg` for a hypothetical shared plane (inert,
  actions are SQLite-only).
- Runs are explicit message-in → response-out loops with a `trigger`
  vocabulary (`operator`/`parent-tool`/`steer`/`resume`/`system`) and
  inbound/outbound event references.
- `agent-kernel doctor` (and `make doctor`) checks 8 linkage/usage invariants
  over any kernel database; also surfaced in the viewer.
- See [docs/10-system-design/15-identity-model.md](docs/10-system-design/15-identity-model.md).

### Tracing — in-process emission, token accounting, transcript recovery

- A kernel emitter attached to every Pi session emits all agent-side events
  in-process with full run-context identity — the tailer daemon and its
  marker-binding dance are gone (D75).
- Token usage (input/output/cache, resolved model, optional cost) lands on
  every turn and rolls up turn → run → session → container, denormalized for
  cheap reads. Verified live: run sums equal container rollups exactly.
- `@agent-kernel/tailer` was dissolved (D80): the surviving capability lives
  at `@agent-kernel/kernel/transcript-recovery` (`agent-kernel-backfill`
  CLI) — disaster rebuild, import of externally-run sessions, schema
  re-derivation from Pi's durable JSONL. Emitter and recovery share
  deterministic event-id derivation via protocol; an intra-package parity
  test proves replay inserts zero duplicates.

### Prompt system — canonical documents, content-addressed revisions

- `prompt.json` (a prompt-kit `PromptDocument`) is the canonical authored
  prompt (D70); `prompt.rendered.md` is a committed, test-enforced derived
  snapshot for PR review. Canonicalization + `pk1-` sha256 hashing live in
  prompt-kit (dependency-free, browser-safe).
- Every prompt state is a `prompt_revisions` row; sessions record their
  `prompt_hash` at creation (frozen system prompt), and
  `system_prompt_resolved` events carry it — runs are attributable to the
  exact prompt revision that produced them.
- Per-revision run/token/failure/cost stats close the loop: edit → save →
  run → see that revision's numbers.

### Agent model — manifests as data, spawning as a tool capability

- The agent bundle is `agent.json` (schema-validated manifest) +
  `prompt.json` + `prompt.rendered.md` + `context.ts` + `tools.ts`, discovered
  by filename convention. `agent.md`, frontmatter, and `agent.ts` are gone;
  `defineAgent` survives as a typed generator/validator.
- Spawner tools (D77) replace the `canSpawnSubagent` flag:
  `defineSpawnerTool({ spawns: [...] })` gets a kernel-injected scoped
  `dispatch()` that enforces the allowlist, validates against the catalog,
  and auto-forwards parent linkage + run-context identity (queue-drain-safe).
  Dispatch events carry `toolKind: "spawner"` and render as distinct
  dispatch nodes in the trace tree.
- Variants and model aliases resolve at spawn; the resolved model is what
  lands on session rows. Named tool profiles expand from kernel config.

### Runtime — one `createKernel(config)`

- The eight-adapter spawn bundle collapsed into config: catalog roots, db,
  model aliases + prices, tool profiles, loaders, shared tools, tool runtime,
  app context. The instance exposes `spawnAgent` (with `variant`),
  `container()`, `agentManager`, `traceWriter`, `readApiService`,
  `catalogApiService`, `registry()`, `doctor()`, `dispose()`.
- Catalog APIs (dev-write-gated): agent list/detail, prompt saves with
  registry hot-reload, manifest edits (`description`/`model`, D79) with
  hot-reload, revision history, per-revision stats.
- The example harness (`examples/simple-research-kernel`) shrank to a single
  `createKernel` call plus domain logic and runs with zero services.

### Viewer — a design system and two real product surfaces

- Trace viewer: unified card design system (integrated Nucleo icon caps,
  semantic color groups with amber/red reserved for diagnostics, one mono
  type scale — see
  [docs/20-implementation/60-viewer/10-trace-card-design.md](docs/20-implementation/60-viewer/10-trace-card-design.md)),
  a usage caption strip with a detail-column summary, container/session/run
  aggregates as span details, and a doctor control.
- Agent viewer: a three-column shell — agent selector, the Agent XML prompt
  editor (a code-editor surface with strict grid, Raw parity, Notion-style
  block/keyboard editing, single-step undo, drag physics), and a sidebar
  stacking agent identity (editable model/description), view scope, editor
  controls, block details, and revision history. Design rationale:
  [docs/20-implementation/60-viewer/20-prompt-editor-design.md](docs/20-implementation/60-viewer/20-prompt-editor-design.md)
  (D78/D79).
- App theming: VS Code-anchored neutral gray ladder, and a tabbed style rail
  with live color pickers and a Copy-CSS export so explored palettes become
  shipped defaults.
- Viewer components restructured into vertical slices (folder + `index.tsx` +
  responsibility-named siblings).

### Verification stance

- 195 tests green, full typecheck, package-boundary check.
- A byte-exact characterization snapshot of a real run locks trace-builder
  output; refactors must not move it.
- Every phase was verified with live model runs (doctor green each time),
  and a dedicated QA review of the spawner-tools diff caught and fixed a
  queued-dispatch identity bug before it ever shipped.

---

## Next Steps

### Migrations (the follow-up work this branch exists for)

1. **gc-decomp-harness (decomp orchestrator).** Port its ~3,500-line kernel
   bridge onto `createKernel(config)` — this was the plan's Phase 4 exit
   criteria and remains the best validation of the consolidation. Expected
   deletions: the hand-rolled session-mapping/UUID code (superseded by
   container kind/key), the spawn-adapter assembly (variants/aliases/
   profiles), the tailer wrapper (emitter + transcript recovery), the
   Postgres bridge (per-kernel SQLite), and the read-API adapter
   (`readApiService`). Target: a bridge under ~300 lines.
2. **Spectre.** Same migration, larger surface: container-first identity
   (sessions-as-containers), `agent.json`/`prompt.json` bundles, SQLite
   observability, emitter-based tracing, and the viewer packages' new
   surfaces. Spectre's compatibility shims and `apps/backend/src/agent-kernel`
   tree should be deleted, not ported.

### Parked decisions and small items

- Grain overlay default: screen blend lifts all dark surfaces; decide
  keep / soft-light / lower default opacity (one-token change).
- Postgres mirror + `dev:services` + docker-compose: keep as inert insurance
  or delete (tailer-style simplification) once the multi-kernel observer
  question is settled.
- Model price table (kernel config `models.prices`) so cost columns stop
  reading 0/— for providers that don't report cost.
- Two flagged dead-code nits in viewer-ui (`caretAtEnd`, `_itemIndex`).
- Deferred: dedicated cross-container cost page; budget/abort-on-cost
  enforcement; run outcome/verdict scoring; central observer federation
  (HTTP over per-kernel read APIs); prompt A/B tooling.

### Release mechanics

- Merge `kernel-overhaul` (and the prompt-kit submodule's branch) once the
  walkthrough finishes; then decide whether contracts are settled enough to
  version/publish `@agent-kernel/*` for the migrated consumers.
