---
covers: "Design decisions for the prompt editor and agent viewer shell: XML-primary fidelity, the code-editor surface contract, the Notion-style interaction model, and the sidebar-first layout."
concepts: [prompt-editor, prompt-lab, agent-viewer, code-editor-surface, editing-model, sidebar-shell, manifest-editing, vertical-slices]
code-ref: packages/viewer-ui/src/agent-viewer/, packages/viewer-ui/src/shared/editor-surface.ts, packages/kernel/src/catalog-api.ts
depends-on: [10-trace-card-design.md, ../../10-system-design/40-viewer-model.md, ../../10-system-design/60-prompt-system-model.md]
---

# Prompt Editor Design

Records the decisions the prompt editing surface converged on during the
2026-07 walkthrough, so styling and interaction work stops re-deriving them.

---

## Fidelity Principle: One Surface, Agent-Shaped

The Agent XML flow is the only prompt editing surface. It is shaped like what
the agent actually receives — XML-tagged Markdown — because the editor's job
is to let a human manipulate the *real* artifact, not a friendlier projection
of it.

Consequences, all deliberate:

- No Raw view. The editor keeps line-number parity with the rendered output
  (owned by `xml-line-model`, test-locked), so a separate read-only render
  adds nothing.
- No Sections mode. Block editing is a convenience layered on the agent-shaped
  view, not an alternative document. `PromptFlowSections` was deleted.
- No combined system+context view here. The effective composed prompt is a
  runtime artifact; it is inspectable on `system_prompt_resolved` trace events.

## The Code-Editor Surface Contract

At rest, the editor renders as a code editor and nothing else. Everything
editorial exists only on hover or selection.

- Strict line grid: every visual row is exactly one line-height (21px at
  13px mono), including blank lines; wrapped lines use hanging indents.
- Continuous gutter with rendered-line numbering. Fixed width, right-aligned.
- VS Code Dark+ palette via shared editor tokens (`--editor-bg #1E1E1E`,
  `--editor-fg #D4D4D4`, `--editor-line-number #858585`), defined once in
  `shared/editor-surface.ts` and consumed by every prompt-rendering surface
  so views cannot drift. Perceived color composes with the app's grain
  overlay; the surface itself is opaque.
- Structure uses the code editor's own vocabulary, never card vocabulary:
  1px open-to-close indent guides per section, a faint (<=4% alpha) tint on
  section open-tag lines as scan landmarks, faint per-line rules
  (grid-safe: gradient/box-shadow, never borders that add pixels), and on
  hover a unified wash over the block's whole line range with a 2px left
  accent bar. No boxes, no borders around content, no hard bright edges.

## Interaction Model (Notion-Style)

- One affordance cluster per block, left side: `[+]` insert-below and `[::]`
  drag handle; clicking the handle opens the block menu (type name/rename,
  duplicate, add child, delete). Nothing on the right side.
- Selection is clearly stronger than hover and persists (accent left bar +
  stronger wash + cluster stays visible).
- List items are first-class: hover `x` per item, `+ item` at list end, and
  markers (`1.` / `-`) stay rendered as non-editable prefixes during inline
  editing — a row never changes shape under the cursor.
- Keyboard map inside editing: Enter inserts the next item/paragraph (Enter
  on an empty trailing item exits the list), Backspace on an empty item
  removes and refocuses the previous, Tab nests under the previous item,
  Shift+Tab un-nests. Shift+Enter is deliberately a no-op in single-line
  content (a literal newline would break grid parity); code/raw blocks keep
  real newlines.
- Undo granularity is the trust contract: every action — keystroke-commit,
  drag, menu operation, keyboard structural edit — is exactly one
  transaction step, so mod+z reverts exactly one logical action. All
  mutations flow through the prompt-kit `*WithStep` wrappers; nothing
  mutates the document directly.
- Drag has physics: a full-block floating ghost (slight scale/transparency,
  N-lines badge, viewport-capped with fade), in-place source dimming, a
  full-width insertion line indented to the target nesting depth, and a
  brief landing flash. Pointer-based, not native HTML5 drag.

## Sidebar-First Shell

The agent viewer is strictly three columns, full height, nothing above or
below: agent selector | editor | sidebar. The left column is exclusively the
prompt. The always-present sidebar stacks, in order:

1. AGENT — name; model (editable, kernel model aliases as suggestions);
   description (editable). Saves go through the dev-gated
   `PUT /kernel/catalog/agents/:name/manifest` (schema-validated merge,
   canonical agent.json rewrite, registry hot-reload via
   `reloadAgentManifest`; the old entry survives a failed reload).
2. VIEW — System | Context. Context renders read-only on the same editor
   visual language; prompt controls disable.
3. PROMPT — token count first, then status chips, then
   undo/redo/reset/save. Save errors render directly under the save control.
4. DETAILS — the block inspector; document-level diagnostics replace the
   placeholder when nothing is selected.
5. REVISIONS — stats line for the current hash, revision list, and the
   two-revision block diff, all within the column.

The ordering reads as the agent's lifecycle: who it is, what you're viewing,
the state of your edit, what's inside it, what it's been through.

## File Layout Convention

Viewer components are vertical slices: a folder named for the component with
a thin `index.tsx` composition root and responsibility-named siblings
(`BlockCluster.tsx`, `drag-controller.tsx`, `ItemRow.tsx`, ...). External
import specifiers resolve through the folder index, so restructuring is
invisible to consumers. Single-responsibility modules stay flat files;
folderizing for symmetry is an anti-pattern.
