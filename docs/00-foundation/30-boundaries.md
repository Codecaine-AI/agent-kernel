---
covers: "Kernel versus application ownership boundaries, including which concepts stay core and which must be supplied by adapters like Spectre."
concepts: [boundaries, kernel-core, app-adapter, spectre, ownership, custom-loaders, custom-tools]
depends-on: [20-principles.md]
---

# Boundaries

The kernel owns the reusable runtime and observability foundation. A host application owns workflow semantics and product behavior.

---

## Kernel Owns

The kernel owns the whole path from spawning an agent to viewing what it did:

- **Running agents** — spawning from declarative definitions, identity, context assembly, agent state, and subagent management. Contracts: [runtime model](../10-system-design/10-runtime-model.md), [identity model](../10-system-design/15-identity-model.md), [prompt system model](../10-system-design/60-prompt-system-model.md).
- **Capturing what happened** — the trace event protocol, durable storage, and transcript recovery. Contracts: [event protocol](../10-system-design/30-event-protocol.md), [observability model](../10-system-design/20-observability-model.md).
- **Reading it back** — versioned read APIs and the reusable viewer surface. Contracts: [observability model](../10-system-design/20-observability-model.md), [viewer model](../10-system-design/40-viewer-model.md).

The concrete schemas, envelopes, and decision records for each area belong to those design pages, not to this one.

## Apps Own

| Area | App Responsibility |
|---|---|
| Workflow state | App session rows, phase slices, task/checkpoint graphs, project docs, local artifacts |
| Workflow rules | When phases start/end, how gates work, what "done" means |
| Domain tools | Tools that mutate app rows or app files |
| Custom loaders | Loaders that read app-specific state, such as Spectre's checkpoint slice |
| App APIs | Routes that start, stop, resume, answer, or mutate workflow artifacts |
| Viewer extensions | Panels and renderers that interpret app-specific labels or custom events |

## Adapter Layer

The adapter layer is the code that joins a host app to the kernel. It should be explicit and small enough to audit: identity mapping, schema composition, catalog roots, injected services, custom loaders, API mounts, and viewer plugins all live there rather than leaking into either side. The contract is the [app adapter model](../10-system-design/50-app-adapter-model.md); the concrete Spectre wiring is recorded in [implementation](../20-implementation/70-app-adapters.md).

## Promotion Rule

A feature starts app-side when its generic shape is unclear. It can move into the kernel only after it proves useful beyond one app and can be expressed without app workflow semantics.

Durable human-in-the-loop asks are a good example. The suspend/resume mechanics are generic. Spectre's ask rows and payloads remain app-side until the kernel has a clean cross-app contract.
