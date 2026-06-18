---
covers: "Simple Research Kernel example that boots a non-Spectre research app, persists kernel observability rows to Postgres, and renders traces through the viewer shell."
concepts: [research-harness, examples, kernel-runtime, agent-registry, context-loaders, subagents, working-memory, read-api, viewer-shell]
code-ref: examples/simple-research-kernel/
depends-on: [10-dev-setup.md, ../20-kernel/30-context-loaders.md, ../50-read-api/00-overview.md, ../60-viewer/00-overview.md]
---

# Simple Research Kernel Demo

`examples/simple-research-kernel` is a runnable host application for inspecting the kernel outside Spectre. It uses the shared local Postgres service for kernel registration, containers, Pi sessions, agent runs, trace events, and DB-backed trace reads.

---

## Run

```bash
bun run dev:services
bun run dev:simple-research
```

The service command starts Postgres. The kernel launcher starts two local processes:

- API: `http://127.0.0.1:8788`
- Viewer: `http://127.0.0.1:5174`

The API exposes the kernel read routes under `/kernel/*` and Simple Research Kernel routes under `/api/*`, including `/api/research` for the current app summary, `/api/run` for starting prompt-driven research runs, and `/api/kernel-registration` for the registration row summary.

## What It Wires

The harness exercises the core package path:

```text
@agent-kernel/kernel
  createKernel()
  buildRegistry()
  buildContext()
  AgentManager
  createDefaultCatalog()
    text loader
    file/directory loaders
    working-memory loader registered by the host app

@agent-kernel/protocol
  trace event factories

@agent-kernel/db
  ensureKernelObservabilitySchema()
  upsertKernelRegistration()
  container/session/run/event writes
  DB-backed read helpers

@agent-kernel/kernel/read-api
  createKernelTraceReadApi()

@agent-kernel/viewer-core
  KERNEL_TRACE_READ_PATHS
  buildTraceSpans()

@agent-kernel/viewer-shell
  KernelTraceViewer
```

## Runtime Shape

`src/server.ts` owns the Elysia API, DB bootstrap, kernel registration, persistence adapter, and read API factory.

`src/simple-research-kernel-store.ts` owns the kernel instance, deterministic research runtime, container/session/run event production, subagent fan-out, and the custom `working-memory` context loader. Its persistence adapter writes the emitted rows to Postgres.

`src/agent-catalog/*/agent.md` defines the coordinator, source scout, and report writer agents. Each agent has a colocated `context.ts` sidecar that declares loader inputs and assembles model-facing context.

`research-memory/` holds the seed brief, durable source notes, generated scout-report directory, and generated final-report directory.

`src/main.tsx` fetches the read API response, transforms events into trace spans, and renders `KernelTraceViewer`.

`src/styles.css`, `tailwind.config.cjs`, and `postcss.config.cjs` provide the example's Tailwind pipeline and Spectre-compatible viewer tokens. The example wrapper uses Tailwind utility classes; it does not define a separate named CSS component system.

## Boundary Intent

This example is deliberately not a Spectre adapter. It proves the extracted kernel can stand up a host harness with:

- a kernel instance
- filesystem agent definitions
- app-defined context loaders
- subagent orchestration
- scout-report review and optional follow-up
- working-memory artifacts
- protocol event emission
- Postgres-backed observability rows
- read API responses
- viewer-core transforms
- a mountable viewer shell

Spectre should consume the same packages through a Spectre adapter layer rather than requiring these packages to know about Spectre sessions, phases, checkpoints, or task graphs.
