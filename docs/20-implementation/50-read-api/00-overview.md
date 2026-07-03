---
covers: "Kernel read API implementation: container-first trace routes, the catalog API routes, viewer-core path constants, read service contract, limits, and app mounting."
type: overview
concepts: [read-api, catalog-api, elysia, viewer-core, containers, trace-sessions, route-factory, prompt-revisions]
code-ref: packages/kernel/src/read-api.ts, packages/kernel/src/read-service.ts, packages/viewer-core/src/api.ts, packages/db/src/actions/read-api.ts
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
| `GET /kernel/containers/:containerId/trace` | Primary read: the full trace for one container subtree |
| `GET /kernel/trace-sessions` | List containers of kind `"session"` when the service provides list support |
| `GET /kernel/trace-sessions/:id` | Container-backed alias — a trace session is a container of kind `"session"`, so the detail route delegates to the container trace |

## Service Contract

The route factory accepts a `KernelTraceReadService`:

- required `getContainerTrace(containerId, query)`
- optional `listSessionContainers(query)`

The kernel instance ships a default implementation: `kernel.readApiService` is the container-backed read service over the local trace db (flushing pending trace writes before each read). Apps with custom auth, tenancy, or payload shapes can still supply their own service.

## Catalog API

Beside the trace routes, the kernel serves the catalog API over the agent registry and prompt revisions. `KERNEL_CATALOG_PATHS` in viewer-core defines the URL shapes:

| Route | Purpose |
|---|---|
| `GET /kernel/catalog/agents` | Registry listing (name, description, model, prompt hash, validity) |
| `GET /kernel/catalog/agents/:name` | Manifest + prompt document + rendered text + declared variables |
| `PUT /kernel/catalog/agents/:name/prompt` | Save a `PromptDocument`: validate, canonicalize + hash, write `prompt.json` + regenerate `prompt.rendered.md`, upsert a `prompt_revisions` row (`source: "lab-save"`), respond `{ hash }` (400 with errors on validation failure) |
| `GET /kernel/catalog/agents/:name/revisions` | Revision history (hash, source, created-at) |
| `GET /kernel/catalog/agents/:name/revisions/:hash/stats` | Per-revision run analytics: runs, total/avg tokens, cost, failures — joined through `pi_agent_sessions.prompt_hash` |

The write route mutates catalog files on disk, so it is dev-gated: it is only mounted when the kernel runs in dev mode. Production harnesses ship read-only catalogs.

## Query Handling

The trace routes accept:

- `after` for incremental reads
- `limit`, clamped by route options

Defaults are intentionally conservative: 5000 fallback, 10000 maximum.

## Viewer Contract

`@agent-kernel/viewer-core` exports `KERNEL_TRACE_READ_PATHS` and `KERNEL_CATALOG_PATHS` for app-mounted routes. Viewer code should use those constants rather than hard-coded paths.

Viewer-core also exports `KERNEL_OBSERVER_READ_PATHS` for the future cross-kernel observer plane (container-first; the old tailer-daemon routes are gone):

- `GET /kernels`
- `GET /kernels/:kernelId`
- `GET /kernels/:kernelId/containers`
- `GET /containers/:containerId`
- `GET /containers/:containerId/trace`

The trace response DTOs include the root container, container tree, Pi sessions, agent runs, and trace events.

## App Mounting

The example app mounts `createKernelTraceReadApi(kernel.readApiService)` directly. Host apps with their own data backends mount the same route module and either reuse the default service or supply a resolver of their own.
