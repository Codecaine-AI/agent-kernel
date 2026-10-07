import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { TraceEvent } from "@agent-kernel/protocol";
import type { KernelDatabase } from "../client";
import { traceEvents } from "../schema/trace-events";
import type { TraceEventRow } from "../types";
import { runImmediateTransaction, traceEventToRow } from "./tx-local";

/**
 * Idempotent batch insert keyed by event_id (INSERT OR IGNORE) — replaying
 * a batch never duplicates rows. The transport-only piSessionUuid on the
 * envelope is resolved into the pi_session_id column at write time.
 */
export async function insertTraceEventsBatch(
  db: KernelDatabase,
  events: TraceEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const inserted = await db
    .insert(traceEvents)
    .values(events.map(traceEventToRow))
    .onConflictDoNothing({ target: traceEvents.eventId })
    .returning({ eventId: traceEvents.eventId });
  return inserted.length;
}

export interface ListTraceEventsOptions {
  typeFilter?: string[];
  after?: string;
  limit?: number;
}

export async function listTraceEventsForContainer(
  db: KernelDatabase,
  containerId: string,
  opts: ListTraceEventsOptions = {},
): Promise<TraceEventRow[]> {
  const { typeFilter, after, limit = 100 } = opts;

  const conditions = [eq(traceEvents.containerId, containerId)];
  if (typeFilter && typeFilter.length > 0) {
    conditions.push(inArray(traceEvents.type, typeFilter));
  }
  if (after) {
    conditions.push(gt(traceEvents.timestamp, after));
  }

  return db
    .select()
    .from(traceEvents)
    .where(and(...conditions))
    .orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId))
    .limit(Math.min(limit, 1000));
}

export async function listTraceEventsForRun(
  db: KernelDatabase,
  runId: string,
  opts: ListTraceEventsOptions = {},
): Promise<TraceEventRow[]> {
  const { typeFilter, after, limit = 100 } = opts;

  const conditions = [eq(traceEvents.runId, runId)];
  if (typeFilter && typeFilter.length > 0) {
    conditions.push(inArray(traceEvents.type, typeFilter));
  }
  if (after) {
    conditions.push(gt(traceEvents.timestamp, after));
  }

  return db
    .select()
    .from(traceEvents)
    .where(and(...conditions))
    .orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId))
    .limit(Math.min(limit, 1000));
}

/** Envelope for a stored row; pi_session_id travels back as piSessionUuid. */
function traceEventFromRow(row: TraceEventRow): TraceEvent {
  return {
    eventId: row.eventId,
    containerId: row.containerId,
    type: row.type,
    source: row.source,
    traceLevel: row.traceLevel as TraceEvent["traceLevel"],
    eventData: row.eventData as TraceEvent["eventData"],
    timestamp: row.timestamp,
    ...(row.runId !== null && { runId: row.runId }),
    ...(row.piSessionId !== null && { piSessionUuid: row.piSessionId }),
    ...(row.agentId !== null && { agentId: row.agentId }),
    ...(row.userId !== null && { userId: row.userId }),
    ...(row.spanId !== null && { spanId: row.spanId }),
    ...(row.parentEventId !== null && { parentEventId: row.parentEventId }),
  };
}

/**
 * Every event of one run as envelopes, oldest first (uses idx_events_run).
 * Unlike listTraceEventsForRun there is no row limit: a model-node replay
 * rebuilds its result from the whole run.
 */
export async function getTraceEventsForRun(
  db: KernelDatabase,
  runId: string,
  types?: readonly string[],
): Promise<TraceEvent[]> {
  const conditions = [eq(traceEvents.runId, runId)];
  if (types && types.length > 0) {
    conditions.push(inArray(traceEvents.type, [...types]));
  }
  const rows = await db
    .select()
    .from(traceEvents)
    .where(and(...conditions))
    .orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId));
  return rows.map(traceEventFromRow);
}

/**
 * Promotable upsert for nested tool ends: inserts, or replaces an existing
 * row with the same event_id only when the stored row's event_data.timing is
 * 'approximate' and the new one is 'live'. Any other conflict keeps the
 * stored row.
 *
 *   INSERT … ON CONFLICT(event_id) DO UPDATE
 *     SET event_data = excluded.event_data, timestamp = excluded.timestamp
 *     WHERE json_extract(trace_events.event_data, '$.timing') = 'approximate'
 *       AND json_extract(excluded.event_data, '$.timing') = 'live'
 */
export async function upsertPromotableTraceEvent(
  db: KernelDatabase,
  event: TraceEvent,
): Promise<"inserted" | "promoted" | "kept"> {
  return runImmediateTransaction(db, (tx) => {
    const existed =
      tx
        .select({ eventId: traceEvents.eventId })
        .from(traceEvents)
        .where(eq(traceEvents.eventId, event.eventId))
        .get() !== undefined;
    const written = tx
      .insert(traceEvents)
      .values(traceEventToRow(event))
      .onConflictDoUpdate({
        target: traceEvents.eventId,
        set: {
          eventData: sql`excluded.event_data`,
          timestamp: sql`excluded.timestamp`,
        },
        setWhere: sql`json_extract(${traceEvents.eventData}, '$.timing') = 'approximate' AND json_extract(excluded.event_data, '$.timing') = 'live'`,
      })
      .returning({ eventId: traceEvents.eventId })
      .all();
    if (!existed) return "inserted" as const;
    return written.length > 0 ? ("promoted" as const) : ("kept" as const);
  });
}
