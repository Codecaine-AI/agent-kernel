/**
 * kernel-messages.ts — how the builder authors a message the user did not say.
 *
 * Both synthetic lines in a built request — the rebuilt ② context message and
 * whatever the ③ renderer emits around the conversation tail — go out through
 * Pi's custom-message channel: `role: "custom"` with a `kernel:`-prefixed
 * customType. Pi's `convertToLlm` turns that into a plain user message with the
 * same content blocks, so it reaches the provider as a valid user turn, while
 * the marker survives into the request snapshot for the viewer to badge KERNEL
 * instead of USER.
 *
 * The customType constants live in @agent-kernel/protocol because they are
 * wire-visible (see protocol/src/kernel-messages.ts).
 */

import {
	KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE,
	KERNEL_STATE_MESSAGE_CUSTOM_TYPE,
} from "@agent-kernel/protocol";

import type { AgentMessage } from "./types";

export {
	KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE,
	KERNEL_MESSAGE_CUSTOM_TYPE_PREFIX,
	KERNEL_STATE_MESSAGE_CUSTOM_TYPE,
	isKernelAuthoredMessage,
} from "@agent-kernel/protocol";

/** A content block a kernel-authored message may carry. */
export type KernelMessageBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

/**
 * Build one kernel-authored message. `display: false` keeps it out of the
 * interactive transcript UI — it is request furniture, not conversation.
 */
export function kernelMessage(
	customType: string,
	content: KernelMessageBlock[],
): AgentMessage {
	return {
		role: "custom",
		customType,
		content,
		display: false,
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** Section ③: one synthetic text line from the state renderer. */
export function kernelStateMessage(text: string): AgentMessage {
	return kernelMessage(KERNEL_STATE_MESSAGE_CUSTOM_TYPE, [
		{ type: "text", text },
	]);
}

/** Section ②: the rebuilt context message, text first then any images. */
export function kernelContextMessage(
	blocks: KernelMessageBlock[],
): AgentMessage {
	return kernelMessage(KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE, blocks);
}
