---
covers: "Implementation guidance for host app adapters, using Spectre as the reference application without making Spectre concepts kernel concepts."
type: overview
concepts: [app-adapter, spectre-adapter, session-mapping, custom-loader, state-manager, viewer-plugins, tailer-wrapper]
depends-on: [../../00-foundation/30-boundaries.md, ../20-kernel/00-overview.md, ../50-read-api/00-overview.md]
---

# App Adapters

App adapters connect host workflow semantics to kernel packages. They are intentionally specific.

---

## Required Adapter Work

A host app usually needs to provide:

- kernel tables in its migration pipeline
- app workflow tables that reference kernel containers or app-session ids
- `createKernel()` configuration
- `createSpawnAgent()` adapters
- a trace writer implementation
- agent catalog roots
- shared tool factories
- custom context loaders
- app session binding markers for JSONL
- tailer wrapper with DB insert/upsert behavior
- read API service implementation
- viewer shell integration

## Child Nodes

### [10-application-setup.md](10-application-setup.md)
Step-by-step guide for wiring a host application around the kernel packages, including package linking, database composition, kernel creation, custom loaders, tailer wrapping, read API mounting, and viewer setup.

## Spectre Reference Adapter

Spectre should keep these app-side:

- Spectre session rows and phase state
- `SessionStateManager`
- spec, plan, build, docs, intake, onboarding services
- project/worktree/git behavior
- `checkpoint-slice` loader
- domain tools that write Spectre state
- durable ask tables and answer routes
- phase-specific UI panels

Spectre should consume these kernel surfaces:

- protocol event types and factories
- kernel DB tables and query helpers
- spawn pipeline and run context
- registry/parsing mechanics
- tailer primitives
- read API route factory
- viewer-core/ui/shell packages

## Adapter Tests

Adapters should be tested for:

- no kernel package importing app code
- app packages depending on kernel package exports only
- trace writes carrying container ids
- subagents carrying parent tool-use ids
- custom loaders living in the app
- viewer pages consuming viewer-core DTOs, not database schema
