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

The API exposes the kernel read routes under `/kernel/*` and Simple Research Kernel routes under `/api/*`, including `/api/research` for the current app summary, `/api/run` for starting prompt-driven research runs, and `/api/kernel-registration` for the registration row summary. The viewer opens at `/research`, where a user can start a run and watch its live trace stream. `/traces` lists DB-backed trace sessions, deep-links selections with `traceId`, and hosts the full detailed trace browser.

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
  typed agent.ts definitions
  prompt-kit prompt.ts documents
  per-agent tools.ts private tool sidecars

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

`src/simple-research-kernel-store.ts` owns the kernel instance, live research runtime, container/session/run event production, subagent fan-out, and the custom `working-memory` context loader. It binds each agent's typed private tools through the registry and passes an app-owned tool runtime into the sidecar. Its persistence adapter writes the emitted rows to Postgres.

`src/agent-catalog/*/agent.ts` defines the coordinator, source scout, and report writer agents. Each agent imports a colocated `prompt.ts` prompt-kit document, `context.ts` resolver, and `tools.ts` private tool registration sidecar.

`src/agent-catalog/tool-runtime.ts` contains the shared tool registration helpers and the runtime contract that lets agent sidecars call back into app-owned working memory and subagent orchestration without moving those concerns into the kernel package.

`research-memory/` holds the seed brief and durable source notes. When a run starts, the app creates `.agent-kernel/research-sessions/<app-session-slug>/`, copies that seed material into the session's `research-memory/` folder, and writes generated scout/final reports under that session directory.

`src/App.tsx` fetches the DB-backed trace-session list and selected detail, transforms selected events into trace spans, and renders separate research-run, traces, and agent-catalog workspaces around the shared viewer packages.

`src/styles.css`, `tailwind.config.cjs`, and `postcss.config.cjs` provide the example's Tailwind pipeline and Spectre-compatible viewer tokens. The example wrapper uses Tailwind utility classes; it does not define a separate named CSS component system.

## Boundary Intent

This example is deliberately not a Spectre adapter. It proves the extracted kernel can stand up a host harness with:

- a kernel instance
- typed filesystem agent definitions
- app-defined context loaders
- per-agent private tool sidecars
- subagent orchestration
- scout-report review and optional follow-up
- working-memory artifacts
- protocol event emission
- Postgres-backed observability rows
- read API responses
- viewer-core transforms
- a mountable viewer shell

Spectre should consume the same packages through a Spectre adapter layer rather than requiring these packages to know about Spectre sessions, phases, checkpoints, or task graphs.
