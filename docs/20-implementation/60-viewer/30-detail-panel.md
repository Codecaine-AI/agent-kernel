---
covers: "Detail panel implementation: the DetailShell layout standard, the data-only renderer contract, the block vocabulary and slot order, the one code-block component with its clamp policies, the Turn body's tabs and subtabs, the message stream, the Details takeover, the Escape ladder, the host extension seam, and the conformance test that enforces all of it."
concepts: [detail-panel, detail-shell, renderer-contract, block-vocabulary, doc-figure, clamp-policy, primary-figure, turn-body, detail-zones, details-takeover, escape-ladder, extension-blocks, conformance-test]
code-ref: packages/viewer-ui/src/trace-viewer/detail-panel/
depends-on: [00-overview.md, 10-trace-card-design.md, ../20-kernel/70-request-snapshots.md]
---

# Detail Panel

The detail panel renders one selected span. Every event type gets the same structure — a fixed header over a body composed only from a standard block vocabulary — and per-type renderers can only choose and fill blocks.

Design record: [detail-view-options.html](../../10-system-design/explainers/detail-view-options.html) §0 (the layout standard), §5 Direction B, §7 (recommendation), and [state-tab-options.html](../../10-system-design/explainers/state-tab-options.html) Round 2 (the State tab). Those documents carry the rationale and the rejected alternatives; this one describes what is built.

---

## The Layout Standard

Two parts, no exceptions, for every event type:

- **Header** — kind-tinted glyph, title, and a quiet Details control, at fixed `h-12` on the shared panel-header surface. Geometry is identical for every type; the tint and glyph match the tree row for the same span (`span-style.ts` mirrors `SpanCard`'s dispatch, and `resolveSpanIcon` supplies the accent). The header does not move when Details opens — only the control swaps for an accessible close button.
- **Body** — always non-empty, composed only from the standard block vocabulary, in a fixed slot order. Non-Turn bodies are untabbed. Turn bodies use shell-owned tabs.

There is no summary tier and no dead end: a type that carries only attributes renders a compact facts block (`FactCard`), so the plain-language information stays in the main read.

## The Renderer Contract

A per-type renderer is `(props: RendererProps) => DetailView` — it returns **data, not JSX** (`contract.ts`). The shell owns the header, the Details button and takeover state, tab and subtab chrome, block ordering, framing, disclosures, clamping, modal expansion, and Escape precedence. A renderer therefore physically cannot emit chrome, reorder slots, or open a second panel.

```ts
interface DetailView {
  blocks?: DetailBlockSpec[];   // untabbed body
  tabs?: DetailTab[];           // tabbed body; the FIRST tab is the default
  detailsExtras?: ReactNode;    // appended inside the shell-owned Details view
}
```

`blocks` and `tabs` are mutually exclusive. Renderers are registered in `rendererRegistry.ts`, which is exported so the conformance suite covers every registration automatically.

### The block vocabulary

| Slot | Holds |
|---|---|
| `input` | params, declared inputs, the instruction |
| `content` | turn sections, rendered context, message content |
| `output` | result, delta, lints |
| `media` | standalone renders and images |

The shell sorts blocks by this slot order (`BLOCK_SLOT_ORDER`), with `order` as the intra-slot tie-break. A renderer's own array order is not respected across slots — deliberately.

Notable `DetailBlockSpec` fields beyond `id` / `slot` / `caption`:

- `body` + `language` — source text rendered through `DocFigure`. Mutually exclusive with `node`.
- `node` — the escape hatch for content that genuinely is not source text (lineage strip, thumbnails, prose). Still framed by the shell; the renderer supplies inner content only.
- `selfFramed` — the node is already a stream of cards, so the shell renders it **bare**: no figure border, no caption bar, no clamp box. Prevents a frame around N frames.
- `inlineRows` — presentation-only rows embedded *between* source lines (see the state figure below). They contribute no bytes.
- `attachments` — non-source content placed immediately after the body figure; the shell owns placement.
- `clamp`, `expandable`, `collapsible`, `defaultOpen`, `gutter` — declarative capabilities the shell implements.
- `turnSection` — a compatibility marker (`system` / `context` / `state` / `tools`) stamped onto the shell-owned block root for the request-snapshot DOM contract.

### Enforcement

`contract-conformance.test.tsx` iterates every registered renderer plus the fallback over representative real spans and asserts: the header is present; a real Details button with correct ARIA exists; at least one standard block appears in an untabbed body or in the default tab; exactly one body form; block roots carry the standard markers with non-decreasing slot order within each tab; the first tab is active; no bottom drawer chrome; no renderer-owned chrome outside the vocabulary. It also renders the exported Details view for each span and asserts identity, event type, timing, duration, attributes, the standard raw code block, and usage when carried. Because the test reads the registry programmatically, a renderer added later is covered without touching the test.

## One Code-Block Component

`doc-figure/` is the single data-block substrate app-wide: a non-selectable line-number gutter, theme-aware zebra striping (`--zebra-color` / `--zebra-opacity` from the style system), and lossless syntax coloring.

- **Byte-exact, unwrapped, one mode.** Long logical lines scroll horizontally inside the figure and never widen the panel. `tokenize.ts` guarantees losslessness: concatenating token values reproduces the input exactly, including malformed input.
- **The one deliberate carve-out** is JSON data blocks (`json-document.ts`). Providers serialize tool arguments and results minified, so whitespace — and only whitespace — is canonicalized to a 2-space indent; every value and the parsed key order is preserved, and non-JSON passes through untouched.
- **Natural-language message prose** is the other deliberate exception to the figure treatment: conversation text stays wrapped prose. Everything structured or data-bearing uses the figure.
- **Caption rows carry the caption and the expand control only** — no counts, no metadata. Expandable figures put a keyboard-reachable ⤢ at the far right that opens the shell-owned modal; the modal renders byte-identically to the inline figure.
- `Clamped.tsx` always renders the complete child tree and collapses with `max-height` plus a fade, so SSR markup, search, and copy retain the full source.

### Clamp policies

| Policy | Budget | Used for |
|---|---|---|
| `tight` | 140px | short previews |
| `block` | 420px | ordinary data blocks |
| `tall` | 720px | long secondary documents |
| `scroll` | `min(70vh, 900px)`, windowed | **primary figures** — full render, scrolls in place |
| `none` | unbounded | content that must never clamp |

`PRIMARY_FIGURE_CLAMP` (`renderers/primary-figure.ts`) is `CLAMP.scroll`: the document a surface exists to show is never a clamped preview. The Turn body stamps it onto every tab's source figures with `withPrimaryFigurePolicy()`, so a new tab renderer inherits the policy without knowing it exists; blocks that declare their own `clamp`, and non-source `node` blocks, are left alone. Sections that also open standalone (System prompt, Context) name the constant directly so the same document reads identically wherever it is opened. Figures nested inside message cards are tier-2, not primary, and keep their previews.

## The Turn Body

`TurnBody.tsx` exposes four shell-owned tabs in fixed order — **State · Context · System prompt · Tools** — with State first and therefore the default. Tabs are one segmented control; slot order is enforced separately inside each tab. Tools is last: the roster the agent could reach on *this* request, one standard JSON data block per tool in the order the provider received them, each carrying the full definition (name, description, parameter schema) from the snapshot's captured roster.

The State tab carries two **zones** (`DetailZone`), shown one at a time through a quieter shell-owned subtab row (`DetailStream.tsx`): **State | Messages**. Exactly one surface is on screen — zones are alternatives, never a stack. The subtab label is the whole control: no counts, no meta line.

`turn/StateSection.tsx` renders section ③ as **one continuous figure**. Authorship is positional: everything inside the snapshot's `state` range is output of `render(state)`, even when a provider transported an attached-render message as `role: "user"`; only the `tail` is conversation. Attached renders are embedded *inside* the figure as a `DocInlineRow` at the `<views>` line — no line number, gutter and substrate running unbroken past it — rather than cut out into a second card. The figure's source is the payload and the inline row contributes no bytes, so byte-exactness is unchanged. When the payload cannot be indexed there is no `<views>` anchor and the renders settle at the document's foot.

`state-outline.ts` supplies the line offsets that place them. It is deliberately not an XML parser: the payload is not well-formed XML (the board digest contains bare `<`, `>`, quotes and arrows, and its indentation is load-bearing), so a top-level sub-block is a line that is nothing but an opening tag, closed by a later line that is nothing but its matching closing tag. Parse failure is first-class — `null` means no offsets, and the caller degrades to the undivided figure.

## The Message Stream

Message cards are the same conversation read at a different zoom, so `turn/turn-block-content.tsx` maps each role to the tree's display type and resolves the glyph and color group through the one resolver (`resolveSpanIcon`). A user message is the blue person card, an assistant reply the green chat card, a tool result the orange wrench card — in the tree and in the panel, by construction rather than by duplicated hues. Cap treatment follows the style rail through `icons/icon-settings.tsx`, since the panel has no prop path from the host.

Kernel-authored lines are plumbing, not conversation: they resolve through `lifecycle` to the neutral card and wear a **KERNEL** badge instead of USER. The badge is driven by the protocol-owned marker, not by heuristics — see [D99](../../10-system-design/60-prompt-system-model.md) and `@agent-kernel/protocol` `kernel-messages.ts`. An image that the kernel replaced with a text placeholder is recognized through the same shared envelope (`isImageElisionMarker`) and rendered as a placeholder rather than as source data.

## Details Takeover

The Details control replaces the **body** with a shell-owned full-panel Details view (`DetailsView.tsx`). The earlier always-collapsed bottom drawer is gone: no disclosure row, no bottom border, no drawer spacer.

Details carries identity (span id, event type, every attribute with per-row copy), timing (start, end, duration, span type, status), usage when present (input/output/cache-read/cache-write tokens, model, cost, stop reason), and the raw span JSON without children. Multi-line strings become real indented blocks for display while Copy JSON preserves the exact round-trippable JSON. Raw uses the standard figure with its gutter, zebra, byte-exact rendering, and ⤢ expansion.

Focus moves into Details on open and returns to the Details button on close. Closing restores the body exactly as it was, including the active Turn tab.

## The Escape Ladder

`escape.ts` is a pure resolver: **modal → Details**. One press closes exactly one layer, and Details closes only when nothing sits above it. The intermediate "focus" posture that once sat between them was cut on review and deleted rather than left dormant.

## Host Extension Seam

`blocks.ts` is the additive seam: a host (canvas) returns the same data-only block vocabulary through `detailBlockProvider`, and the shell frames, orders, clamps, and expands the contributions. Extension blocks merge into the **first (default)** tab of a tabbed view and sort by the same slot order; later tabs stay exactly as the renderer declared them. Renderer ids win id collisions, so an extension can never replace built-in content. The provider is treated as untrusted: duplicate ids keep the first block, and a provider error degrades to the same empty result as an unconfigured host. There is no second panel, ever.
