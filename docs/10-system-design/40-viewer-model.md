---
covers: "Viewer model for turning kernel read API data into trace spans and a reusable base viewer shell with app plugin slots."
concepts: [viewer, viewer-core, viewer-ui, viewer-shell, trace-spans, plugin-slots]
code-ref: packages/viewer-core/src/, packages/viewer-ui/src/, packages/viewer-shell/src/KernelTraceViewer.tsx
depends-on: [20-observability-model.md, 30-event-protocol.md]
---

# Viewer Model

The viewer is part of the kernel, not an optional demo. A new app should be able to render useful trace views before it builds custom workflow UI.

---

## Package Layers

| Package | Responsibility |
|---|---|
| `@agent-kernel/viewer-core` | API paths, DTOs, trace span transforms, linkage resolution |
| `@agent-kernel/viewer-ui` | Reusable trace tree, span cards, detail panels, visual utilities |
| `@agent-kernel/viewer-shell` | Mountable base trace viewer shell with plugin slots |

## Data Flow

```text
kernel read API response
  session/container metadata
  Pi sessions
  agent runs
  trace events
        |
        v
viewer-core buildTraceSpans()
        |
        v
viewer-ui TreeView + SpanDetailPanel
        |
        v
viewer-shell KernelTraceViewer
```

## Base Shell

`KernelTraceViewer` renders:

- optional app-provided container header
- trace level controls
- expand/collapse controls
- trace tree
- selected span detail panel
- empty and detail placeholder plugin slots

The v1 shell is intentionally narrow. It is enough to validate the package boundary and reuse the active Spectre trace page, while leaving room for deeper workflow panels later.

## App Plugins

Apps should extend the viewer through registered UI, not by forking the kernel viewer packages.

Spectre examples:

- a session header rendered above the trace tree
- spec, plan, build, or docs panels beside the trace viewer
- custom renderers for app-specific event payloads
- app badges for cost, branch, checkpoint, phase, or review status

If a workflow needs more control than the shell exposes, it can compose `viewer-ui` directly while still using `viewer-core` transforms and DTOs.
