/**
 * Approximate nested tool spans from a tool result's `nestedCalls` record.
 *
 * Pi records the calls a codemode script made (`ctx.executeTool()`) on the
 * calling tool's result message: one flat list covering every depth, ids
 * `<callerId>/<n>`, no parent field, no results, no start times. The backfill
 * mapper and the live emitter (for calls it never saw run live) both build
 * spans from such a record through this one pure builder, so both agree on
 * event ids (`nestedToolEventId`), span ids (the nested call id), and the
 * immediate parent (`immediateParentId`, the id minus its final `/<n>`).
 *
 * Rows built here are `timing: "approximate"`. A later live end with the same
 * id replaces the approximate end through the sink's `submitPromotable`; an
 * approximate row never replaces a live one.
 */
import {
  EventType,
  createToolCallEndEvent,
  createToolCallStartEvent,
  immediateParentId,
  nestedToolEventId,
} from "@agent-kernel/protocol";
import type { TraceEvent, TraceEventIds } from "@agent-kernel/protocol";
import type { PiNestedToolCallRecord } from "./types";

const NESTED_STATUSES: ReadonlySet<string> = new Set(["ok", "error", "unfinished"]);

/**
 * The well-formed records of a `nestedCalls` value read from a transcript or a
 * live message. Records without an id are skipped; an unknown status reads as
 * `unfinished`.
 */
export function nestedCallRecordsOf(nestedCalls: unknown): PiNestedToolCallRecord[] {
  const calls = (nestedCalls as { calls?: unknown } | null | undefined)?.calls;
  if (!Array.isArray(calls)) return [];
  const records: PiNestedToolCallRecord[] = [];
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const raw = call as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") continue;
    records.push({
      ...(raw as Partial<PiNestedToolCallRecord>),
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : "unknown",
      status: NESTED_STATUSES.has(raw.status as string)
        ? (raw.status as PiNestedToolCallRecord["status"])
        : "unfinished",
    });
  }
  return records;
}

/**
 * Start and end events for one nested call record. The end is stamped
 * `endTimestamp` (the parent tool result's entry time); the start sits
 * `durationMs` earlier, or at the same instant with `duration_ms` omitted
 * when the record carries no duration. The parent is derived from the id;
 * `fallbackParentToolUseId` (a live call's Pi parentToolCallId) applies only
 * when the id has no `/<n>` suffix to derive one from.
 */
export function nestedCallRecordEvents(
  ids: TraceEventIds,
  piSessionUuid: string,
  record: PiNestedToolCallRecord,
  endTimestamp: string,
  fallbackParentToolUseId?: string,
): { start: TraceEvent; end: TraceEvent } {
  const parentToolUseId = immediateParentId(record.id) ?? fallbackParentToolUseId;
  const durationMs = validDurationMs(record.durationMs);
  const endMs = Date.parse(endTimestamp);
  const startTimestamp =
    durationMs !== undefined && Number.isFinite(endMs)
      ? new Date(endMs - durationMs).toISOString()
      : endTimestamp;

  const start = createToolCallStartEvent(ids, record.name, record.id, {
    toolInput: nestedToolInput(record),
    spanId: record.id,
    parentToolUseId,
    nested: true,
    timing: "approximate",
    eventId: nestedToolEventId(piSessionUuid, record.id, EventType.TOOL_CALL_START),
    timestamp: startTimestamp,
  });
  const end = createToolCallEndEvent(ids, record.name, record.id, {
    toolOutput: record.status === "error" ? record.error : undefined,
    durationMs,
    isError: record.status !== "ok",
    spanId: record.id,
    parentToolUseId,
    nested: true,
    nestedStatus: record.status,
    timing: "approximate",
    eventId: nestedToolEventId(piSessionUuid, record.id, EventType.TOOL_CALL_END),
    timestamp: endTimestamp,
  });
  return { start, end };
}

/**
 * `{ raw: arguments }`, the same wrapping live tool calls carry, or the size
 * Pi recorded when it omitted arguments over its limits.
 */
function nestedToolInput(record: PiNestedToolCallRecord): Record<string, unknown> | undefined {
  if (record.arguments !== undefined) return { raw: record.arguments };
  if (typeof record.argumentsBytes === "number") return { omitted_bytes: record.argumentsBytes };
  return undefined;
}

function validDurationMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
