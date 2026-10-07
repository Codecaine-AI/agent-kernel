/**
 * CallBody utils — pure readers over a call row's attributes (viewer-core
 * toNodeSpan) and its output blob.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	formatDurationMs,
	readNumericAttr,
	readStringAttr,
} from "../../../../span-style";
import {
	attemptSummary,
	factRow,
	modelRows,
	usageRows,
	type FactRow,
} from "../../node-facts";

export type CallOutcome = "ok" | "error" | "aborted" | "running";

/** call_end.status, else the run status behind the row (running → no call_end yet). */
export function callOutcome(span: TraceSpan): CallOutcome {
	const status = readStringAttr(span, "status");
	if (status === "ok" || status === "error" || status === "aborted") return status;
	if (span.status === "error") return "error";
	if (span.status === "warning") return "aborted";
	return span.status === "pending" ? "running" : "ok";
}

/** The call card's identity and cost facts, in reading order. */
export function callSummaryRows(span: TraceSpan): FactRow[] {
	const duration = readNumericAttr(span, "duration_ms");
	const route = [readStringAttr(span, "provider"), readStringAttr(span, "api")]
		.filter(Boolean)
		.join(" · ");
	return [
		...factRow("function_name", "Function", readStringAttr(span, "function_name")),
		...factRow("engine", "Engine", readStringAttr(span, "engine")),
		...factRow("transport", "Transport", readStringAttr(span, "transport")),
		...modelRows(span),
		...factRow("route", "Route", route || undefined),
		...factRow("prompt_hash", "Prompt hash", readStringAttr(span, "prompt_hash")),
		...factRow("status", "Status", callOutcome(span)),
		...factRow("attempts", "Attempts", attemptSummary(span)),
		...factRow("duration", "Duration", duration === undefined ? undefined : formatDurationMs(duration)),
		...usageRows(span),
		...factRow("trigger", "Trigger", readStringAttr(span, "trigger")),
		...factRow("request_id", "Request", readStringAttr(span, "request_id")),
	];
}

/** Why a call failed: the engine's error kind, message and HTTP status. */
export function callErrorRows(span: TraceSpan): FactRow[] {
	const http = readNumericAttr(span, "http_status");
	return [
		...factRow("error_kind", "Kind", readStringAttr(span, "error_kind") ?? callOutcome(span)),
		...factRow("error_message", "Message", readStringAttr(span, "error_message")),
		...factRow("http_status", "HTTP status", http === undefined ? undefined : String(http)),
	];
}

export type OutputField = {
	key: string;
	/** Strings as written; numbers, booleans and null as JSON; nested values as compact JSON. */
	value: string;
	nested: boolean;
};

/**
 * A typed output as one field per top-level key. A non-object value is one
 * `value` field; text that is not JSON returns null (it shows as raw text).
 */
export function outputFields(text: string): OutputField[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	const field = (key: string, value: unknown): OutputField => {
		if (typeof value === "string") return { key, value, nested: false };
		const nested = value !== null && typeof value === "object";
		return { key, value: JSON.stringify(value) ?? String(value), nested };
	};
	if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
		return Object.entries(parsed).map(([key, value]) => field(key, value));
	}
	return [field("value", parsed)];
}
