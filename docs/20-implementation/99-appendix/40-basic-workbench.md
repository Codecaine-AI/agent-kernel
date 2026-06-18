---
covers: "Basic kernel workbench example that boots a non-Spectre in-memory harness and renders kernel traces through the viewer shell."
concepts: [basic-workbench, examples, kernel-runtime, context-loaders, read-api, viewer-shell]
code-ref: examples/basic-kernel/
depends-on: [10-dev-setup.md, ../20-kernel/30-context-loaders.md, ../50-read-api/00-overview.md, ../60-viewer/00-overview.md]
---

# Basic Kernel Workbench

`examples/basic-kernel` is a minimal host application for inspecting the kernel outside Spectre. It uses an in-memory store so the workbench can run without Postgres or a Spectre session database.

---

## Run

```bash
bun run dev:basic
```

The launcher starts two local processes:

- API: `http://127.0.0.1:8788`
- Viewer: `http://127.0.0.1:5174`

The API exposes the kernel read routes under `/kernel/*` and workbench-specific demo routes under `/api/*`.

## What It Wires

The workbench exercises the core package path:

```text
@agent-kernel/kernel
  createKernel()
  buildContext()
  createDefaultCatalog()
    text loader
    memory loader registered by the host app

@agent-kernel/protocol
  trace event factories

@agent-kernel/kernel/read-api
  createKernelTraceReadApi()

@agent-kernel/viewer-core
  KERNEL_TRACE_READ_PATHS
  buildTraceSpans()

@agent-kernel/viewer-shell
  KernelTraceViewer
```

## Runtime Shape

`src/server.ts` owns the Elysia API and injects the in-memory store into the read API factory.

`src/kernel-demo-store.ts` owns the demo kernel instance, synthetic container/session/run rows, protocol events, and the custom `memory` context loader.

`src/main.tsx` fetches the read API response, transforms events into trace spans, and renders `KernelTraceViewer`.

`src/styles.css`, `tailwind.config.cjs`, and `postcss.config.cjs` provide the example's Tailwind pipeline and Spectre-compatible viewer tokens. The example wrapper uses Tailwind utility classes; it does not define a separate named CSS component system.

## Boundary Intent

This example is deliberately not a Spectre adapter. It proves the extracted kernel can stand up a host harness with:

- a kernel instance
- app-defined context loaders
- protocol event emission
- read API responses
- viewer-core transforms
- a mountable viewer shell

Spectre should consume the same packages through a Spectre adapter layer rather than requiring these packages to know about Spectre sessions, phases, checkpoints, or task graphs.
