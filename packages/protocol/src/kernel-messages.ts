/**
 * kernel-messages — the marker that separates KERNEL-authored request lines
 * from the user's own turns.
 *
 * The three-section builder puts two kinds of synthetic message into a
 * request: the rebuilt ② context message, and the ③ lines the renderer emits
 * (a state block, or the base renderer's "[turns 1–5 elided]" marker). None of
 * them is anything the user said, but every one of them has to reach the
 * provider as a valid user-role message.
 *
 * Pi's own custom-message channel does exactly that: an AgentMessage with
 * `role: "custom"` carries a `customType` through the session and the request
 * snapshot, and pi-coding-agent's `convertToLlm` converts it to a plain user
 * message (same content blocks) on the way to the provider. So kernel-authored
 * lines ride that channel with a `kernel:`-prefixed customType — provider-valid
 * on the wire, distinguishable everywhere else.
 *
 * This lives in @agent-kernel/protocol because the marker is wire-visible: it
 * survives into the sanitized message blobs a request snapshot references, and
 * the viewer reads it back to badge those lines KERNEL instead of USER.
 */

/** customType prefix reserved for messages the kernel authored. */
export const KERNEL_MESSAGE_CUSTOM_TYPE_PREFIX = "kernel:";

/** Section ② — the context message rebuilt from the kernel-held L2 set. */
export const KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE = "kernel:context";

/** Section ③ — a line the state renderer produced (state block, elision marker). */
export const KERNEL_STATE_MESSAGE_CUSTOM_TYPE = "kernel:state";

/**
 * Wire-visible envelope used when the kernel replaces an old image block with
 * a text placeholder. The text block carries no other structural marker, so
 * producers and consumers must share this exact envelope.
 */
export const IMAGE_ELISION_MARKER_PREFIX = "[image elided — ";

/** Build the plain-text marker stored in an image block's place. */
export function imageElisionMarkerText(description: string): string {
	return `${IMAGE_ELISION_MARKER_PREFIX}${description}]`;
}

/**
 * True only when the entire value is one bracketed image-elision marker.
 * The description is deliberately opaque so adding another image MIME type or
 * byte-size unit does not require a viewer release.
 */
export function isImageElisionMarker(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith(IMAGE_ELISION_MARKER_PREFIX) &&
		value.endsWith("]") &&
		value.length > IMAGE_ELISION_MARKER_PREFIX.length + 1 &&
		!value.slice(IMAGE_ELISION_MARKER_PREFIX.length, -1).includes("\n") &&
		!value.slice(IMAGE_ELISION_MARKER_PREFIX.length, -1).includes("\r")
	);
}

/** The message shape this check needs — deliberately structural. */
export interface KernelAuthoredMessageLike {
	role?: string;
	customType?: unknown;
}

/**
 * True when a message was authored by the kernel rather than by the user or
 * the model. Anything else — including custom messages from app extensions —
 * is left alone.
 */
export function isKernelAuthoredMessage(
	message: KernelAuthoredMessageLike | null | undefined,
): boolean {
	return (
		message?.role === "custom" &&
		typeof message.customType === "string" &&
		message.customType.startsWith(KERNEL_MESSAGE_CUSTOM_TYPE_PREFIX)
	);
}
