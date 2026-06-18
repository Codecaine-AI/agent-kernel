import type { TraceSpan } from "@evilmartians/agent-prism-types";

export type SpanStyle = {
	titleClassName: string;
	indicator?: string;
};

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
			titleClassName: "text-sm font-semibold text-destructive",
			indicator: "!",
		};
	}
	if (span.status === "warning") {
		return {
			titleClassName: "text-sm font-semibold text-status-warning",
			indicator: "!",
		};
	}

	const eventType = readStringAttr(span, "event_type");
	if (eventType === "ui_ask_requested") {
		return { titleClassName: "text-sm font-semibold", indicator: "?" };
	}
	if (
		eventType !== undefined &&
		(PROMINENT_EVENT_TYPES.has(eventType) || CONTAINER_EVENT_TYPES.has(eventType))
	) {
		return { titleClassName: "text-sm font-semibold" };
	}

	const level = readNumberAttr(span, "trace_level");
	if (level === 3) return { titleClassName: "text-[10px] opacity-60" };
	if (level === 2) return { titleClassName: "text-xs opacity-70" };
	return { titleClassName: "text-sm" };
}
