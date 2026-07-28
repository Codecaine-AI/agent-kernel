/**
 * escape — the pure Escape-precedence rule behind the detail panel's layers.
 *
 * It lives apart from the shell so the interaction contract can be asserted
 * directly, the same way `shouldCloseDetailsOnEscape` always has been.
 *
 * The focus posture that used to sit between the modal and Details is GONE.
 * Ford, verbatim: "I don't really love this focus state. I'm trying to have
 * things render more in line — it would make it a lot more cohesive instead of
 * having this separation." Focus joined the index rail as rejected on review;
 * the figure caption's modal is the only escape hatch a piece offers now.
 */

/** What one Escape press closes. Exactly one layer, never two. */
export type DetailEscapeLayer = "modal" | "details" | null;

export interface DetailEscapeState {
	/** A code-expansion or image modal is above everything else. */
	modalOpen: boolean;
	/** The full-panel Details takeover has replaced the body. */
	detailsOpen: boolean;
}

/**
 * The agreed §0 rule: modal → Details takeover. Returns the single layer this
 * press closes, or null when nothing is open.
 */
export function resolveEscapeLayer({
	modalOpen,
	detailsOpen,
}: DetailEscapeState): DetailEscapeLayer {
	if (modalOpen) return "modal";
	if (detailsOpen) return "details";
	return null;
}
