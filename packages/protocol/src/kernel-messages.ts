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
