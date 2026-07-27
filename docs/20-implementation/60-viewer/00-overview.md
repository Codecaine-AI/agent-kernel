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

- `KERNEL_TRACE_READ_PATHS`, `KERNEL_CATALOG_PATHS`, `KERNEL_OBSERVER_READ_PATHS`
- kernel trace DTOs
- catalog DTOs (`catalog-types.ts`): agent summaries/detail, prompt save results, revision summaries, revision stats
- `buildTraceSpans(events, piSessions, agentRuns, containers)`
- event pairing
- run bucketing — envelope `runId` preferred, span-window inference as fallback
- phase grouping
- container grouping from explicit `containerId` values and persisted container summaries
- parent tool-call nesting
- span attributes and factories
- `diffPromptDocuments(a, b)` — block-level structural diff between two prompt revisions, keyed by stable node ids (inserted / removed / moved / edited; no text diffing)

This package should not import Drizzle schema or app DB types.

## `@agent-kernel/viewer-ui`

Viewer-ui owns reusable React components for trace rendering and the prompt lab:

- `TreeView`
- `SpanCard`
- `SpanDetailPanel` — including the per-turn request-snapshot renderer and its three-section turn view (see [../20-kernel/70-request-snapshots.md](../20-kernel/70-request-snapshots.md))
- `AgentCatalogViewer`
- `PromptInlineLab` — inline prompt editor with transactional undo/redo (block edits and metadata edits share one stack, and undo works across a save boundary) and a save flow against the catalog API
- `RevisionHistoryPanel` — revision list with block-level diffs between any two revisions via `diffPromptDocuments`
- `RevisionStatsStrip` — per-revision run analytics (runs, tokens, failures, cost) fetched from the revision stats route
- `AgentPromptLabContainer` — wires the lab, history, and stats over `KERNEL_CATALOG_PATHS`
- trace filtering and lookup helpers
- style and theme helpers

It consumes viewer-core/protocol types, prompt-kit documents, and Agent Prism span types.

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
