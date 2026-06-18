---
covers: "Implementation overview of @agent-kernel/kernel: createKernel, spawn runtime, agent registry, context assembly, subagents, events, and read API route exports."
type: overview
concepts: [kernel-package, create-kernel, spawn-pipeline, agent-registry, context-builder, subagents, run-context]
code-ref: packages/kernel/src/
depends-on: [../../10-system-design/10-runtime-model.md]
---

# Kernel Package

`@agent-kernel/kernel` owns the reusable runtime pieces. It does not own app workflow semantics.

---

## Public Areas

| Export | Purpose |
|---|---|
| `.` | `createKernel`, concurrency config, and top-level re-exports |
| `./agent-registry` | agent parsing and registry |
| `./context` and `./context/loaders` | context resolver contracts and loader catalog |
| `./events` | lifecycle emitter helpers |
| `./read-api` | Elysia trace read API route factory |
| `./run-context` | async-local run identity |
| `./spawn-pipeline` | DB-backed Pi spawn pipeline |
| `./subagents` | `AgentManager` and subagent support |

## Current Runtime Shape

The kernel package includes both:

- a generic `createKernel(config)` instance API
- the extracted DB-backed spawn pipeline used by Spectre's adapter

The spawn pipeline accepts adapter functions for app-specific pieces:

- agent lookup
- context resolver loading
- private tool factory loading
- shared tool factory construction
- context catalog creation
- spawn context creation
- DB access
- app session binding markers
- logging

This keeps app knowledge out of the package while preserving a complete runtime.

## Implementation Nodes

### [10-spawn-pipeline.md](10-spawn-pipeline.md)
How `createSpawnAgent()` runs the full Pi spawn pipeline.

### [20-agent-registry.md](20-agent-registry.md)
How agent definitions are parsed, indexed, and validated.

### [30-context-loaders.md](30-context-loaders.md)
How agent context resolvers and loader catalogs work.

### [40-subagents.md](40-subagents.md)
How subagent orchestration reuses the same spawn path.
