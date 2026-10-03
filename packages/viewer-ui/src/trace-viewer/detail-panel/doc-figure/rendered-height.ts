/**
 * rendered-height — how tall clamped content is as the browser laid it out,
 * soft-wrapped lines included. Framework-free; `useRenderedHeight` in
 * Clamped.tsx owns the React lifecycle.
 */

/** The two layout metrics the measurement reads. */
export type MeasuredContent = Pick<HTMLElement, "clientWidth" | "scrollHeight">;

/**
 * The laid-out height of the content. The clamp box around it hides overflow
 * but never constrains it, so the answer does not depend on whether the box
 * is clamped right now. Null when the content has no layout (inside a hidden
 * tab, or a DOM without a layout engine), so "not laid out" never reads as
 * "short".
 */
export function renderedHeightOf(content: MeasuredContent): number | null {
	return content.clientWidth > 0 ? content.scrollHeight : null;
}

/**
 * Re-measure each time ResizeObserver reports the content changed size: a
 * width change that re-wraps the text, or content that grew or shrank.
 * Clamping or unclamping the box around it does not resize it, so a decision
 * never re-triggers itself. The read happens in the observer callback, after
 * layout, so it forces no extra layout. Returns the disconnect.
 */
export function observeRenderedHeight(
	content: MeasuredContent & Element,
	onHeight: (heightPx: number) => void,
): () => void {
	if (typeof ResizeObserver === "undefined") return () => {};
	const observer = new ResizeObserver(() => {
		const heightPx = renderedHeightOf(content);
		if (heightPx !== null) onHeight(heightPx);
	});
	observer.observe(content);
	return () => observer.disconnect();
}
