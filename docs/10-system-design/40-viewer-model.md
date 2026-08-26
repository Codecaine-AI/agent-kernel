---
covers: "Viewer model: trace data flow and ordering semantics, the trace tree and card standard, the detail panel layout standard and renderer contract, the prompt lab surfaces, the base shell behavior, and the app plugin seams."
concepts: [viewer, trace-spans, trace-cards, detail-panel, renderer-contract, prompt-lab, workspace-shell, plugin-slots, style-system]
code-ref: packages/viewer-core/src/, packages/viewer-ui/src/, packages/viewer-shell/src/
depends-on: [20-observability-model.md, 30-event-protocol.md, 60-prompt-system-model.md]
---

# Viewer Model

The viewer is part of the kernel, not an optional demo. A new app should be able to render useful trace views before it builds custom workflow UI.

This page owns the viewer's behavior: how trace data becomes a tree, the layout standards every surface must satisfy, and the contracts that keep app extensions inside the system. How the implementing code is organized is recorded at [20-implementation/60-viewer/00-overview.md](../20-implementation/60-viewer/00-overview.md).

---

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
trace span builder          (viewer-core)
        |
        v
span tree + detail panel    (viewer-ui)
        |
        v
mounted workspace           (viewer-shell)
```

App-embedded viewers and a future central observer both read through APIs that return viewer-core DTOs. Browser code never connects directly to the kernel database.

Container summaries are part of the trace shape, not decoration. Events and agent spans with explicit `containerId` values render under the matching container lineage even when persisted container timestamps tie or app workflow events have no Pi session.

### Event ordering

The read API orders by `(timestamp, eventId)`, but timestamps are millisecond-precision and event ids are content-derived, so same-millisecond events tie and then order arbitrarily. The span builder therefore re-sorts once, up front, on a canonical order: timestamp → turn number (when both events carry one) → causal type rank (the emitter's actual within-cycle firing order) → event id. Every downstream sort keys on `startTime` with a stable sort, so this order survives the pipeline.

### Turn nesting

Each turn's tool calls, UI asks, and assistant replies fold under the `pi_request_snapshot` ("Turn N") span that issued them. Ownership is *causal*, not attribute-based, because tool events carry no turn number: after the canonical sort, a span belongs to the most recent preceding Turn span. Traces with no snapshot spans keep the flat shape, so agents without the state extension and older traces are unaffected. `pi_turn_end` usage folds onto its matching Turn span without consuming the debug event; context inputs group under their build; provisioning spans are wrapped; spawner dispatch resolves to its nested session by explicit tool-use id, never by timestamp containment.

Run bucketing prefers the explicit envelope `runId` when an event carries one; run-window inference by span pairing is the fallback for events emitted without run identity. Relationships that were emitted explicitly are never re-derived from timestamps.

## The Trace Tree

Every span in the trace tree renders as one object — a **TraceCard**: a card frame with an integrated icon cap whose divider is part of the frame. The cap is connected to the card, never floating.

| Size | Used for | Cap placement |
| --- | --- | --- |
| `line` | single-line spans (tool, agent, turn, lifecycle…) | full-height end cell, flush left or right |
| `box` | multi-line messages (user, assistant) | pinned top-left corner *inside* the border |

- **There is exactly one row size.** The old reduced `meta` variant was removed so it cannot regress: info/debug rows wear the same cap size and type scale as every other row. The meta type style survives only for secondary chips *inside* a row, never as a row's own size.
- **Box caps always anchor top-left**, even when the icon side is set to "right". A top-right cap makes the eye hit wrapped body text before the type marker; the side option only steers the inline end caps.
- **Caps are square** (22px). Don't stretch a cap to solve an alignment problem; fix the text side instead. The corner cap centers its glyph at y=11, so message bodies carry no top padding — the first line sits flush to the frame and centers on the glyph. Stable under any mono font *family*; only a font-*size* change could break it, and the type scale forbids that.

### Color: bands, four categories, reserved status

A span's display type and status resolve to an icon kind, a semantic **group**, and the accent the card wears. Kind-colored cards are doc-style **bands**: the entire card border in the kind hue at reduced alpha, plus a subtle wash (~10%) of the same hue.

| Category | Group(s) | Treatment |
| --- | --- | --- |
| Conversation | `user` (blue), `assistant` (green) | band |
| Tool | `tool` — tool calls/results and spawner dispatch (orange) | band |
| Context | `context` — turn snapshots, context build, system prompt (violet) | band |
| Lifecycle | `orchestration`, `lifecycle`, `meta` — agents, runs/sessions, containers, provisioning, info/debug | neutral hairline, **no wash** |
| Status | `warning` (amber), `error` (red) | full-strength border + wash |

- **Loudness is monotonic and must stay that way**: neutral plumbing < kind band < selection < status. Status is the loudest thing in the tree.
- **Amber and red are reserved for diagnostics.** Status overrides type, and those are the only paths that reach them.
- **Violet means context, exclusively.** Orchestration cards are neutral, so the token is reused rather than the meaning shared.
- **Selection treatment lives on the card** — an inset ring plus a light fill that overrides any band wash. The row contributes only the gutter bar.

### Connector geometry

The tree's indent guides are deliberately quiet: hairline width, softened tint, always below the cards in the hierarchy. Every guide cell is a **fixed 24px column** — the same 24px step the content indent derives from — so line positions and content offsets come from one formula. A stretching cell would drift lines off-grid on rows whose toggle slot is empty; that bug class is pinned by test.

### Icons

One glyph per meaning, distinguishable at 13px by shape alone: **window** = a turn's context window · **layers** = context assembly (build / system prompt) · wrench = tool · person = user · chat = assistant · robot = agent · paper-plane = dispatch · play = run · flag = phase · cube = container · database = provisioning. Each glyph ships an outline and a fill variant so the cap treatment (outline cap / solid cap) switches without swapping metaphors.

**Gears mean lifecycle/plumbing only** — nothing content-bearing wears a gear. Lifecycle spans get finer glyphs from their label; error and warning status override everything for scannability.

### Typography

Card text is mono, in exactly three type styles: a 13px label style (every tree row, one size), a 13px relaxed body style (multi-line message bodies), and an 11px meta style (secondary inline chips inside a row). Nothing else in the trace viewer sets a size on card text. Prose/sans stacks sneaking in at ad-hoc sizes is the failure mode this exists to prevent.

### Width

There is **no fixed width budget**. An earlier design clamped card content to 320px minus 24px per tree depth, starving deep spans while the panel sat empty; it was removed deliberately — don't reintroduce one. Line cards grow to fit content and truncating detail chips ellipsize at the panel edge; box cards hug short messages (`w-fit`) and bound long ones (`max-w-[90%]`), with message content truncated upstream and a line-clamp visual guard.

### User-facing knobs

Presentation options users may reasonably disagree on are **rail knobs, not code forks**: icon side and style, band wash/border alphas, caret and connector opacities, selection color/opacity/ring width, code-block zebra color and opacity. Icon style changes only the cap fill, not the card frame — a deliberately subtle toggle.

## The Detail Panel

The detail panel renders one selected span. Every event type gets the same structure — a fixed header over a body composed only from a standard block vocabulary — and per-type renderers can only choose and fill blocks.

### The layout standard

Two parts, no exceptions, for every event type:

- **Header** — kind-tinted glyph, title, and a quiet Details control, at fixed `h-12` on the shared panel-header surface. Geometry is identical for every type; the tint and glyph match the tree row for the same span, resolved through the same icon resolver rather than duplicated hues. Event type and duration live in Details, not the header. The header does not move when Details opens — only the control swaps for an accessible close button.
- **Body** — always non-empty, composed only from the standard block vocabulary, in a fixed slot order. Non-Turn bodies are untabbed. Turn bodies use shell-owned tabs.

There is no summary tier and no dead end: a type that carries only attributes renders a compact facts block — the fact card, not a special case — so the plain-language information stays in the main read. "No input or output" is never an acceptable body.

**Simplicity in the main read**: tokens, hashes, and technical extras do not appear in the main read. They live in Details.

### The renderer contract

A per-type renderer is a function from renderer props to a `DetailView` — it returns **data, not JSX**. The shell owns the header, the Details button and takeover state, tab and subtab chrome, block ordering, framing, disclosures, clamping, modal expansion, and Escape precedence. A renderer therefore physically cannot emit chrome, reorder slots, or open a second panel.

```ts
interface DetailView {
  blocks?: DetailBlockSpec[];   // untabbed body
  tabs?: DetailTab[];           // tabbed body; the FIRST tab is the default
  detailsExtras?: ReactNode;    // appended inside the shell-owned Details view
}
```

`blocks` and `tabs` are mutually exclusive. Blocks fill four slots, and the shell sorts by this slot order with `order` as the intra-slot tie-break — a renderer's own array order is not respected across slots, deliberately:

| Slot | Holds |
|---|---|
| `input` | params, declared inputs, the instruction |
| `content` | turn sections, rendered context, message content |
| `output` | result, delta, lints |
| `media` | standalone renders and images |

Notable `DetailBlockSpec` capabilities beyond `id` / `slot` / `caption`: `body` + `language` (source text through the standard figure, mutually exclusive with `node`); `node` (the escape hatch for content that genuinely is not source text — still framed by the shell); `selfFramed` (the node is already a stream of cards, so the shell renders it bare — no frame around N frames); `inlineRows` (presentation-only rows embedded between source lines, contributing no bytes); `attachments` (non-source content placed immediately after the body figure, shell-owned placement); `clamp`, `expandable`, `collapsible`, `defaultOpen`, `gutter` (declarative capabilities the shell implements); `turnSection` (a compatibility marker stamped onto the shell-owned block root for the request-snapshot DOM contract).

Bodies compose from an enforced component set — `SectionRule`, `FactBar`, `LongBlock`, `ArgsTable`, `ThumbStrip`, `LineageStrip`, `FactCard`. If a body needs an eighth, that is the review conversation, not a local addition.

**Enforcement**: a conformance test iterates every registered renderer plus the fallback over representative real spans and asserts the standard — header present, real Details button with correct ARIA, at least one standard block, exactly one body form, standard block markers with non-decreasing slot order per tab, first tab active, no drawer chrome, no renderer-owned chrome outside the vocabulary — and renders the exported Details view for each span. Because the test reads the registry programmatically, a renderer added later is covered without touching the test.

### Per-kind bodies

Purpose-built bodies under the one thin shell, all from the same vocabulary:

- **Turn** — the reading layout: identity line · lineage strip · full-bleed state · renders · tail · response. The state block wins the panel; identity and lineage compress to a line and a strip to allow it.
- **Tool** — a call → result pair: reading a tool span is a comparison wanting adjacency, not sequence. Typed args table, thinking lead-in.
- **Context build** — a lineage view: declared → loaded (per-input rows with bytes, cache, hash) → rendered + attached. Per-input loader kind/status/bytes on the event are what make this possible without child spans.
- **Prompt** — a prompt reader: tag outline, rendered prompt, revision diff.
- **Message** — a plain box; everything else — the fact card.

### One code-block component

A single data-block substrate serves the whole app: non-selectable line-number gutter, theme-aware zebra striping, lossless syntax coloring.

- **Byte-exact, unwrapped, one mode.** Long logical lines scroll horizontally inside the figure and never widen the panel. Tokenization is lossless: concatenating token values reproduces the input exactly, including malformed input.
- **The one deliberate carve-out** is JSON data blocks. Providers serialize tool arguments and results minified, so whitespace — and only whitespace — is canonicalized to a 2-space indent; every value and the parsed key order is preserved, and non-JSON passes through untouched.
- **Natural-language message prose** is the other deliberate exception: conversation text stays wrapped prose. Everything structured or data-bearing uses the figure.
- **Caption rows carry the caption and the expand control only** — no counts, no metadata. Short blocks get no expansion control. Expandable figures put a keyboard-reachable ⤢ at the far right that opens the shell-owned modal — the only enlargement path. The modal is a near-full-viewport overlay with a dimmed backdrop, closes on Escape and click-out, and renders byte-identically to the inline figure.
- Clamping always renders the complete child tree and collapses with `max-height` plus a fade, so SSR markup, search, and copy retain the full source.

Clamp policies:

| Policy | Budget | Used for |
|---|---|---|
| `tight` | 140px | short previews |
| `block` | 420px | ordinary data blocks |
| `tall` | 720px | long secondary documents |
| `scroll` | `min(70vh, 900px)`, windowed | **primary figures** — full render, scrolls in place |
| `none` | unbounded | content that must never clamp |

**The primary-figure policy**: the document a surface exists to show is never a clamped preview. State, Context, and System prompt render in full inside a window that scrolls in place. The Turn body stamps the policy onto every tab's source figures, so a new tab renderer inherits it without knowing it exists; blocks that declare their own clamp, and non-source `node` blocks, are left alone. Sections that also open standalone name the constant directly so the same document reads identically wherever it is opened. Figures nested inside message cards are tier-2, not primary, and keep their previews.

### The Turn body

Four shell-owned tabs in fixed order — **State · Context · System prompt · Tools** — with State first and therefore the default. Tabs are one segmented control; slot order is enforced separately inside each tab. Tab labels carry no counts.

**Tools** is last: the roster the agent could reach on *this* request, one standard JSON data block per tool in the order the provider received them, each carrying the full definition from the snapshot's captured roster. Presence is a read, not a length check: a pre-capture snapshot gets an honest "not captured" block, a captured-but-empty roster says so, and offline mode distinguishes unreadable from never-captured.

The **State tab** carries two zones — **State | Messages** — shown one at a time through a quieter shell-owned subtab row. Exactly one surface is on screen; zones are alternatives, never a stack. The subtab label is the whole control: no counts, no meta line. The zone contract deliberately carries *n* surfaces, so a tab can grow subtabs — or a stacked or split posture can return — without reshaping the data.

The State zone renders **one continuous figure**. Authorship is positional: everything inside the snapshot's `state` range is output of `render(state)`, even when a provider transported an attached-render message as `role: "user"`; only the `tail` is conversation. Attached renders are embedded *inside* the figure as a presentation-only inline row at the `<views>` line — no line number, gutter and substrate running unbroken past it — rather than cut out into a second card. **One source**: the figure's source is the captured payload, everything derives from line offsets into that string, and nothing reserializes a parsed tree; the inline rows contribute no bytes, so byte-exactness is unchanged.

The outline that supplies those offsets is deliberately not an XML parser: the payload is not well-formed XML (the board digest contains bare `<`, `>`, quotes and arrows, and its indentation is load-bearing), so a top-level sub-block is a line that is nothing but an opening tag, closed by a later line that is nothing but its matching closing tag. Parse failure is first-class — no offsets means the caller degrades to the undivided figure, and when the payload cannot be indexed the renders settle at the document's foot. Zones, the raw figure, and the message rows all survive degradation; raw is always one affordance away.

Root identity (the snapshot's version/turn/board line) is promoted as a readable line; the board digest is a first-class affordance; lints are scannable — lead with counts, one row per warning.

### The message stream

Message cards are the same conversation read at a different zoom, so each role maps to the tree's display type and resolves its glyph and color group through the one icon resolver. A user message is the blue person card, an assistant reply the green chat card, a tool result the orange wrench card — in the tree and in the panel, by construction rather than by duplicated hues, and stable across every Messages treatment. Messages stay visibly outside the State field hierarchy.

Kernel-authored lines are plumbing, not conversation: they resolve through `lifecycle` to the neutral card and wear a **KERNEL** badge instead of USER. The badge is driven by the protocol-owned marker, not by heuristics — see [60-prompt-system-model.md](60-prompt-system-model.md). An image the kernel replaced with a text placeholder is recognized through the same shared envelope and rendered as a placeholder rather than as source data. Turn images render in place: context images with their context message, attached renders at their State-sequence position — never a trailing media strip.

### Details takeover

The Details control replaces the **body** with a shell-owned full-panel Details view. The earlier always-collapsed bottom drawer is gone: no disclosure row, no bottom border, no drawer spacer.

Details is complete: identity (span id, event type, every attribute with per-row copy), timing (start, end, duration, span type, status), usage when present (input/output/cache-read/cache-write tokens, model, cost, stop reason), and the raw span JSON without children. Multi-line strings become real indented blocks for display while Copy JSON preserves the exact round-trippable JSON. Raw uses the standard figure with its gutter, zebra, byte-exact rendering, and ⤢ expansion.

Focus moves into Details on open and returns to the Details button on close. Closing restores the body exactly as it was, including the active Turn tab.

### The Escape ladder

Escape resolution is a pure two-layer ladder: **modal → Details**. One press closes exactly one layer, and Details closes only when nothing sits above it.

Selection state does not persist across events: the panel is keyed by span id and remounts on event change. The active Turn tab persists.

### Host extension seam

A host contributes through the same data-only block vocabulary via the detail-block provider seam, and the shell frames, orders, clamps, and expands the contributions. Extension blocks merge into the **first (default)** tab of a tabbed view and sort by the same slot order; later tabs stay exactly as the renderer declared them. Renderer ids win id collisions, so an extension can never replace built-in content. The provider is treated as untrusted: duplicate ids keep the first block, and a provider error degrades to the same empty result as an unconfigured host. **There is no second panel, ever.**

### Rejected on review

Load-bearing alternatives, kept so they are not re-derived:

- **Direction A, "the read"** — one scroll with an outline rail. Rejected: a tool call is a comparison wanting adjacency, not sequence. Its single-scroll spine survives in the non-Turn bodies.
- **Direction C, the inspector** — content-derived facets. Rejected: it fixes tab membership, not the tab premise. Its register-named-blocks seam and wide-expand survived into the standard.
- **The index rail** — a scroll-spy sidebar for the State tab. Rejected: it ate a fifth of the reading width. The only wayfinding is subtabs — surfaces plus per-piece focus, not a sidebar.
- **The focus posture** — a breadcrumb/back layer between modal and Details. Cut on review and deleted rather than left dormant, along with its whole spec surface.
- **Per-field state figures** (nine always-expanded blocks) — too heavy; the continuous figure won.
- **Subtab counts and meta lines**; **the bottom Details drawer**; **wrap-on-by-default**; **expand-in-place** — all superseded by the standard above.

Deliberately deferred, not rejected: the stacked and split State/Messages postures (the zone model carries them), per-field focus re-entry (three candidates, undecided), and exposed cross-links between Turn, system prompt, context build, and tool spans (the joins exist in the builder's index; none are exposed yet).

## The Prompt Lab

The viewer also fronts the kernel catalog API: registry listing, agent detail, prompt saves and manifest edits (both dev-gated), model aliases, revision history, and per-revision run stats. Prompt comparison is a block-level structural diff keyed by stable node ids — no text diffing.

### Fidelity principle: one surface, agent-shaped

The Agent XML flow is the only prompt editing surface. It is shaped like what the agent actually receives — XML-tagged Markdown — because the editor's job is to let a human manipulate the *real* artifact, not a friendlier projection of it. Consequences, all deliberate:

- No Raw view. The editor keeps line-number parity with the rendered output (owned by a test-locked line model), so a separate read-only render adds nothing.
- No Sections mode. Block editing is a convenience layered on the agent-shaped view, not an alternative document.
- No combined system+context view here. The effective composed prompt is a runtime artifact; it is inspectable on `system_prompt_resolved` trace events.

### The code-editor surface contract

At rest, the editor renders as a code editor and nothing else. Everything editorial exists only on hover or selection.

- Strict line grid: every visual row is exactly one line-height (21px at 13px mono), including blank lines; wrapped lines use hanging indents.
- Continuous gutter with rendered-line numbering. Fixed width, right-aligned.
- VS Code Dark+ palette via shared editor tokens, defined once and consumed by every prompt-rendering surface so views cannot drift. Perceived color composes with the app's grain overlay; the surface itself is opaque.
- Structure uses the code editor's own vocabulary, never card vocabulary: 1px open-to-close indent guides per section, a faint (≤4% alpha) tint on section open-tag lines as scan landmarks, faint per-line rules (grid-safe: gradient/box-shadow, never borders that add pixels), and on hover a unified wash over the block's whole line range with a 2px left accent bar. No boxes, no borders around content, no hard bright edges.

### The interaction model (Notion-style)

- One affordance cluster per block, left side: `[+]` insert-below and `[::]` drag handle; clicking the handle opens the block menu (type name/rename, duplicate, add child, delete). Nothing on the right side.
- Selection is clearly stronger than hover and persists (accent left bar + stronger wash + cluster stays visible).
- List items are first-class: hover `x` per item, `+ item` at list end, and markers (`1.` / `-`) stay rendered as non-editable prefixes during inline editing — a row never changes shape under the cursor.
- Keyboard map inside editing: Enter inserts the next item/paragraph (Enter on an empty trailing item exits the list), Backspace on an empty item removes and refocuses the previous, Tab nests under the previous item, Shift+Tab un-nests. Shift+Enter is deliberately a no-op in single-line content (a literal newline would break grid parity); code/raw blocks keep real newlines.
- Undo granularity is the trust contract: every action — keystroke-commit, drag, menu operation, keyboard structural edit — is exactly one transaction step, so mod+z reverts exactly one logical action. All mutations flow through the prompt-kit stepped wrappers; nothing mutates the document directly.
- Drag has physics: a full-block floating ghost (slight scale/transparency, N-lines badge, viewport-capped with fade), in-place source dimming, a full-width insertion line indented to the target nesting depth, and a brief landing flash. Pointer-based, not native HTML5 drag.

### The sidebar-first shell

The agent viewer is strictly three columns, full height, nothing above or below: agent selector | editor | sidebar. The left column is exclusively the prompt. The always-present sidebar stacks, in order:

1. AGENT — name; model (editable, kernel model aliases as suggestions); description (editable). Saves go through the dev-gated catalog manifest route (schema-validated merge, canonical agent.json rewrite, registry hot-reload; the old entry survives a failed reload).
2. VIEW — System | Context. Context renders read-only on the same editor visual language; prompt controls disable.
3. PROMPT — token count first, then status chips, then undo/redo/reset/save. Save errors render directly under the save control.
4. DETAILS — the block inspector; document-level diagnostics replace the placeholder when nothing is selected.
5. REVISIONS — stats line for the current hash, revision list, and the two-revision block diff, all within the column.

The ordering reads as the agent's lifecycle: who it is, what you're viewing, the state of your edit, what's inside it, what it's been through.

## The Base Shell

`viewer-shell` ships the whole trace-viewing instrument, not a demo.

The **workspace** is one component with two modes. List mode: full-width trace/session rows (title, status badge, meta, optional per-row delete) with an app slot below the header. Drill-in mode: a minimal header — back affordance · trace title · quiet status badge · overflow delete when the host allows deletes, and nothing else — over 100% of the width serving the span tree and detail panel. There is deliberately **no workspace-level usage affordance** in drill-in: usage and runtime information live on the detail side, in the Details view of the event that carries them, and container / phase / session / run spans render a usage aggregate instead of dead-ending.

The **drill-in body** is a tree + detail split with a draggable divider bounded to sane limits; reading happens on the detail side, so it gets the majority by default. The tree toolbar and the detail header share one `h-12` panel-header surface, which is what makes the two columns read as one instrument.

The **style system** ships two palettes driving the same semantic tokens — light (the doc-paper look, the default) and dark — with the warning and destructive tokens marked *reserved · diagnostics*. Every value is emitted as a CSS variable that the viewer classes consume with baked fallbacks, so a host that mounts nothing still gets the default look. Rail controls group into panel tabs a host can restrict: colors, tree chrome, selection, code blocks, trace icons, layout/effects.

## App Plugins

Apps extend the viewer through registered UI, not by forking the kernel viewer packages.

Spectre examples:

- a session header rendered above the trace tree
- spec, plan, build, or docs panels beside the trace viewer
- custom renderers for app-specific event payloads
- app badges for cost, branch, checkpoint, phase, or review status

If a workflow needs more control than the shell exposes, it can compose `viewer-ui` directly while still using `viewer-core` transforms and DTOs. A host never replaces the detail column, and app-specific detail content arrives through the data-only detail-block seam.
