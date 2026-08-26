---
covers: "Viewer shell structure: where the workspace, trace viewer, and style system live, and the seam decisions — data-plus-slots app seam, named extension seams, per-app style config, CSS-variable emission."
concepts: [viewer-shell, trace-workspace, kernel-trace-viewer, app-seam, style-system, style-rail, css-variables]
code-ref: packages/viewer-shell/src/
depends-on: [00-overview.md]
---

# Workspace and Shell

`@agent-kernel/viewer-shell` is what a host app mounts: `KernelTraceWorkspace` (`src/workspace/`), `KernelTraceViewer` (`src/KernelTraceViewer.tsx`), and the shared style system (`src/style/`).

Governed by: [10-system-design/40-viewer-model.md](../../10-system-design/40-viewer-model.md) — the workspace modes, the drill-in instrument, and the style-system behavior live there. This page records the seams.

---

## Composition seams

**Decision**: The workspace's app seam is pure data plus slots. Hosts supply `rows`, `selectedRowId`, `detail`, `spans`, and handlers; `labels`, `listExtras` (content under the list header), and `overlays` (content inside the workspace root) are the optional slots. Row → app-object matching, deletion rules, and fetching stay in the host. `statusClass` defaults to `defaultTraceStatusClass` (`workspace/KernelTraceWorkspace.tsx`), the union of both shipped hosts' status vocabularies.
**Why**: The rejected alternative — hosts forking the workspace, or the workspace calling back into host data layers — is how each app grows its own drifting copy. Data-and-slots keeps one workspace serving every host.
**Applies to**: `src/workspace/`, and any future workspace surface, which must take data and expose slots rather than reach into a host.

**Decision**: Hosts extend the trace viewer only through its named seams: `plugins` (container header, toolbar trailing content, empty state, detail placeholder), `detailBlockProvider` (additive data-only detail blocks), `usageContext`, `apiBase` (renderers fetch blobs and per-turn context when set, degrade to offline summaries when absent), `iconSide` / `iconStyle`, and optional controlled selection (`selectedId` / `onSelectedIdChange`).
**Why**: A host that needs more control composes `viewer-ui` directly (the design page's sanctioned path) — the rejected alternative of widening the shell's surface per host request would turn the shell into every host's union. A host never replaces the detail column.
**Applies to**: `src/KernelTraceViewer.tsx` props, and every seam added later, which must be data or a slot, never an override hook.

**Decision**: The drill-in split defaults to 40/60 tree/detail, with a draggable divider bounded to sane limits (`KernelTraceViewer.tsx`).
**Why**: Reading happens on the detail side, so it gets the majority by default; an even split — the rejected default — starves the surface the panel exists to serve.
**Applies to**: `src/KernelTraceViewer.tsx`.

## Style system seams

**Decision**: The style system lives in `viewer-shell/src/style/` — one rail shared by every host, extracted from the example app.
**Why**: The rejected status quo was a rail fork per app; every host composing the viewer packages now runs the same one.
**Applies to**: `src/style/` (settings, rail panel, overlay, rail state, `style-system.css`), and any new user-facing style control, which joins the rail rather than a host.

**Decision**: The per-app seam is `StyleSystemConfig` (`style/style-settings.ts`): each app names its own storage keys, default theme, visible rail sections, and — crucially — the neutral token *format* its Tailwind setup consumes (`"triplet"` for Tailwind v3 `rgb(var(--x)/<alpha>)`, `"hex"` for Tailwind v4 `@theme inline`). Viewer-only tokens (`status-*`, `trace-*`, `agentprism-*`) are always emitted as RGB triplets in every host. Every load/save/merge/emission entry point takes a config.
**Why**: Two hosts on different Tailwind majors cannot share one token format, and two apps must never bleed into each other's storage — a single global config, the rejected alternative, would do both.
**Applies to**: `src/style/`, and every future entry point that reads or writes style state, which must take the config rather than assume one.

**Decision**: Everything the style system produces is emitted as CSS variables that viewer classes consume with baked fallbacks; workspace layout geometry (`--research-workspace-height`, `-min-height`, `-header-height`, layout padding) is consumed the same way.
**Why**: A host that mounts nothing still gets the default look, and the rail's LAYOUT tab is meaningful in every host. Requiring host wiring — the rejected alternative — makes the default experience a setup task.
**Applies to**: `src/style/`, `src/workspace/`, and any new themable value.
