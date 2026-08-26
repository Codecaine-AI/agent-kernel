---
covers: "Viewer implementation area: the three-package split, structural decisions governing viewer-core transforms, viewer-ui components, and the cross-package style/token boundaries."
type: overview
concepts: [viewer-core, viewer-ui, viewer-shell, trace-builder, renderer-registry, doc-figure, vertical-slices, style-tokens]
code-ref: packages/viewer-core/src/, packages/viewer-ui/src/, packages/viewer-shell/src/
depends-on: [../../10-system-design/40-viewer-model.md, ../50-read-api.md]
---

# Viewer Packages

The viewer implementation spans three packages: `packages/viewer-core` (browser-safe data contracts and trace transforms), `packages/viewer-ui` (reusable React components), `packages/viewer-shell` (what a host mounts — composition surfaces and the shared style system, see [40-workspace-shell.md](40-workspace-shell.md)).

Governed by: [10-system-design/40-viewer-model.md](../../10-system-design/40-viewer-model.md) — the viewer's behavior, layout standards, and extension contracts. This page records only how the code is organized and why.

---

## Package boundaries

**Decision**: The viewer is three packages — core (data), ui (components), shell (composition + style) — not one.
**Why**: A host that only needs transforms and DTOs (a custom workflow UI, the observer) must not pull React components; a host composing `viewer-ui` directly must not inherit shell chrome. One merged package — the rejected alternative — makes every consumer carry everything.
**Applies to**: `packages/viewer-core/`, `packages/viewer-ui/`, `packages/viewer-shell/`, and any future viewer code, which joins the layer matching what it exports.

**Decision**: `viewer-core` is browser-safe by construction: it never imports Drizzle schema, `@agent-kernel/db`, or app DB types. Its API surface is path constants (`KERNEL_TRACE_READ_PATHS`, `KERNEL_CATALOG_PATHS`, `KERNEL_OBSERVER_READ_PATHS` in `api.ts`), DTOs (`catalog-types.ts` and the trace DTOs), and pure transforms (`buildTraceSpans`, `diffPromptDocuments`).
**Why**: Viewers read through APIs that return viewer-core DTOs (the design page's rule); a direct DB import — the rejected shortcut — would silently couple browser bundles to server schema.
**Applies to**: everything under `packages/viewer-core/src/`.

**Decision**: viewer-ui emits only Tailwind utilities; color *values* are host theme tokens (`--trace-*`, `--selection-*`, band alphas as `--band-*` tokens) supplied by viewer-shell's style system, always with baked fallbacks.
**Why**: Hosts must retheme without forking components. Baking values into viewer-ui — the rejected alternative — makes every theme change a package release. The token ownership crosses the package boundary on purpose.
**Applies to**: all styled components in `packages/viewer-ui/src/`, token emission in `packages/viewer-shell/src/style/`.

**Decision**: Presentation knobs travel as options and CSS variables — `SpanCardViewOptions` is defined in viewer-ui (`SpanCard.tsx`) and consumed by the shell; persistence and rail UI live only in viewer-shell.
**Why**: The packages stay host-agnostic; per-host forks or prop-drilled preference plumbing (rejected) were how earlier hosts diverged. Where a surface has no prop path from the host (the detail panel's message cards), options reach it through `icons/icon-settings.tsx` rather than a new prop chain.
**Applies to**: every user-tunable presentation option, current and future.

## viewer-core structure

**Decision**: One canonical event sort, applied once at the top of `buildTraceSpans` (`trace-builder/eventOrder.ts`); every later stage sorts stably on `startTime` and never re-orders otherwise.
**Why**: The ordering semantics (timestamp → turn number → causal rank → event id, see the design page) must hold at every zoom. Per-consumer re-sorting — the rejected alternative — lets each surface resolve same-millisecond ties differently.
**Applies to**: `trace-builder/`, any new transform stage.

**Decision**: All span folding lives in `trace-builder/nesting.ts` — turn ownership, usage folding, context-input grouping, provisioning wrapping, dispatch resolution — as post-sort passes over the span list.
**Why**: Nesting is causal, so it is only correct *after* the canonical sort; scattering fold logic into per-span factories (rejected) would re-derive order locally and drift.
**Applies to**: `trace-builder/nesting.ts` and any future folding rule.

**Decision**: A byte-exact characterization snapshot (`trace-builder/__snapshots__/characterization.test.ts.snap`) pins trace-builder output. Styling work must never move it — styling changes land in viewer-ui, viewer-shell, or the host, never in viewer-core semantics.
**Why**: It separates semantic changes (rare, reviewed against the snapshot) from presentation churn (frequent). Trusting unit tests alone — the rejected alternative — let semantic drift ride in on styling PRs.
**Applies to**: every change touching `packages/viewer-core/src/trace-builder/`.

## viewer-ui structure

**Decision**: Card chrome — cap kind, group, side, style — is resolved once in `trace-viewer/SpanCard/SpanCard.tsx` and threaded to variants as a `SpanCardChrome` bundle; variants (`SpanCard/variants/`) supply content only.
**Why**: Per-variant chrome (rejected) is how row anatomies drift apart. A new variant gets the standard frame for free and cannot opt out.
**Applies to**: `SpanCard/variants/`, including variants not yet written.

**Decision**: `trace-viewer/icons/resolve-span-icon.tsx` is the single resolver from display type + status to icon kind, semantic group, and accent utilities; every surface that shows role or kind color resolves through it (the detail panel's message stream included). `icons/span-icons.test.tsx` enforces the reserved-status rule.
**Why**: Duplicated hue tables (rejected) are how the tree and the panel stop agreeing on what blue means.
**Applies to**: `icons/`, and any new surface rendering span identity.

**Decision**: The card type scale lives only in `SpanCard/variants/card-type.ts` (`CARD_TYPE_LABEL` / `CARD_TYPE_BODY` / `CARD_TYPE_META`); connector geometry lives only in `SpanCard/SpanCardConnector.tsx`, pinned by `span-indent.test.tsx`; cap sizing lives in `icons/SpanIconCap.tsx` (`SPAN_CAP_SIZE`).
**Why**: Each visual constant has exactly one owner module so the design page's invariants (three sizes, fixed 24px cells, square caps) have one place to be violated and one test to catch it. Ad-hoc local constants were the rejected default.
**Applies to**: all trace-tree rendering code.

**Decision**: Detail renderers are data-only functions registered in `trace-viewer/detail-panel/rendererRegistry.ts`; the registry is exported, and `contract-conformance.test.tsx` iterates it. The contract types and `BLOCK_SLOT_ORDER` live in `detail-panel/contract.ts`; the host seam is the `DetailBlockProvider` type with its `DetailBlocksProvider` context (`detail-panel/blocks.ts`).
**Why**: Registry-driven conformance (vs a manually maintained test list, rejected) means a renderer added later is covered without touching the test — the contract enforces itself on unwritten code.
**Applies to**: `detail-panel/renderers/`, every future renderer and extension block source.

**Decision**: `detail-panel/doc-figure/` is the single data-block substrate app-wide (figure, `tokenize.ts`, `Clamped.tsx`); JSON canonicalization sits beside the renderers (`renderers/json-document.ts`), and the primary-figure clamp constant is `renderers/primary-figure.ts`, stamped by `renderers/TurnBody.tsx`.
**Why**: Byte-exactness, gutter, zebra, and clamp behavior are contracts (design page); one substrate means one place they can break. Per-surface code blocks were the rejected pattern.
**Applies to**: any surface rendering source text, including future tabs and renderers, which inherit the primary-figure policy from the Turn body rather than naming it.

**Decision**: viewer-ui keeps a local structural mirror of the request-snapshot section-tag type (`RequestSectionTag` / `RequestSectionKind` in `detail-panel/renderers/turn-sections.ts`) rather than importing the canonical type from `@agent-kernel/protocol` (`PiRequestSnapshotData`). The shapes are intentionally identical, and snapshots without tags parse to `null` so the renderer falls back to the flat context list.
**Why**: viewer-ui must stay buildable against protocol versions that predate the field. Importing the protocol type directly — the rejected alternative — couples viewer-ui builds to protocol version.
**Applies to**: `detail-panel/renderers/turn-sections.ts`, and any future viewer type mirroring an optional protocol field.

**Decision**: Viewer components are vertical slices: a folder named for the component with a thin index composition root and responsibility-named siblings; external import specifiers resolve through the folder index, so restructuring is invisible to consumers. Single-responsibility modules stay flat files — folderizing for symmetry is an anti-pattern.
**Why**: The alternative — shared-by-layer folders (`components/`, `hooks/`, `utils/`) — scatters one component's parts and makes deletion unsafe.
**Applies to**: `agent-viewer/AgentCatalogViewer/` (the exemplar) and every new multi-file component.

**Decision**: Prompt-rendering surfaces build on prompt-kit's shared editor surface: the editor tokens are defined once in `@codecaine-ai/prompt-kit` (`ui/surface/editor-surface.ts`), and the inline lab (`PromptInlineLab`) is re-exported from prompt-kit rather than reimplemented; viewer-ui adds the kernel-facing shells (`AgentCatalogViewer`, `AgentPromptLabContainer`, `RevisionHistoryPanel`, `RevisionStatsStrip`).
**Why**: Every prompt view sharing one token source is what keeps views from drifting (the fidelity contract); a viewer-local token copy or lab fork (rejected) would drift on the first edit.
**Applies to**: `agent-viewer/`, and any new prompt-rendering surface.

## Roster

- `viewer-core` — path constants, DTOs, `buildTraceSpans`, event ordering, nesting, run bucketing, `diffPromptDocuments`
- `viewer-ui` — `TreeView`, `SpanCard` + variants, the detail panel, the agent viewer / prompt lab shells, `DoctorPanel`, usage panels, trace filtering helpers
- `viewer-shell` — `KernelTraceWorkspace`, `KernelTraceViewer`, the shared style system ([40-workspace-shell.md](40-workspace-shell.md))
