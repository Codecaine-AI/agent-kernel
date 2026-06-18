import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { TraceEvent } from "@agent-kernel/protocol";
import { traceEvents } from "../schema/trace-events";

type KernelDatabase = any;

export async function insertTraceEventsBatch(
  db: KernelDatabase,
  events: TraceEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    id: e.eventId,
    appSessionId: e.appSessionId,
    containerId: e.containerId ?? null,
    userId: e.userId,
    type: e.type,
    source: e.source,
    traceLevel: e.traceLevel,
    eventData: e.eventData,
    piSessionId: e.piSessionUuid ?? null,
    spanId: e.spanId ?? null,
    parentEventId: e.parentEventId ?? null,
    timestamp: e.timestamp,
  }));

  await db.insert(traceEvents).values(rows);
  return events.length;
}

export interface ListTraceEventsOptions {
  typeFilter?: string[];
  after?: string;
  limit?: number;
}

export async function listTraceEvents(
  db: KernelDatabase,
  appSessionId: string,
  opts: ListTraceEventsOptions = {},
) {
  const { typeFilter, after, limit = 100 } = opts;

  const conditions = [eq(traceEvents.appSessionId, appSessionId)];

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
    .orderBy(asc(traceEvents.timestamp))
    .limit(Math.min(limit, 1000));
}

export async function listTraceEventsForContainer(
  db: KernelDatabase,
  containerId: string,
  opts: ListTraceEventsOptions = {},
) {
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
    .orderBy(asc(traceEvents.timestamp))
    .limit(Math.min(limit, 1000));
}
