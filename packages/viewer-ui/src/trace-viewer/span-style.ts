import type { TraceSpan } from "@evilmartians/agent-prism-types";

import type { NodeDisplayType, SpanDisplayType } from "./icons/resolve-span-icon";

export type SpanStyle = {
	titleClassName: string;
	indicator?: string;
};

/**
 * Model-node rows (viewer-core model-nodes.ts) by their synthetic event_type:
 * call and decision node rows and their attempt rows, plus the paired step
 * and gate spans (a lone step_end / gate_end keeps its kind too).
 */
const NODE_DISPLAY_BY_EVENT_TYPE: Readonly<Record<string, NodeDisplayType>> = {
	call_container: "call",
	call_attempt: "call",
	decision_container: "decision",
	decision_attempt: "decision",
	step_start: "step",
	step_end: "step",
	gate_start: "gate",
	gate_end: "gate",
};

/** The model-node kind an event_type renders as, or undefined for every other event. */
export function nodeDisplayTypeOf(
	eventType: string | undefined,
): NodeDisplayType | undefined {
	return eventType === undefined ? undefined : NODE_DISPLAY_BY_EVENT_TYPE[eventType];
}

/**
 * Resolve the display-type discriminant for a span from its event_type,
 * mirroring SpanCard's getSpanDisplay() dispatch. Centralized here so the
 * detail panel (TabShell) can echo the SAME kind accent the tree shows —
 * keep this switch in sync with SpanCard when new event types are added.
 */
export function spanDisplayTypeOf(span: TraceSpan): SpanDisplayType {
	const eventType = readStringAttr(span, "event_type");
	switch (eventType) {
		case "user_message":
			return "user";
		case "assistant_message":
			return "assistant";
		case "tool_call_start":
		case "tool_call_end":
			return readStringAttr(span, "tool_kind") === "spawner"
				? "spawner"
				: "tool";
		case "ui_ask_requested":
		case "ui_ask_answered":
			return "ui_ask";
		case "pi_agent_container":
			return "agent";
		case "container_container":
			return "container";
		case "provisioning_container":
		case "run_container":
		case "phase_container":
		case "agent_run_start":
		case "agent_run_end":
		case "agent_session_start":
		case "agent_session_end":
			return "lifecycle";
		case "context_build_started":
		case "context_build_completed":
		case "system_prompt_resolved":
			return "system";
		case "pi_request_snapshot":
			return "turn";
		default:
			return nodeDisplayTypeOf(eventType) ?? "generic";
	}
}

export function readStringAttr(
	span: TraceSpan,
	key: string,
): string | undefined {
	const attrs = span.attributes;
	if (!attrs) return undefined;
	for (const attr of attrs) {
		if (attr.key !== key) continue;
		const value = attr.value?.stringValue;
		if (typeof value === "string") return value;
		return undefined;
	}
	return undefined;
}

export function readNumberAttr(
	span: TraceSpan,
	key: string,
): number | undefined {
	const attrs = span.attributes;
	if (!attrs) return undefined;
	for (const attr of attrs) {
		if (attr.key !== key) continue;
		const raw = attr.value?.intValue;
		if (typeof raw !== "string") return undefined;
		const parsed = Number.parseInt(raw, 10);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * A numeric attribute with its fraction kept. viewer-core stores every number
 * as `intValue: String(n)`, so probabilities and costs ("0.91", "0.0012")
 * arrive there too; readNumberAttr would truncate them.
 */
export function readNumericAttr(
	span: TraceSpan,
	key: string,
): number | undefined {
	const raw = span.attributes?.find((attr) => attr.key === key)?.value?.intValue;
	if (typeof raw !== "string") return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function readBoolAttr(span: TraceSpan, key: string): boolean | undefined {
	const value = span.attributes?.find((attr) => attr.key === key)?.value?.boolValue;
	return typeof value === "boolean" ? value : undefined;
}

/** Node timing on the row chip and in the detail: "110 ms", "1.8 s", "2.4 min". */
export function formatDurationMs(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	return `${(ms / 60_000).toFixed(1)} min`;
}

const PROMINENT_EVENT_TYPES: ReadonlySet<string> = new Set([
	"user_message",
	"assistant_message",
	"ui_ask_requested",
	"ui_ask_answered",
]);

const CONTAINER_EVENT_TYPES: ReadonlySet<string> = new Set([
	"pi_agent_container",
	"phase_container",
	"run_container",
	"container_container",
]);

export function getSpanStyle(span: TraceSpan): SpanStyle {
	if (span.status === "error") {
		return {
			titleClassName: "text-[length:var(--ds-font-size-ui-lg)] font-semibold text-destructive",
			indicator: "!",
		};
	}
	if (span.status === "warning") {
		return {
			titleClassName: "text-[length:var(--ds-font-size-ui-lg)] font-semibold text-status-warning",
			indicator: "!",
		};
	}

	const eventType = readStringAttr(span, "event_type");
	if (eventType === "ui_ask_requested") {
		return { titleClassName: "text-[length:var(--ds-font-size-ui-lg)] font-semibold", indicator: "?" };
	}
	if (
		eventType !== undefined &&
		(PROMINENT_EVENT_TYPES.has(eventType) || CONTAINER_EVENT_TYPES.has(eventType))
	) {
		return { titleClassName: "text-[length:var(--ds-font-size-ui-lg)] font-semibold" };
	}

	const level = readNumberAttr(span, "trace_level");
	if (level === 3) return { titleClassName: "text-[length:var(--ds-font-size-ui-2xs)] opacity-60" };
	if (level === 2) return { titleClassName: "text-[length:var(--ds-font-size-ui-sm)] opacity-70" };
	return { titleClassName: "text-[length:var(--ds-font-size-ui-lg)]" };
}
