/**
 * request-snapshot-api — URL builders + response contracts for the per-turn
 * request-snapshot read routes. Paths come from KERNEL_TRACE_READ_PATHS
 * (viewer-core/src/api.ts); the helpers here only join them onto the host's
 * apiBase from TraceViewerApiContext.
 */
import { KERNEL_TRACE_READ_PATHS } from "@agent-kernel/viewer-core";

/** Raw blob bytes (images serve image/png etc.). */
export function blobUrl(apiBase: string, blobHash: string): string {
	return `${apiBase}${KERNEL_TRACE_READ_PATHS.blob(blobHash)}`;
}

/** Sanitized full-context JSON for one run turn. */
export function runTurnContextUrl(
	apiBase: string,
	runId: string,
	turnNumber: number,
): string {
	return `${apiBase}${KERNEL_TRACE_READ_PATHS.runTurnContext(runId, turnNumber)}`;
}

// ─── Sanitized pi message shapes (see PiRequestSnapshotData docs in protocol) ─

export interface SanitizedTextBlock {
	type: "text";
	text: string;
}

export interface SanitizedThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface SanitizedToolCallBlock {
	type: "toolCall";
	id?: string;
	name?: string;
	arguments?: unknown;
}

/** Image content with the base64 payload replaced by a blob reference. */
export interface SanitizedImageBlock {
	type: "image";
	blob_hash: string;
	mimeType?: string;
	byte_length?: number;
}

export type SanitizedContentBlock =
	| SanitizedTextBlock
	| SanitizedThinkingBlock
	| SanitizedToolCallBlock
	| SanitizedImageBlock
	| { type: string; [key: string]: unknown };

export interface SanitizedMessage {
	/** "user" | "assistant" | "toolResult" | custom. */
	role: string;
	content?: SanitizedContentBlock[] | string;
	/** toolResult messages: error flag from the tool execution. */
	isError?: boolean;
	toolName?: string;
	[key: string]: unknown;
}

export interface RunTurnContextResponse {
	run_id: string;
	turn_number: number;
	prompt_hash: string | null;
	system_prompt: string | null;
	message_count: number;
	/** Sanitized pi messages, in context order. */
	messages: SanitizedMessage[];
	refs?: unknown;
	totals?: unknown;
}
