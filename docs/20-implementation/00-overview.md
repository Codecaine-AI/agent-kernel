---
covers: "Implementation overview of the kernel monorepo packages and how protocol, db, kernel, read API, and viewer packages fit together."
type: overview
concepts: [implementation, packages, protocol, db, kernel, read-api, viewer]
depends-on: [../10-system-design/00-overview.md]
---

# Implementation Overview

This repository is a Bun workspace containing the portable kernel packages extracted from Spectre.

---

## Package Map

```text
packages/
  protocol/      Trace event envelope, event catalog, factories, deterministic ids
  db/            Per-kernel SQLite store, schema (+ pg mirror), manifest, query helpers
  kernel/        Kernel instance, containers, spawn runtime, emitter, registry,
                 context, subagents, doctor, read API, transcript recovery
  prompt-kit/    Prompt document model, canonicalization/hash, renderers (submodule)
  viewer-core/   Read/catalog API DTOs, trace span transforms, prompt diff
  viewer-ui/     Trace tree, detail, and prompt lab UI components
  viewer-shell/  Mountable KernelTraceViewer shell
```

## Dependency Direction

```text
protocol
  ^
  |-- db
  |-- viewer-core
        ^
        |-- viewer-ui
              ^
              |-- viewer-shell

kernel depends on protocol, db, and viewer-core for runtime/read contracts.
```

Kernel packages must not import Spectre packages, Spectre paths, or Spectre naming. Apps consume the kernel through package exports and adapters.

## Local Development Mode

```text
examples/simple-research-kernel
  single local SQLite trace database (.agent-kernel/trace.db) + kernel manifest
  containers, sessions, runs, trace events, prompt revisions, usage rollups
  DB-backed read API
  app-embedded viewer
```

Run `bun run dev:simple-research` — no Docker and no service processes. `bun run dev:services` remains only for optional shared-Postgres experiments.

## Child Nodes

### [10-protocol/](10-protocol/00-overview.md)
Trace protocol types and event factories.

### [20-kernel/](20-kernel/00-overview.md)
Runtime package: kernel instance, containers, registry, spawn pipeline, emitter, context, subagents, run context, doctor, transcript recovery.

### [30-db/](30-db/00-overview.md)
SQLite client, kernel manifest, and Drizzle schema/query helpers for containers, Pi sessions, agent runs, trace events, and prompt revisions.

### [50-read-api/](50-read-api/00-overview.md)
Elysia route factory and DB read helpers consumed by viewer-core.

### [60-viewer/](60-viewer/00-overview.md)
Viewer DTOs, trace transforms, UI components, and shell.

### [70-app-adapters/](70-app-adapters/00-overview.md)
How host apps such as Spectre connect domain state to kernel packages, including the [application setup guide](70-app-adapters/10-application-setup.md).

### [99-appendix/](99-appendix/00-overview.md)
Development setup, validation, and package linking notes.
