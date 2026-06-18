---
covers: "Kernel trace read API implementation: Elysia route factory, viewer-core path constants, read service contract, DB helper relationship, limits, and app mounting."
type: overview
concepts: [read-api, elysia, viewer-core, trace-sessions, containers, route-factory]
code-ref: packages/kernel/src/read-api.ts, packages/viewer-core/src/api.ts, packages/db/src/actions/read-api.ts
depends-on: [../30-db/00-overview.md, ../60-viewer/00-overview.md]
---

# Read API

The read API is the stable route surface between kernel trace storage and viewer-core.

---

## Route Factory

`createKernelTraceReadApi(service, options)` creates an Elysia module. Apps mount it inside their own HTTP service.

Default prefix: `/kernel`

Routes:

| Route | Purpose |
|---|---|
| `GET /kernel/trace-sessions` | List trace sessions when the host provides list support |
| `GET /kernel/trace-sessions/:id` | Read one trace session detail |
| `GET /kernel/containers/:containerId/trace` | Read a trace by kernel container id |

## Service Contract

The route factory accepts a `KernelTraceReadService`:

- optional `listTraceSessions(query)`
- required `getTraceSessionDetail(id, query)`
- optional `getContainerTrace(containerId, query)`

The service is app-provided because each app knows how to resolve app sessions, root containers, compatibility ids, auth, and tenancy.

## Query Handling

The API accepts:

- `after` for incremental reads
- `limit`, clamped by route options

Defaults are intentionally conservative: 5000 fallback, 10000 maximum.

## Viewer Contract

`@agent-kernel/viewer-core` exports `KERNEL_TRACE_READ_PATHS` for the current v1 routes. Viewer code should use those constants rather than hard-coded paths.

The response DTOs include:

- session metadata
- optional container metadata
- container tree
- Pi sessions
- agent runs
- trace events

## App Mounting

Spectre currently mounts this route module in its data backend and adapts Spectre session ids to kernel container ids. Future apps should mount the same route module and supply their own resolver service.
