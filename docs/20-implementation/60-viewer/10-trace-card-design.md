---
covers: "Trace-viewer card design system: TraceCard anatomy, semantic color groups, the reserved amber/red rule, type scale, Nucleo icon caps, width behavior, and the style-rail knob pattern."
type: reference
concepts: [trace-card, span-card, icon-cap, color-groups, type-scale, style-rail, nucleo-icons]
code-ref: packages/viewer-ui/src/trace-viewer/SpanCard/, packages/viewer-ui/src/trace-viewer/icons/, examples/simple-research-kernel/src/styles.css
depends-on: [./00-overview.md]
---

# Trace Card Design System

Every span in the trace tree renders as one object — a **TraceCard** — at one of
three scales. This doc records the decisions behind that system so styling work
doesn't re-litigate them, and so new variants stay inside the rules.

The system was unified in commit `058e923`; width behavior, cap alignment, and
the open design questions below evolved on `kernel-overhaul` after it.

---

## Card anatomy: one frame, three sizes

`SpanCard/TraceCard.tsx` owns the single anatomy every variant renders into: a
group-colored border frame with an **integrated icon cap** whose divider is
part of the frame — the cap is connected to the card, never floating.

| Size   | Used for                                      | Cap placement |
| ------ | --------------------------------------------- | ------------- |
| `line` | single-line spans (tool, agent, lifecycle…)   | full-height end cell, flush left or right |
| `box`  | multi-line messages (user, assistant)         | pinned top-left corner *inside* the border |
| `meta` | info/debug mini-cards                         | same as line, reduced (18px cap, 11px glyph) |

Decisions baked into this:

- **Box caps always anchor top-left**, even when the style rail sets icon side
  to "right". A top-right cap makes the eye hit wrapped body text before the
  type marker; `side` only steers the inline end caps
  (`icons/SpanIconCap.tsx`).
- **Caps are square** — 22px (`SPAN_CAP_SIZE`), 18px meta. Don't stretch a cap
  to solve an alignment problem; fix the text side instead (see next point).
- **Box-card first-line alignment invariant**: the 22px corner cap centers its
  glyph at y=11. Message bodies therefore carry **no top padding** — the first
  line box (13px at `leading-relaxed` ≈ 21px) sits flush to the frame and
  centers within 0.5px of the glyph. This is stable under any mono font
  *family* (line-height is em-based on the pinned size); only a font-*size*
  change could break it, and the type scale forbids that.

Variants (`SpanCard/variants/`) supply content only. Chrome — cap kind, group,
side, style — is resolved once in `SpanCard.tsx` and threaded through as a
`SpanCardChrome` bundle.

## Color: semantic groups, one hue each

Color carries meaning. Every card keys its border, cap, and accents off exactly
**one group**, so the eye can read span type by hue
(`icons/resolve-span-icon.tsx` is the single source of truth for the mapping):

| Group           | Hue                | Spans |
| --------------- | ------------------ | ----- |
| `orchestration` | violet `#A78BFA`   | agents, spawner dispatch, runs/sessions |
| `user`          | blue `#60A5FA`     | user messages, ui_ask |
| `assistant`     | green `#54D693`    | assistant messages |
| `tool`          | cyan `#54D3E0`     | tool calls |
| `lifecycle`     | gray `#949EAC`     | system / provisioning / phases / containers |
| `meta`          | gray (muted)       | info/debug fallback rows |
| `warning`       | amber — RESERVED   | warning status only |
| `error`         | red — RESERVED     | error status only |

Rules:

- **Amber and red are reserved for diagnostics.** Status overrides type: an
  error/warning span flips to the reserved group regardless of what it is, and
  those are the *only* paths that reach amber/red.
  `icons/span-icons.test.tsx` ("amber/red are reserved…") enforces this — if a
  new group or variant renders amber/red, that test must fail.
- All non-diagnostic hues are deliberately **cool** (green→violet, 145°–250°)
  so warm colors always mean "look here". The closest pairs (user-blue vs
  tool-cyan, assistant-green vs tool-cyan) are additionally disambiguated by
  shape: messages are boxes, tools are lines.
- **Token ownership crosses the package boundary on purpose**: viewer-ui only
  emits Tailwind utilities (`text-trace-*`, `border-trace-*`, via
  `GROUP_ACCENT`). The values live in the *host* theme — the example app
  defines `--trace-*` RGB triples in
  `examples/simple-research-kernel/src/styles.css` and maps them in its
  `tailwind.config.cjs`. Retuning a hue is a one-token swap in the host; the
  package never hardcodes a color.

## Typography: mono, exactly three sizes

The trace viewer speaks one voice — machine mono, matching the tree labels.
`SpanCard/variants/card-type.ts` defines the only three type styles card text
may use:

- `CARD_TYPE_LABEL` — 13px/16px, titles and single-line card text
- `CARD_TYPE_BODY` — 13px/relaxed, multi-line message bodies
- `CARD_TYPE_META` — 11px/14px, info/debug mini-cards (muted)

Nothing else in the trace viewer sets a size on card text. Prose/sans stacks
sneaking in at ad-hoc sizes is the failure mode this exists to prevent.

## Icons: Nucleo glyphs, outline + fill pairs

`icons/nucleo-icons.tsx` holds 13 licensed Nucleo glyphs (source SVGs in
`icons/nucleo-src/`; the full licensed set lives outside the repo). Each kind
has an **outline and a fill variant** so the cap treatment can switch without
swapping metaphors:

- outline cap → transparent cell, accent divider, outline glyph in accent
- solid cap → cell filled with the accent, **fill** glyph knocked out to the
  card background

Kind resolution (`resolve-span-icon.tsx`): display type picks the glyph;
lifecycle spans get finer glyphs from their label (provisioning / phase / run);
error/warning status overrides everything for scannability.

## Width: cards use the panel, content decides

There is **no fixed width budget**. An earlier design clamped card content to
320px minus 24px per tree depth, which starved deep spans (~176px) while the
panel sat empty; it was removed deliberately — don't reintroduce one.

- The tree grid hands the content column all remaining width; **line cards**
  are `inline-flex` + `max-w-full`, so they grow to fit content and truncating
  detail chips ellipsize at the panel edge (no fixed pixel caps on chips).
- **Box cards** are `w-fit` so short messages hug their content instead of
  stretching an empty frame; `max-w-[90%]` bounds long ones. Message content
  is truncated at 200 chars upstream (`MAX_CONTENT_LENGTH`) with a
  `line-clamp-5` visual guard.

## User-facing knobs: the style rail pattern

Presentation options users may reasonably disagree on are **rail knobs, not
code forks**. The example app's settings rail
(`examples/simple-research-kernel/src/_components/style/`,
`src/lib/style-settings.ts`) persists to localStorage
(`simpleResearchStyleSettings.v1`) and currently exposes under "Trace Icons":

- **Icon Side** — left / right (inline caps only; box caps stay top-left)
- **Icon Style** — outline / solid (default: outline)

The knob values flow into viewer-ui as `SpanCardViewOptions`
(`iconSide` / `iconStyle`) — the package takes options, the host owns
persistence and UI. New visual options follow the same path: add the setting +
normalizer in `style-settings.ts`, a control in `StyleSettingsPanel.tsx`, and
thread it through view options.

Note the scope honestly: Icon Style changes **only the cap fill**, not the
card frame. It is a subtle toggle by design (so far — see open questions).

## Hard constraints for styling work

- **Never change viewer-core trace-builder semantics.** A byte-exact
  characterization snapshot
  (`packages/viewer-core/src/trace-builder/__snapshots__/`) must not move from
  styling work. Styling lives in viewer-ui / viewer-shell / the example app.
- Gate every change on:
  `bun test ./packages/viewer-ui/src ./packages/viewer-core/src`,
  `bun run typecheck`, `bun run test:boundaries`.
- Verify visually in a real browser (the example app), in **both** icon
  styles, at both narrow and wide panel widths.

## Open design questions (as of 2026-07-03)

Deliberately undecided; propose before changing:

1. **Solid caps as default?** Solid scans better on dark (filled chips read as
   legend markers; warnings pop); outline is quieter. Default is still
   outline.
2. **Whole-card style toggle** — a proposed "Card Style" rail knob: *Raised*
   (filled card background, solid cap, hard offset shadow — the "minesweeper
   tile" feel) vs *Open* (current hairline outline). Not built yet; would flow
   through TraceCard so line/box/meta all follow.
3. **Hue tuning** — current hues are near-max spread within the cool
   constraint; if a pair ever confuses in practice, prefer a lightness nudge
   over a hue move, and change only host tokens.
