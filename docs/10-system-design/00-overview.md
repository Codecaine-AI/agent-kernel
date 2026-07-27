---
covers: "System design overview for the Pi Agent Kernel platform: runtime, observability, protocol, viewer, app adapter, and prompt/state models."
type: overview
concepts: [system-design, runtime-model, observability-model, event-protocol, viewer-model, app-adapter, prompt-system, state-model]
---

# System Design

The kernel is organized around a small set of system concepts: agents are spawned inside app-provided context, execution emits protocol events, events are stored and read through kernel contracts, and the viewer renders those contracts with optional app plugins.

---

## Child Nodes

### [10-runtime-model.md](10-runtime-model.md)
How agents, context, subagents, run context, and app adapters compose at runtime.

### [15-identity-model.md](15-identity-model.md)
Containers with kinds as the single grouping primitive, sessions, runs, turns, and the linkage invariants.

### [20-observability-model.md](20-observability-model.md)
How containers, Pi sessions, runs, events, and explicit linkages form the trace graph.

### [30-event-protocol.md](30-event-protocol.md)
The event envelope, core event catalog, trace levels, and open extension model.

### [40-viewer-model.md](40-viewer-model.md)
How viewer-core, viewer-ui, and viewer-shell turn trace data into a base UI.

### [50-app-adapter-model.md](50-app-adapter-model.md)
How apps such as Spectre mount and extend the kernel without moving workflow semantics into it.

### [60-prompt-system-model.md](60-prompt-system-model.md)
How prompt authoring should produce kernel-ready agent definitions, context resolvers, and prompt skills. Also carries the decision log, including the agent state model agreed on 2026-07-27 (D81–D97).

### [explainers/](explainers/state-shapes.html)
Design explainers (HTML, open in a browser). [state-shapes.html](explainers/state-shapes.html) is the current state model — the three-section request, the `seed`/`update`/`render` contract, and the decision table behind D81–D97. [context-fold-projection.html](explainers/context-fold-projection.html) holds the measured Pi 0.82.1 hook behavior; its fold/projection model is superseded (D94). [prompt-cache-tiers.html](explainers/prompt-cache-tiers.html) covers storage and transport, including the pinned emission-seam decisions (D92).
