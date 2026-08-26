---
covers: "Implementation area page for the kernel read API: role, source pointer, governing design pages, and structural decisions about route constants and the service seam."
type: overview
concepts: [read-api, catalog-api, elysia, route-factory, viewer-core, path-constants, service-contract]
code-ref: packages/kernel/src/read-api.ts, packages/kernel/src/read-service.ts, packages/kernel/src/catalog-api.ts, packages/viewer-core/src/api.ts
depends-on: [../10-system-design/20-observability-model.md]
---

# Read API

The read API is the stable route surface between kernel trace storage and viewer-core: Elysia route factories apps mount inside their own HTTP service, plus the kernel's default read service. Routes, query limits, the catalog API, and the request-snapshot read path are design: [20-observability-model.md](../10-system-design/20-observability-model.md) § Read Surface.

Source: `packages/kernel/src/read-api.ts`, `read-service.ts`, `catalog-api.ts`; path constants in `packages/viewer-core/src/api.ts`.

Governed by: [20-observability-model.md](../10-system-design/20-observability-model.md), and — for the prompt side of the catalog surface — [60-prompt-system-model.md](../10-system-design/60-prompt-system-model.md).

---

## Decisions

### Route paths are viewer-core constants

**Decision.** Every URL shape — trace reads (`KERNEL_TRACE_READ_PATHS`), catalog (`KERNEL_CATALOG_PATHS`), and the future cross-kernel observer plane (`KERNEL_OBSERVER_READ_PATHS`) — is defined once in `@agent-kernel/viewer-core`, and both route factories and viewer fetchers use the constants rather than string literals.

**Why.** The routes are a contract between two packages that ship separately; hard-coded path literals on either side were rejected because a rename becomes a silent 404 instead of a type error. Viewer-core is the home because every consumer of the routes already depends on it.

**Applies to.** `packages/viewer-core/src/api.ts`, `packages/kernel/src/read-api.ts`, `catalog-api.ts`, and every future route and fetcher — new routes get a constant first.

### Routes bind to a service contract, not to the database

**Decision.** The route factory takes a `KernelTraceReadService` (`getContainerTrace` required, list support optional). The kernel ships the default container-backed implementation (`kernel.readApiService`, flushing pending trace writes before each read); the routes never import DB actions directly.

**Why.** Apps with custom auth, tenancy, or payload shapes must be able to supply their own service without forking the routes. Binding routes straight to the db was rejected because it makes the route surface and the storage layer one unit.

**Applies to.** `packages/kernel/src/read-api.ts`, `read-service.ts`, and every future route: new reads extend the service contract, then the routes.
