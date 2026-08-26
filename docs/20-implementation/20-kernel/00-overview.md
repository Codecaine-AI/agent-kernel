---
covers: "Implementation area page for @agent-kernel/kernel: role, source pointer, governing design pages, structural decisions about how the kernel package is organized, and the module roster."
type: overview
concepts: [kernel-package, create-kernel, bundle-layout, prompt-snapshot, config-not-adapters, sidecar-harvest, state-sink, module-roster]
code-ref: packages/kernel/src/
depends-on: [../../10-system-design/10-runtime-model.md, ../../10-system-design/20-observability-model.md]
---

# Kernel Package

`@agent-kernel/kernel` owns the reusable runtime pieces — spawn, registry, context, state, subagents, emission, recovery, doctor, read routes. It does not own app workflow semantics.

Source: `packages/kernel/src/`.

Governed by: [10-runtime-model.md](../../10-system-design/10-runtime-model.md) (what a run is and how it executes) and [20-observability-model.md](../../10-system-design/20-observability-model.md) (what the kernel records and serves).

---

## Decisions

### Agent bundle sections are file-or-folder, resolved file-first (D98)

**Decision.** Every bundle section has exactly two legal on-disk shapes — a single file (`prompt.json`, `context.ts`, `tools.ts`, `state.ts`) or a folder with a fixed entry point (`prompt/prompt.json`, `<kind>/index.ts`). Resolution tries the file first, then the folder; when both exist the file wins silently, and `doctor --catalog` reports the shadowed path. A section folder's internal layout is unconstrained — the entry point is the only thing discovery imports.

**Why.** Silent file-wins lets a migration leave a re-export shim at the old path without a boot error, while the doctor keeps shadowing visible. The rejected alternative — one blessed shape, or arbitrary per-section file names — either forces catalog-wide migrations or makes discovery guess.

**Applies to.** `packages/kernel/src/agent-registry/registry/bundle-layout.ts`; every agent bundle in every catalog, including sections and section kinds not yet written — a new section kind must define its file form, its folder entry point, and nothing else.

### Rendered prompt markdown is a committed generated artifact with one writer

**Decision.** The markdown render of a prompt (`prompt.rendered.md` in file form, `prompt/system.md` in folder form) is generated, committed, enforced by a snapshot test, and never hand-edited or parsed by the registry. All writers — registry snapshot test, `render-prompts-cli.ts`, and the catalog save route — go through the same helper (`agent-registry/prompt-snapshot.ts`) and emit identical bytes.

**Why.** PR diffs show the behavioral contract in the format the model receives. The rejected alternatives — render-on-demand (no reviewable diff) or hand-maintained markdown (drifts from the canonical `prompt.json`) — both break the "prompt.json is the source of truth" invariant.

**Applies to.** `packages/kernel/src/agent-registry/prompt-snapshot.ts`, `render-prompts-cli.ts`, the catalog prompt-save path, and any future code that writes a prompt render.

### `createKernel` takes config data, not an adapter bundle

**Decision.** The kernel's entry point is one config object. Injected functions exist only for genuinely app-shaped slots (`appContext`, `loaders`, `sharedTools`, `createSessionBinding`, `logger`); everything else — catalog roots, db handle, model aliases and prices, tool profiles, tool runtime, Pi directories, concurrency — is data. The former eight-adapter spawn bundle is gone from the public surface.

**Why.** Adapter bundles made every host reimplement kernel plumbing and let hosts mislabel identity. Data config keeps the kernel assembling its own pipeline. New config additions must be data unless the slot is genuinely app-shaped — the bar is "the kernel cannot know this", not "a function is convenient".

**Applies to.** `packages/kernel/src/index.ts`, `spawn-pipeline/config/`, and every future config field.

### Sidecars attach by convention and are harvested at boot against a stub

**Decision.** Context, tools, and state sidecars are discovered by filename convention, never declared in the manifest. The registry executes each tools sidecar at boot against a stub Pi object that only records `registerTool({ name })` calls (and spawner `spawns` allowlists), so the expanded tool allowlist and spawner map are known — and validated against the catalog — without app dependencies at registration time. At spawn the same function binds to the real config `toolRuntime`.

**Why.** Declaring tool names in the manifest was rejected: it duplicates what the code already says and drifts. Boot-time harvest keeps `agent.json` pure data while still failing fast on unknown spawn targets.

**Applies to.** `packages/kernel/src/agent-registry/registry/harvest-private-tool-names.ts`, registry sidecar loading, and every future sidecar kind — a new sidecar must be discoverable by convention and boot-checkable without a live runtime.

### State persistence goes through the sink seam (D92)

**Decision.** The state extension writes snapshots through a `StateSink` with the same `submit()` / `flush()` shape and serialized-tail pattern as the trace writer's sink; the file sink is the default implementation, and spawn options swap the sink, never the extension.

**Why.** The sandbox stage needs a remote sink without touching extension code. The rejected alternative — the extension writing files directly — welds persistence location into the state layer.

**Applies to.** `packages/kernel/src/state/store.ts` and any future sink (remote, test, in-memory).

## Modules

One line each; behavior lives in the design pages above.

| Module | Role |
|---|---|
| `index.ts` + `spawn-config.ts` | `createKernel`, config types, variant + model-alias resolution |
| `agent-definition/` | manifest types, JSON Schema check, `defineAgent`/`defineContext`/`defineTools`/`defineState` helpers (validators for tooling — bundles no longer import `defineAgent`) |
| `agent-registry/` | bundle discovery, validation, prompt snapshots, prompt-revision registration |
| `containers.ts` | deterministic container identity and upsert |
| `context/` | resolver contracts, loader catalog, accumulation guard |
| `state/` | `StateModule` contract, session events, windows, context set, three-section builder, `state.json` sink |
| `spawn-pipeline/` | the spawn sequence, Pi session factory, request-snapshot recorder |
| `emitter/` | in-process mapping of live Pi events to protocol events |
| `subagents/` | `AgentManager`, spawner-tool binding — [40-subagents.md](40-subagents.md) |
| `transcript-recovery/` | JSONL backfill and CLI — [50-transcript-recovery.md](50-transcript-recovery.md) |
| `events/`, `run-context.ts` | lifecycle emitter helpers, async-local run identity |
| `doctor.ts` + `doctor-cli.ts` | trace-invariant checker and catalog bundle-layout check (`--catalog <root>`, `--strict`) |
| `read-api.ts`, `read-service.ts`, `catalog-api.ts` | route factories and default read service — [50-read-api.md](../50-read-api.md) |
| `trace-writer.ts` | default DB trace sink |
