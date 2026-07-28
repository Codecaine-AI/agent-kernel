---
covers: "Trace tree and card system: TraceCard anatomy and the single row size, the band color system and its reserved status hues, connector geometry, icon kinds and cap treatment, typography, width behavior, and the style-rail knobs that tune all of it."
type: reference
concepts: [trace-card, span-card, band-system, group-accent, icon-cap, connector-geometry, type-scale, style-rail, nucleo-icons, selection-treatment]
code-ref: packages/viewer-ui/src/trace-viewer/SpanCard/, packages/viewer-ui/src/trace-viewer/icons/, packages/viewer-shell/src/style/
depends-on: [./00-overview.md]
---

# Trace Tree and Card System

Every span in the trace tree renders as one object — a **TraceCard**. This doc records the decisions behind that system so styling work doesn't re-litigate them, and so new variants stay inside the rules.

---

## Card anatomy: one frame, one row size

`SpanCard/TraceCard.tsx` owns the single anatomy every variant renders into: a card frame with an **integrated icon cap** whose divider is part of the frame — the cap is connected to the card, never floating.

| Size | Used for | Cap placement |
| --- | --- | --- |
| `line` | single-line spans (tool, agent, turn, lifecycle…) | full-height end cell, flush left or right |
| `box` | multi-line messages (user, assistant) | pinned top-left corner *inside* the border |

**There is exactly one row size.** The old reduced `meta` variant was removed so it cannot regress: info/debug rows wear the same cap size and type scale as every other row. `CARD_TYPE_META` survives only for secondary chips *inside* a row, never as a row's own size.

Decisions baked into the frame:

- **Box caps always anchor top-left**, even when the style rail sets icon side to "right". A top-right cap makes the eye hit wrapped body text before the type marker; `side` only steers the inline end caps (`icons/SpanIconCap.tsx`).
- **Caps are square** — 22px (`SPAN_CAP_SIZE`). Don't stretch a cap to solve an alignment problem; fix the text side instead.
- **Box-card first-line alignment invariant**: the 22px corner cap centers its glyph at y=11, so message bodies carry **no top padding** — the first line box (13px at `leading-relaxed` ≈ 21px) sits flush to the frame and centers within 0.5px of the glyph. Stable under any mono font *family*; only a font-*size* change could break it, and the type scale forbids that.

Variants (`SpanCard/variants/`) supply content only. Chrome — cap kind, group, side, style — is resolved once in `SpanCard.tsx` and threaded through as a `SpanCardChrome` bundle.

## Color: bands, four categories, reserved status

`icons/resolve-span-icon.tsx` is the single source of truth. A span's display type and status resolve to an icon kind, a semantic **group**, and the Tailwind utilities the card wears (`GROUP_ACCENT`).

Kind-colored cards are doc-style **bands**: the entire card border in the kind hue at reduced alpha, plus a subtle wash (~10%) of the same hue.

| Category | Group(s) | Treatment |
| --- | --- | --- |
| Conversation | `user` (blue `--trace-user`), `assistant` (green `--trace-assistant`) | band |
| Tool | `tool` — tool calls/results and spawner dispatch (orange `--trace-tool`) | band |
| Context | `context` — turn snapshots, context build, system prompt (violet, reusing `--trace-orchestration`) | band |
| Lifecycle | `orchestration`, `lifecycle`, `meta` — agents, runs/sessions, containers, provisioning, info/debug | neutral hairline, **no wash** |
| Status | `warning` (amber), `error` (red) | full-strength border + wash |

Rules:

- **Loudness is monotonic and must stay that way**: neutral plumbing < kind band < selection < status. Status is the loudest thing in the tree.
- **Amber and red are reserved for diagnostics.** Status overrides type, and those are the only paths that reach them. `icons/span-icons.test.tsx` enforces it.
- **Violet means context, exclusively.** Orchestration cards are neutral now, so the token is reused rather than the meaning shared.
- **Selection treatment lives on the card** — an inset ring plus a light fill that overrides any band wash, driven by `--selection-*` tokens with baked fallbacks. The row contributes only the gutter bar.
- **Token ownership crosses the package boundary on purpose**: viewer-ui emits only Tailwind utilities; the values are host theme tokens (`--trace-*`), now supplied by the shared style system in viewer-shell (see [40-workspace-shell.md](40-workspace-shell.md)). Band alphas are themselves tokens (`--band-border-opacity`, `--band-wash-opacity`) with baked fallbacks, so a host without the vars keeps the default look.

## Connector geometry

`SpanCard/SpanCardConnector.tsx` is the single source of truth for the tree's indent guides — deliberately quiet: hairline width, softened tint, always below the cards in the hierarchy.

The geometry contract: **every cell is a fixed 24px column** (`w-6 shrink-0`, never grow). Cell *k* spans x ∈ [k·24, (k+1)·24) with its centerline at k·24 + 12 — the same 24px step the content indent derives from ((depth + 1) · 24, with the toggle slot always reserved). Line positions and content offsets therefore come from one formula. A stretching cell would drift lines off-grid on rows whose toggle slot is empty, which is the bug class `span-indent.test.tsx` pins by SSR audit.

Cell kinds: `vertical` (ancestor guide, extended 12px into the row gap so runs stay continuous), `t-right` (this row's elbow, siblings follow), `corner-top-right` (last child's elbow, nothing paints below the centerline), `horizontal` (continuation across a column — leaf rows carry the elbow stub across the empty toggle slot), `empty` (reserved, nothing painted).

## Icons

`icons/nucleo-icons.tsx` holds the licensed Nucleo glyphs, each with an **outline and a fill variant** so the cap treatment switches without swapping metaphors:

- outline cap → transparent cell, accent divider, outline glyph in the accent
- solid cap → cell filled with the accent, fill glyph knocked out to the card background

One glyph per meaning, distinguishable at 13px by shape alone: **window** = a turn's context window · **layers** = context assembly (build / system prompt) · wrench = tool · person = user · chat = assistant · robot = agent · paper-plane = dispatch · play = run · flag = phase · cube = container · database = provisioning.

**Gears mean lifecycle/plumbing only** — nothing content-bearing wears a gear. Lifecycle spans get finer glyphs from their label (provisioning / phase / run); error and warning status override everything for scannability.

The detail panel reuses this resolver for its message cards, so a role reads the same in both surfaces by construction (see [30-detail-panel.md](30-detail-panel.md)); cap options reach it through `icons/icon-settings.tsx` rather than a prop path.

## Typography: mono, exactly three sizes

`SpanCard/variants/card-type.ts` defines the only three type styles card text may use, all pinning `font-mono`:

- `CARD_TYPE_LABEL` — 13px/18px, card titles and single-line card text (every tree row, one size)
- `CARD_TYPE_BODY` — 13px/relaxed, multi-line message bodies
- `CARD_TYPE_META` — 11px/14px, secondary inline chips *inside* a row

Nothing else in the trace viewer sets a size on card text. Prose/sans stacks sneaking in at ad-hoc sizes is the failure mode this exists to prevent.

## Width: cards use the panel, content decides

There is **no fixed width budget**. An earlier design clamped card content to 320px minus 24px per tree depth, starving deep spans while the panel sat empty; it was removed deliberately — don't reintroduce one.

- The tree grid hands the content column all remaining width; **line cards** are `inline-flex` + `max-w-full`, so they grow to fit content and truncating detail chips ellipsize at the panel edge.
- **Box cards** are `w-fit` so short messages hug their content instead of stretching an empty frame; `max-w-[90%]` bounds long ones. Message content is truncated upstream (`MAX_CONTENT_LENGTH`) with a `line-clamp-5` visual guard.

## User-facing knobs

Presentation options users may reasonably disagree on are **rail knobs, not code forks**, and the rail now lives in `@agent-kernel/viewer-shell` so every host shares one. Card-relevant knobs: icon side and style, band wash/border alphas, caret and connector opacities, selection color/opacity/ring width, and the code-block zebra color and opacity. Values arrive as CSS variables and as `SpanCardViewOptions` (`iconSide` / `iconStyle`); the package takes options, the shell owns persistence and UI.

Icon Style changes only the cap fill, not the card frame — a deliberately subtle toggle.

## Hard constraints for styling work

- **Never change viewer-core trace-builder semantics.** The byte-exact characterization snapshot (`packages/viewer-core/src/trace-builder/__snapshots__/`) must not move from styling work. Styling lives in viewer-ui / viewer-shell / the host app.
- Gate every change on `bun test ./packages/viewer-ui/src ./packages/viewer-core/src`, `bun run typecheck`, and `bun run test:boundaries`.
- Verify visually in a real browser, in **both** icon styles and **both** themes, at narrow and wide panel widths.
