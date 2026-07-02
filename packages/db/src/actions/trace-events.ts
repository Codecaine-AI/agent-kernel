import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { TraceEvent } from "@agent-kernel/protocol";
import type { KernelDatabase } from "../client";
import { traceEvents } from "../schema/trace-events";
import type { TraceEventRow } from "../types";

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

  const rows = events.map((e) => ({
    eventId: e.eventId,
    containerId: e.containerId,
    runId: e.runId ?? null,
    piSessionId: e.piSessionUuid ?? null,
    agentId: e.agentId ?? null,
    userId: e.userId ?? null,
    type: e.type,
    source: e.source,
    traceLevel: e.traceLevel,
    eventData: e.eventData,
    spanId: e.spanId ?? null,
    parentEventId: e.parentEventId ?? null,
    timestamp: e.timestamp,
  }));

  const inserted = await db
    .insert(traceEvents)
    .values(rows)
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
