---
covers: "Implementation overview of @agent-kernel/kernel: createKernel config, spawn runtime, containers, emitter, doctor, agent registry, context assembly, subagents, events, and read API route exports."
type: overview
concepts: [kernel-package, create-kernel, spawn-pipeline, containers, kernel-emitter, trace-doctor, agent-registry, context-builder, subagents, run-context, transcript-recovery]
code-ref: packages/kernel/src/
depends-on: [../../10-system-design/10-runtime-model.md]
---

# Kernel Package

`@agent-kernel/kernel` owns the reusable runtime pieces. It does not own app workflow semantics.

---

## Public Areas

| Export | Purpose |
|---|---|
| `.` | `createKernel`, kernel config types, and top-level re-exports |
| `./agent-definition` | agent manifest types, JSON Schema check, `defineAgent`/`defineContext`/`defineTools` helpers |
| `./agent-registry` | `agent.json` bundle discovery, validation, prompt-revision registration |
| `./containers` | deterministic container identity (`uuidv5` derivation, `kernel.container()` upsert) |
| `./context` and `./context/loaders` | context resolver contracts and loader catalog |
| `./doctor` | trace doctor invariant checker (plus `doctor-cli.ts` entry) |
| `./emitter` | in-process kernel emitter mapping live Pi events to protocol events |
| `./events` | lifecycle emitter helpers |
| `./read-api` | Elysia trace read API route factory |
| `./run-context` | async-local run identity |
| `./spawn-pipeline` | Pi spawn pipeline internals |
| `./subagents` | `AgentManager` and subagent support |
| `./transcript-recovery` | JSONL backfill: `runBackfill`, `EventMapper`, and the `agent-kernel-backfill` CLI bin |
| `./trace-writer`, `./read-service` | default DB trace sink and container-backed read service |

## Current Runtime Shape

`createKernel(config)` is the single entry point. The former eight-adapter spawn bundle is gone from the public surface; the kernel builds the agent registry from `catalog.roots` at first use, registers prompt revisions into the db, assembles the spawn pipeline internally, and exposes the standard instance surface:

- `spawnAgent(name, prompt, ctx, opts)` — with `variant` selection and model-alias resolution
- `container({ kind, key, ... })` — deterministic, idempotent container upsert
- `agentManager` — subagent orchestration over the same spawn path
- `traceWriter` / `readApiService` — default write and read surfaces over the kernel db
- `registry()`, `doctor()`, `setMaxBackgroundAgents()`, `dispose()`

App-shaped behavior enters through config function slots only: `appContext`, `loaders`, `sharedTools`, `createSessionBinding`, and `logger`. Everything else — catalog roots, db handle, model aliases and prices, tool profiles, tool runtime, Pi directories, concurrency — is data.

## Implementation Nodes

### [10-spawn-pipeline.md](10-spawn-pipeline.md)
How the spawn pipeline runs one agent prompt through Pi.

### [20-agent-registry.md](20-agent-registry.md)
How `agent.json` bundles are discovered, validated, and normalized.

### [30-context-loaders.md](30-context-loaders.md)
How agent context resolvers and loader catalogs work.

### [40-subagents.md](40-subagents.md)
How subagent orchestration reuses the same spawn path.

### [50-transcript-recovery.md](50-transcript-recovery.md)
How Pi JSONL transcripts are re-derived into trace rows (backfill) for disaster rebuild and importing externally-run sessions, sharing deterministic ids with the emitter.
