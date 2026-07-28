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
| `@agent-kernel/viewer-core` | App trace API paths, catalog API paths, central observer API paths, DTOs, trace span transforms, linkage resolution, prompt diffing |
| `@agent-kernel/viewer-ui` | Reusable trace tree, span cards, the detail panel and its renderer contract, prompt lab components, visual utilities |
| `@agent-kernel/viewer-shell` | Mountable workspace + trace viewer, plugin slots, and the shared style system |

App-embedded viewers and a future central observer should both read through APIs that return viewer-core DTOs. Browser code should not connect directly to the kernel database.

## Data Flow

```text
kernel read API response
  session/container metadata
  container summaries
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

Container summaries are part of the trace shape, not decoration. Events and
agent spans with explicit `containerId` values should render under the matching
container lineage even when persisted container timestamps tie or app workflow
events have no Pi session.

Run bucketing prefers the explicit envelope `runId` when an event carries one;
run-window inference by span pairing is the fallback for events emitted
without run identity. Relationships that were emitted explicitly are never
re-derived from timestamps.

## Prompt Lab

The viewer also fronts the kernel catalog API (`KERNEL_CATALOG_PATHS`):
registry listing, agent detail, prompt saves and manifest edits (both
dev-gated), model aliases, revision history, and per-revision run stats.
`viewer-core` supplies the browser-safe catalog DTOs and
`diffPromptDocuments` — a block-level structural diff keyed by stable node
ids, no text diffing.

`viewer-ui` builds the agent viewer on top as a strict three-column shell:
agent selector, the Agent XML editor (the only editing surface — a code-editor
view of exactly what the agent receives, with Notion-style block/keyboard
editing and transactional single-step undo), and an always-present sidebar
stacking agent identity (editable model/description), view scope, editor
controls, block details, and revision history with per-revision run stats.
The full design rationale lives in
[20-prompt-editor-design.md](../20-implementation/60-viewer/20-prompt-editor-design.md).

## Base Shell

`viewer-shell` ships the whole trace-viewing instrument, not a demo:

- `KernelTraceWorkspace` — the standard list / drill-in workspace, with a pure data-and-slots app seam
- `KernelTraceViewer` — the drill-in body: a 40/60 draggable tree + detail split sharing one panel-header surface, trace level and expand controls, and plugin slots
- the shared style system — light/dark palettes, color tokens, tree chrome, selection and code-block controls, emitted as CSS variables per host config

Implementation: [40-workspace-shell.md](../20-implementation/60-viewer/40-workspace-shell.md).

The detail side has one layout standard for every event type — a fixed header over a body composed only from a standard block vocabulary — and per-type renderers return **data, not JSX**, so they cannot introduce competing chrome. That contract, and the conformance test that enforces it, is in [30-detail-panel.md](../20-implementation/60-viewer/30-detail-panel.md); the design record and the rejected alternatives are in `explainers/detail-view-options.html` and `explainers/state-tab-options.html`.

## App Plugins

Apps should extend the viewer through registered UI, not by forking the kernel viewer packages.

Spectre examples:

- a session header rendered above the trace tree
- spec, plan, build, or docs panels beside the trace viewer
- custom renderers for app-specific event payloads
- app badges for cost, branch, checkpoint, phase, or review status

If a workflow needs more control than the shell exposes, it can compose `viewer-ui` directly while still using `viewer-core` transforms and DTOs.
