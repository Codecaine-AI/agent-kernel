---
covers: "System design overview for the Pi Agent Kernel platform: runtime, observability, protocol, viewer, and app adapter models."
type: overview
concepts: [system-design, runtime-model, observability-model, event-protocol, viewer-model, app-adapter]
---

# System Design

The kernel is organized around a small set of system concepts: agents are spawned inside app-provided context, execution emits protocol events, events are stored and read through kernel contracts, and the viewer renders those contracts with optional app plugins.

---

## Child Nodes

### [10-runtime-model.md](10-runtime-model.md)
How agents, context, subagents, run context, and app adapters compose at runtime.

### [20-observability-model.md](20-observability-model.md)
How containers, Pi sessions, runs, events, and explicit linkages form the trace graph.

### [30-event-protocol.md](30-event-protocol.md)
The event envelope, core event catalog, trace levels, and open extension model.

### [40-viewer-model.md](40-viewer-model.md)
How viewer-core, viewer-ui, and viewer-shell turn trace data into a base UI.

### [50-app-adapter-model.md](50-app-adapter-model.md)
How apps such as Spectre mount and extend the kernel without moving workflow semantics into it.

### [60-prompt-system-model.md](60-prompt-system-model.md)
How prompt authoring should produce kernel-ready agent definitions, context resolvers, and prompt skills.
