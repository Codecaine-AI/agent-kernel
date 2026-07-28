import type { TraceSpan } from "@evilmartians/agent-prism-types";

export function findSpanInTree(
	spans: TraceSpan[],
	id: string,
): TraceSpan | null {
	for (const span of spans) {
		if (span.id === id) return span;
		if (span.children) {
			const found = findSpanInTree(span.children, id);
			if (found) return found;
		}
	}
	return null;
}

export function collectSpanIds(spans: TraceSpan[]): string[] {
	return spans.flatMap((span) => [
		span.id,
		...(span.children ? collectSpanIds(span.children) : []),
	]);
}

export function readTraceLevel(span: TraceSpan): number | undefined {
	const attr = span.attributes?.find((a) => a.key === "trace_level");
	const raw = attr?.value?.intValue;
	if (raw === undefined || raw === null) return undefined;
	const parsed = Number.parseInt(String(raw), 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function isSyntheticContainer(span: TraceSpan): boolean {
	return (
		span.id.startsWith("phase:") ||
		span.id.startsWith("pi:") ||
		span.id.startsWith("run:") ||
		span.id.startsWith("container:") ||
		span.id.startsWith("orphaned:")
	);
}

function shouldKeepSpan(span: TraceSpan, maxLevel: number): boolean {
	if (isSyntheticContainer(span)) return true;
	if (span.status === "error" || span.status === "warning") return true;
	const level = readTraceLevel(span);
	if (level === undefined) return true;
	return level <= maxLevel;
}

function readEventType(span: TraceSpan): string | null {
	const attr = span.attributes?.find((a) => a.key === "event_type");
	return attr?.value?.stringValue ?? null;
}

/** Tool-flavored event types that read wrong without their owning Turn row. */
const TOOLISH_EVENT_TYPES = new Set<string>([
	"tool_call_start",
	"tool_call_end",
	"pre_tool_hook",
	"post_tool_hook",
	"ui_ask_requested",
	"ui_ask_answered",
]);

/**
 * A Turn container (pi_request_snapshot, trace level 2) whose own level is
 * filtered out still renders when it owns surviving tool children — at the
 * Tools level (L1) tools must keep their owner instead of hoisting into a
 * flat list. When only message children survive (L0), the Turn row drops
 * and the reply hoists so the messages view stays a plain conversation.
 */
function keepsFilteredTurnContainer(
	span: TraceSpan,
	filteredChildren: TraceSpan[],
): boolean {
	if (readEventType(span) !== "pi_request_snapshot") return false;
	return filteredChildren.some((child) =>
		TOOLISH_EVENT_TYPES.has(readEventType(child) ?? ""),
	);
}

export function filterSpansByTraceLevel(
	spans: TraceSpan[],
	maxLevel: number,
): TraceSpan[] {
	const result: TraceSpan[] = [];
	for (const span of spans) {
		const filteredChildren = filterSpansByTraceLevel(
			span.children ?? [],
			maxLevel,
		);
		if (
			shouldKeepSpan(span, maxLevel) ||
			keepsFilteredTurnContainer(span, filteredChildren)
		) {
			result.push({ ...span, children: filteredChildren });
		} else {
			result.push(...filteredChildren);
		}
	}
	return result;
}
