---
covers: "Viewer shell implementation: the KernelTraceWorkspace list/drill-in standard and its data-and-slots app seam, the KernelTraceViewer split layout and its props, and the shared style system (themes, color tokens, chrome controls, CSS-variable emission)."
concepts: [viewer-shell, trace-workspace, kernel-trace-viewer, app-seam, style-system, style-rail, color-tokens, theme, css-variables]
code-ref: packages/viewer-shell/src/
depends-on: [00-overview.md, 10-trace-card-design.md, 30-detail-panel.md]
---

# Workspace and Shell

`@agent-kernel/viewer-shell` is what a host app mounts. It owns two composition surfaces — the workspace and the trace viewer — plus the style system every host shares.

---

## KernelTraceWorkspace

The standard trace-viewing workspace, one component with two modes:

- **List mode** — full-width trace/session rows (title, status badge, meta, optional per-row delete) with an app slot below the header.
- **Drill-in mode** — a minimal header (back affordance · trace title · quiet status badge · overflow delete when the host allows deletes, and nothing else) over 100% of the width serving the span tree and detail panel.

There is deliberately **no workspace-level usage affordance** in drill-in: usage and runtime information live on the detail side, in the header-toggled Details view of the event that carries them.

The app seam is **pure data plus slots**: hosts supply `rows`, `selectedRowId`, `detail`, `spans`, and handlers; `labels`, `listExtras` (content under the list header), and `overlays` (content inside the workspace root) are optional. Row → app-object matching, deletion rules, and fetching stay in the host. `statusClass` defaults to `defaultTraceStatusClass`, the union of both shipped hosts' status vocabularies.

Layout geometry (`--research-workspace-height`, `-min-height`, `-header-height`, and layout padding) is consumed here with safe fallbacks, so the style rail's LAYOUT tab is meaningful in every host.

## KernelTraceViewer

The drill-in body: a **40/60 split** — tree left, detail right — with a draggable divider bounded to sane limits. Reading happens on the detail side, so it gets the majority by default. The tree toolbar and the detail header share one `h-12` panel-header surface, which is what makes the two columns read as one instrument.

Props worth knowing:

| Prop | Purpose |
| --- | --- |
| `spans` | built by viewer-core `buildTraceSpans()` |
| `selectedId` / `onSelectedIdChange` | optional controlled selection |
| `initialTraceLevel` | trace level filter start point (default 2) |
| `apiBase` | kernel read API base; renderers that reference content-addressed payloads fetch blobs and per-turn context when set, and degrade to offline summaries when absent |
| `usageContext` | workspace usage data so container / phase / session / run spans render a usage aggregate instead of dead-ending |
| `iconSide` / `iconStyle` | style-rail card chrome options, forwarded to every `SpanCard` |
| `detailBlockProvider` | additive, data-only blocks merged into the standard detail body ([30-detail-panel.md](30-detail-panel.md)) |
| `plugins` | container header, toolbar trailing content, empty state, detail placeholder |

A host extends the viewer through these seams, not by forking the packages. The detail-block provider is the sanctioned way to contribute app-specific content — a host never replaces the detail column.

## The Style System

`viewer-shell/src/style/` is the shared style system, extracted from the example app so every host composing the viewer packages runs **one** rail rather than a fork per app.

It ships two palettes driving the same semantic tokens: **light** (the doc-paper look derived from the state-shapes explainer, and the default) and **dark**. Controls are grouped into panel tabs a host can restrict:

- **Colors** — neutrals, editor tokens, trace accents (with `--status-warning` and `--destructive` marked *reserved · diagnostics*), tree caret/connector, selection highlight, code zebra.
- **Tree chrome** — band wash and border alphas, caret and connector opacities.
- **Selection** — ring opacity and width, selection bar width.
- **Code blocks** — zebra color and opacity.
- **Trace icons** — icon side and style.
- **Layout / effects** — workspace geometry, grain, bevel, softening.

Everything is emitted as CSS variables that the viewer classes consume with baked fallbacks, so a host that mounts nothing still gets the default look.

**The per-app seam is `StyleSystemConfig`.** Each app names its own storage keys, default theme, visible sections, and — crucially — the token *format* its Tailwind setup consumes for the shared-name neutrals:

- `"triplet"` — `--background: 27 27 28`, for Tailwind v3 `rgb(var(--x)/<alpha>)`
- `"hex"` — `--background: #1B1B1C`, for Tailwind v4 `@theme inline var(--x)`

Viewer-only tokens (`status-*`, `trace-*`, `agentprism-*`) are RGB triplets in every host and are always emitted as triplets. Because every load/save/merge/emission entry point takes a config, two apps never bleed into each other's storage and each keeps its own default look.
