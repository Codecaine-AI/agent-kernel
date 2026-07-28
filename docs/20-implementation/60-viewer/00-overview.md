---
covers: "Viewer implementation packages: viewer-core DTOs, causal event ordering, turn nesting and trace transforms; viewer-ui tree cards, detail panel and prompt lab; viewer-shell workspace, trace viewer and shared style system."
type: overview
concepts: [viewer-core, viewer-ui, viewer-shell, trace-builder, event-order, turn-nesting, detail-panel, trace-workspace, style-system, plugin-slots]
code-ref: packages/viewer-core/src/, packages/viewer-ui/src/, packages/viewer-shell/src/
depends-on: [../../10-system-design/40-viewer-model.md, ../50-read-api/00-overview.md]
---

# Viewer Packages

The viewer packages turn kernel trace read responses into a reusable UI: viewer-core builds spans, viewer-ui renders them, viewer-shell composes the whole instrument for a host app.

---

## `@agent-kernel/viewer-core`

Browser-safe data contracts and trace transforms:

- `KERNEL_TRACE_READ_PATHS`, `KERNEL_CATALOG_PATHS`, `KERNEL_OBSERVER_READ_PATHS`
- kernel trace DTOs; catalog DTOs (`catalog-types.ts`)
- `buildTraceSpans(events, piSessions, agentRuns, containers)`
- **canonical event ordering** (`eventOrder.ts`) — the read API orders by `(timestamp, eventId)`, but timestamps are millisecond-precision and event ids are content-derived, so same-millisecond events tie and then order arbitrarily. `buildTraceSpans` re-sorts once up front on timestamp → turn number (when both events carry one) → causal type rank (the emitter's actual within-cycle firing order) → event id. Every downstream sort keys on `startTime` with a stable sort, so this order survives the pipeline.
- **turn nesting** (`nesting.ts`) — folds each turn's tool calls, UI asks, and assistant replies under the `pi_request_snapshot` ("Turn N") span that issued them. Ownership is *causal*, not attribute-based, because tool events carry no turn number: after the canonical sort, a span belongs to the most recent preceding Turn span. Traces with no snapshot spans return unchanged, so agents without the state extension and older traces keep the flat shape. The module also folds `pi_turn_end` usage onto its matching Turn span (without consuming the debug event), groups context inputs under their build, wraps provisioning spans, and resolves spawner dispatch to its nested session by explicit tool-use id rather than timestamp containment.
- event pairing, run bucketing (envelope `runId` preferred, span-window inference as fallback), phase grouping, container grouping, parent tool-call nesting
- span attributes and factories — including the request snapshot's `sections` attribute, serialized as a JSON string for the offline fallback ([../20-kernel/70-request-snapshots.md](../20-kernel/70-request-snapshots.md))
- `diffPromptDocuments(a, b)` — block-level structural diff keyed by stable node ids

This package must not import Drizzle schema or app DB types. A byte-exact characterization snapshot pins its output; styling work must never move it.

## `@agent-kernel/viewer-ui`

Reusable React components:

- `TreeView`, `SpanCard` and its variants, the icon system — see [10-trace-card-design.md](10-trace-card-design.md)
- `SpanDetailPanel` and the `detail-panel/` system: the shell, the data-only renderer contract, the shared code-block component, the Turn body, and the Details takeover — see [30-detail-panel.md](30-detail-panel.md)
- `AgentCatalogViewer`, `PromptInlineLab`, `RevisionHistoryPanel`, `RevisionStatsStrip`, `AgentPromptLabContainer` — the prompt lab, see [20-prompt-editor-design.md](20-prompt-editor-design.md)
- `DoctorPanel`, `UsageStrip`, `UsageSummaryPanel`, trace filtering and lookup helpers

It consumes viewer-core/protocol types, prompt-kit documents, and Agent Prism span types.

## `@agent-kernel/viewer-shell`

What a host mounts: `KernelTraceWorkspace` (list and drill-in), `KernelTraceViewer` (the 40/60 tree + detail split), and the shared style system — see [40-workspace-shell.md](40-workspace-shell.md).

## Design Records

The viewer's UX decisions — including the alternatives that were considered and rejected — live as explainers under [`docs/10-system-design/explainers/`](../../10-system-design/explainers/): `detail-view-options.html` (the detail-panel layout standard, the audit behind it, and the three directions) and `state-tab-options.html` (the State tab's postures, and the index rail and focus posture that were cut on review). The implementation docs here describe what is built; the explainers say why.

## Child Nodes

### [10-trace-card-design.md](10-trace-card-design.md)
The trace tree and card system: TraceCard anatomy, the band color system, connector geometry, icons, typography, and style-rail knobs.

### [20-prompt-editor-design.md](20-prompt-editor-design.md)
The Agent XML prompt editor: surface contract, block and keyboard editing, undo model, and save flow.

### [30-detail-panel.md](30-detail-panel.md)
The detail panel: layout standard, renderer contract, block vocabulary, doc-figure and clamp policies, the Turn body, Details takeover, Escape ladder, and extension seam.

### [40-workspace-shell.md](40-workspace-shell.md)
The workspace and trace viewer composition surfaces, and the shared style system.
