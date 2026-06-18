---
covers: "Viewer implementation packages: viewer-core DTOs and trace transforms, viewer-ui tree/detail components, and viewer-shell KernelTraceViewer with plugin slots."
type: overview
concepts: [viewer-core, viewer-ui, viewer-shell, trace-builder, kernel-trace-viewer, plugin-slots]
code-ref: packages/viewer-core/src/, packages/viewer-ui/src/, packages/viewer-shell/src/
depends-on: [../../10-system-design/40-viewer-model.md, ../50-read-api/00-overview.md]
---

# Viewer Packages

The viewer packages turn kernel trace read responses into a reusable UI.

---

## `@agent-kernel/viewer-core`

Viewer-core owns browser-safe data contracts and trace transforms:

- `KERNEL_TRACE_READ_PATHS`
- `KERNEL_OBSERVER_READ_PATHS`
- kernel trace DTOs
- registered kernel DTOs
- `buildTraceSpans(events, piSessions, agentRuns)`
- event pairing
- run bucketing
- phase grouping
- container grouping
- parent tool-call nesting
- span attributes and factories

This package should not import Drizzle schema or app DB types.

## `@agent-kernel/viewer-ui`

Viewer-ui owns reusable React components for trace rendering:

- `TreeView`
- `SpanCard`
- `SpanDetailPanel`
- trace filtering and lookup helpers
- style and theme helpers

It consumes viewer-core/protocol types and Agent Prism span types.

## `@agent-kernel/viewer-shell`

Viewer-shell exports `KernelTraceViewer`, the mountable base trace viewer. It renders a split tree/detail layout with:

- trace level filter
- expand/collapse all
- optional all-expanded initial state
- selected span state
- optional controlled selection
- plugin slots for container header, toolbar trailing content, empty state, and detail placeholder

## Current Scope

The current shell is a v1 base viewer extracted from Spectre's active trace page. It proves the package boundary and gives apps a day-zero trace UI.

Workflow-specific panes, richer plugin registries, and custom app event renderers can be added as the adapter needs become clearer.

## Styling Standard

Spectre is the reference UI for the kernel viewer. The shared viewer packages should stay aligned with the Spectre-iterated components, while host applications provide a Tailwind/theme layer that maps the Agent Prism token names used by the components.

Examples must use the shared viewer packages and generated Tailwind utilities from package source. They should not hand-write CSS shims for Tailwind class names.
