/**
 * clamp — the shared, height-based disclosure policy for detail-panel prose
 * and code figures.
 *
 * Callers choose the visual budget that matches a block's role. The rendering
 * component combines that budget with caller-supplied text metrics so the
 * same decision is available during server rendering without measuring DOM.
 */

export interface ClampPolicy {
	readonly maxHeightPx: number;
	readonly label: string;
	/**
	 * A bounded reading WINDOW rather than a preview. The whole body renders and
	 * the figure scrolls inside itself at this height — no fade, no "there is
	 * more below you cannot reach", because the reader already has all of it.
	 * The caption's ⤢ modal still opens it unbounded.
	 */
	readonly windowed?: boolean;
	/** CSS max-height for a windowed policy; falls back to `maxHeightPx`. */
	readonly maxHeight?: string;
}

export const CLAMP: {
	readonly tight: ClampPolicy;
	readonly block: ClampPolicy;
	readonly tall: ClampPolicy;
	readonly scroll: ClampPolicy;
	readonly none: ClampPolicy;
} = {
	tight: Object.freeze({ maxHeightPx: 140, label: "tight" }),
	block: Object.freeze({ maxHeightPx: 420, label: "block" }),
	tall: Object.freeze({ maxHeightPx: 720, label: "tall" }),
	// The reading window for a document that must be read in full and in place
	// — the state payload with its renders embedded in the flow. Viewport-
	// relative so a tall display gets a taller window, capped so a very tall one
	// does not turn the figure into the whole page.
	scroll: Object.freeze({
		maxHeightPx: 900,
		maxHeight: "min(70vh, 900px)",
		label: "scroll",
		windowed: true,
	}),
	none: Object.freeze({
		maxHeightPx: Number.POSITIVE_INFINITY,
		label: "none",
	}),
};

const ESTIMATED_LINE_HEIGHT_PX = 18;
/**
 * Estimate whether unwrapped content can exceed a policy's height. Source
 * figures are byte-exact and horizontally scroll long lines, so only logical
 * line count contributes to vertical height. `charCount` remains in the
 * signature for non-figure callers that already provide the shared metrics.
 */
export function shouldClamp(
	policy: ClampPolicy,
	lineCount: number,
	_charCount: number,
): boolean {
	if (!Number.isFinite(policy.maxHeightPx)) return false;

	const estimatedLines = Math.max(1, Math.floor(lineCount));
	const visibleLines = Math.max(
		1,
		Math.floor(policy.maxHeightPx / ESTIMATED_LINE_HEIGHT_PX),
	);

	return estimatedLines > visibleLines;
}
