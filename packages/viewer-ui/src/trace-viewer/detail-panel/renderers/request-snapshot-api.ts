/**
 * request-snapshot-api — URL builders + response contracts for the per-turn
 * request-snapshot read routes. Paths come from KERNEL_TRACE_READ_PATHS
 * (viewer-core/src/api.ts); the helpers here only join them onto the host's
 * apiBase from TraceViewerApiContext.
 *
 * apiBase is a prefix, not an origin: `""` is legal and yields a relative,
 * same-origin URL ("/kernel/runs/…"). Callers gate with hasApiBase() before
 * getting here — see TraceViewerApiContext.
 */
import { KERNEL_TRACE_READ_PATHS } from "@agent-kernel/viewer-core";

import type { RequestSectionTag } from "./turn-sections";

/**
 * The offline gate, as a type guard. `apiBase` is a prefix, so `""` is a
 * perfectly good value — it means same-origin. Only `null`/absent means "no API
 * configured". Every caller must use this instead of a truthiness check, or a
 * same-origin host silently falls back to the offline summary.
 */
export function hasApiBase(
	apiBase: string | null | undefined,
): apiBase is string {
	return apiBase !== null && apiBase !== undefined;
}

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
	/**
	 * Half-open [start, end) index ranges over `messages` marking where the
	 * request's sections ② context and ③ state (plus its tail) begin. Absent on
	 * snapshots taken before the builder emitted tags — the viewer then renders
	 * the flat list. Mirrors PiRequestSnapshotData.sections in the protocol.
	 */
	sections?: RequestSectionTag[];
	refs?: unknown;
	totals?: unknown;
}
