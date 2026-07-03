import type { CSSProperties } from "react";

/**
 * Shared code-buffer metrics + palette for the two editor surfaces — the
 * editable Agent XML flow (PromptFlowXml) and the read-only Raw prompt view
 * (PromptView). Keeping these in one module guarantees the surfaces render on
 * an identical grid (so their line numbers track line-for-line) and share one
 * VS Code Dark+ palette, so switching between them reads as toggling
 * editability, not opening a different document.
 *
 * The colors resolve to app-provided `--editor-*` tokens when present, with
 * VS Code Dark+ literals as fallbacks so viewer-ui never hard-depends on the
 * host defining them.
 */

/** Editor body font size (px). A hair larger than the old 12px for readability. */
export const EDITOR_FONT_PX = 13;
/**
 * One shared line-height (px) governs EVERY row: text lines, blank separators,
 * tags, fences. ~1.6 ratio (VS Code-ish) for comfortable sustained reading.
 * All overlay math (indent guides, hover range bars, drag ghost, drop line)
 * keys off this constant, so the strict grid stays uniform when it changes.
 */
export const LINE_HEIGHT_PX = 21;

/** Editor-surface color tokens (app `--editor-*` with Dark+ fallbacks). */
export const EDITOR_COLORS = {
	bg: "var(--editor-bg, #1e1e1e)",
	fg: "var(--editor-fg, #d4d4d4)",
	lineNumber: "var(--editor-line-number, #858585)",
	lineNumberActive: "var(--editor-line-number-active, #c6c6c6)",
	gutterBg: "var(--editor-gutter-bg, #1e1e1e)",
	rule: "var(--editor-rule, rgb(255 255 255 / 0.04))",
	guide: "var(--editor-guide, rgb(255 255 255 / 0.08))",
	landmark: "var(--editor-landmark, rgb(255 255 255 / 0.028))",
} as const;

/** Base type metrics applied to a line container. */
export const editorTypeStyle: CSSProperties = {
	fontSize: `${EDITOR_FONT_PX}px`,
	lineHeight: `${LINE_HEIGHT_PX}px`,
};

/**
 * Ruled-paper background: one faint horizontal hairline per line row, painted
 * as a repeating gradient keyed to the line-height. Because it's a background —
 * not a border — it adds ZERO pixels, so the strict grid rhythm is preserved
 * exactly. The 1px rule sits at the bottom edge of each line row.
 */
export const editorRuleBackground: CSSProperties = {
	backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${
		LINE_HEIGHT_PX - 1
	}px, ${EDITOR_COLORS.rule} ${LINE_HEIGHT_PX - 1}px, ${EDITOR_COLORS.rule} ${LINE_HEIGHT_PX}px)`,
	// Anchor the gradient to the top of the content so rules land on line
	// boundaries regardless of scroll.
	backgroundPosition: "0 0",
};
