/**
 * StepBody utils — pure readers over a kernel.step span (viewer-core
 * spanAttributes: step_start paired with step_end).
 */
import type { TraceSpan, TraceSpanAttribute } from "@evilmartians/agent-prism-types";

import { formatDurationMs, readNumericAttr, readStringAttr } from "../../../../span-style";
import { factRow, type FactRow } from "../../node-facts";

function attrText(attribute: TraceSpanAttribute | undefined): string | undefined {
	const value = attribute?.value;
	if (typeof value?.stringValue === "string") return value.stringValue;
	if (typeof value?.intValue === "string") return value.intValue;
	if (typeof value?.boolValue === "boolean") return String(value.boolValue);
	return undefined;
}

/** check_value keeps its type on the span (string, number or boolean); shown as text. */
function checkValue(span: TraceSpan): string | undefined {
	return attrText(span.attributes?.find((attribute) => attribute.key === "check_value"));
}

/** Status, check outcome, timing and placement. */
export function stepSummaryRows(span: TraceSpan): FactRow[] {
	const duration = readNumericAttr(span, "duration_ms");
	const status = readStringAttr(span, "status") ?? (span.status === "pending" ? "running" : undefined);
	return [
		...factRow("step_name", "Step", readStringAttr(span, "step_name") ?? span.title),
		...factRow("status", "Status", status),
		...factRow("check_result", "Check", readStringAttr(span, "check_result")),
		...factRow("check_value", "Value", checkValue(span)),
		...factRow("duration", "Duration", duration === undefined ? undefined : formatDurationMs(duration)),
		...factRow("run_id", "Run", readStringAttr(span, "run_id")),
	];
}

function jsonValue(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value) ?? String(value);
}

function parseJson(text: string | undefined): unknown {
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The step's attributes (start and end merged by viewer-core) as table rows. */
export function stepAttributeRows(span: TraceSpan): FactRow[] {
	const parsed = parseJson(readStringAttr(span, "step_attributes"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	return Object.entries(parsed).map(([key, value]) => ({
		key: `attribute:${key}`,
		label: key,
		value: jsonValue(value),
	}));
}

/** The step's recorded events: name, offset from the step's start, attributes. */
export function stepEventRows(span: TraceSpan): FactRow[] {
	const parsed = parseJson(readStringAttr(span, "step_events"));
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((entry, index) => {
		if (entry === null || typeof entry !== "object") return [];
		const event = entry as { name?: unknown; at_ms?: unknown; attributes?: unknown };
		const at = typeof event.at_ms === "number" ? `+${formatDurationMs(event.at_ms)}` : "";
		const attributes =
			event.attributes && typeof event.attributes === "object" ? JSON.stringify(event.attributes) : "";
		return [
			{
				key: `event:${index}`,
				label: String(event.name ?? `event ${index + 1}`),
				value: [at, attributes].filter(Boolean).join(" ") || "—",
			},
		];
	});
}
