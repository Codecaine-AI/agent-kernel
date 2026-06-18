---
covers: "Implementation overview of the kernel monorepo packages and how protocol, db, kernel, tailer, read API, and viewer packages fit together."
type: overview
concepts: [implementation, packages, protocol, db, kernel, tailer, read-api, viewer]
depends-on: [../10-system-design/00-overview.md]
---

# Implementation Overview

This repository is a Bun workspace containing the portable kernel packages extracted from Spectre.

---

## Package Map

```text
packages/
  protocol/      Trace event envelope, event catalog, factories
  db/            Kernel observability Drizzle schema and query helpers
  kernel/        Kernel instance, spawn runtime, registry, context, subagents, read API
  tailer/        Pi JSONL ingestion primitives
  viewer-core/   Read API DTOs and trace span transforms
  viewer-ui/     Trace tree and detail UI components
  viewer-shell/  Mountable KernelTraceViewer shell
```

## Dependency Direction

```text
protocol
  ^
  |-- db
  |-- tailer
  |-- viewer-core
        ^
        |-- viewer-ui
              ^
              |-- viewer-shell

kernel depends on protocol, db, and viewer-core for runtime/read contracts.
```

Kernel packages must not import Spectre packages, Spectre paths, or Spectre naming. Apps consume the kernel through package exports and adapters.

## Child Nodes

### [10-protocol/](10-protocol/00-overview.md)
Trace protocol types and event factories.

### [20-kernel/](20-kernel/00-overview.md)
Runtime package: kernel instance, registry, spawn pipeline, context, subagents, run context.

### [30-db/](30-db/00-overview.md)
Drizzle schema and query helpers for containers, Pi sessions, agent runs, and trace events.

### [40-tailer/](40-tailer/00-overview.md)
JSONL ingestion pieces: mapper, cursor store, file reader, watcher, queue, health.

### [50-read-api/](50-read-api/00-overview.md)
Elysia route factory and DB read helpers consumed by viewer-core.

### [60-viewer/](60-viewer/00-overview.md)
Viewer DTOs, trace transforms, UI components, and shell.

### [70-app-adapters/](70-app-adapters/00-overview.md)
How host apps such as Spectre connect domain state to kernel packages, including the [application setup guide](70-app-adapters/10-application-setup.md).

### [99-appendix/](99-appendix/00-overview.md)
Development setup, validation, and package linking notes.
