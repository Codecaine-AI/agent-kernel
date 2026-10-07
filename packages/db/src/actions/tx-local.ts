/**
 * Synchronous, transaction-local write helpers.
 *
 * bun-sqlite Drizzle transactions are SYNCHRONOUS: `db.transaction(fn,
 * { behavior })` runs fn inside bun:sqlite's native transaction and does not
 * await a returned promise (drizzle-orm/bun-sqlite/session.js). An async
 * callback commits at its first `await` and runs the rest outside the
 * transaction. Every helper here therefore takes the transaction handle and
 * returns synchronously, using only `.run()`, `.all()` and `.get()`. Never
 * call the async actions (usage.ts, trace-events.ts, pi-agent-sessions.ts)
 * from inside a transaction; the async actions stay as they are for every
 * other caller.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { TraceEvent } from "@agent-kernel/protocol";
import type { KernelDatabase } from "../client";
import { agentRuns, type RunStatus } from "../schema/agent-runs";
import { containers } from "../schema/containers";
import {
  piAgentSessions,
  type SessionStatus,
} from "../schema/pi-agent-sessions";
import { traceBlobs } from "../schema/trace-blobs";
import { traceEvents } from "../schema/trace-events";
import type {
  NewAgentRun,
  NewPiAgentSession,
  NewTraceEventRow,
  TraceBlobInput,
} from "../types";
import { isSqliteBusyError } from "../upgrade";
import type { UsageDelta } from "./usage";

/** The transaction handle `db.transaction` passes to its (synchronous) callback. */
export type KernelTx = Parameters<Parameters<KernelDatabase["transaction"]>[0]>[0];

/** SQLITE_BUSY on BEGIN IMMEDIATE is retried with these waits, outside the transaction. */
const BUSY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a synchronous callback in one `BEGIN IMMEDIATE` transaction. Any throw
 * inside rolls everything back and rejects. SQLITE_BUSY is retried 5 times
 * (50, 100, 200, 400, 800 ms); a rolled-back attempt left nothing behind, so
 * rerunning it is safe. The rest parameter rejects promise-returning
 * callbacks at compile time.
 */
export async function runImmediateTransaction<T>(
  db: KernelDatabase,
  fn: (tx: KernelTx) => T,
  ..._syncOnly: T extends PromiseLike<unknown> ? [never] : []
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return db.transaction(fn, { behavior: "immediate" });
    } catch (error) {
      const delay = BUSY_RETRY_DELAYS_MS[attempt];
      if (!isSqliteBusyError(error) || delay === undefined) throw error;
      await sleep(delay);
    }
  }
}

/**
 * Column row for one envelope. The transport-only piSessionUuid is resolved
 * into the pi_session_id column at write time.
 */
export function traceEventToRow(e: TraceEvent): NewTraceEventRow {
  return {
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
  };
}

/** INSERT … ON CONFLICT(event_id) DO NOTHING. Returns the number of rows inserted. */
export function insertTraceEventsTx(tx: KernelTx, events: TraceEvent[]): number {
  if (events.length === 0) return 0;
  return tx
    .insert(traceEvents)
    .values(events.map(traceEventToRow))
    .onConflictDoNothing({ target: traceEvents.eventId })
    .returning({ eventId: traceEvents.eventId })
    .all().length;
}

/** Content-addressed, immutable: an existing hash is left untouched. */
export function upsertTraceBlobsTx(tx: KernelTx, blobs: TraceBlobInput[]): void {
  if (blobs.length === 0) return;
  tx.insert(traceBlobs)
    .values(blobs)
    .onConflictDoNothing({ target: traceBlobs.hash })
    .run();
}

/**
 * Insert a session, or refresh the descriptive fields that are defined on
 * `row` (same conflict rules as upsertPiAgentSession; created_at is kept).
 */
export function upsertPiAgentSessionTx(tx: KernelTx, row: NewPiAgentSession): void {
  tx.insert(piAgentSessions)
    .values(row)
    .onConflictDoUpdate({
      target: piAgentSessions.id,
      set: {
        containerId: row.containerId,
        ...(row.parentSessionId !== undefined && {
          parentSessionId: row.parentSessionId,
        }),
        ...(row.parentToolUseId !== undefined && {
          parentToolUseId: row.parentToolUseId,
        }),
        ...(row.agentName !== undefined && { agentName: row.agentName }),
        ...(row.displayLabel !== undefined && { displayLabel: row.displayLabel }),
        ...(row.model !== undefined && { model: row.model }),
        ...(row.promptHash !== undefined && { promptHash: row.promptHash }),
        ...(row.status !== undefined && { status: row.status }),
        ...(row.phase !== undefined && { phase: row.phase }),
        ...(row.endedAt !== undefined && { endedAt: row.endedAt }),
        ...(row.kind !== undefined && { kind: row.kind }),
      },
    })
    .run();
}

/** Plain insert: a duplicate run id or a missing parent run throws (FK). */
export function insertAgentRunTx(tx: KernelTx, row: NewAgentRun): void {
  tx.insert(agentRuns).values(row).run();
}

/**
 * Set a run's status, end time and (optionally) outbound event. With
 * `onlyIfStatus`, only a run currently in that status changes. Returns the
 * number of rows changed.
 */
export function setRunStatusTx(
  tx: KernelTx,
  args: {
    runId: string;
    status: RunStatus;
    endedAt: string;
    outboundEventId?: string;
    onlyIfStatus?: RunStatus;
  },
): number {
  const where =
    args.onlyIfStatus === undefined
      ? eq(agentRuns.id, args.runId)
      : and(eq(agentRuns.id, args.runId), eq(agentRuns.status, args.onlyIfStatus));
  return tx
    .update(agentRuns)
    .set({
      status: args.status,
      endedAt: args.endedAt,
      ...(args.outboundEventId !== undefined && {
        outboundEventId: args.outboundEventId,
      }),
    })
    .where(where)
    .returning({ id: agentRuns.id })
    .all().length;
}

/** `endedAt: null` clears the end time (a session reopened for a new attempt). */
export function setSessionStatusTx(
  tx: KernelTx,
  args: { sessionId: string; status: SessionStatus; endedAt: string | null },
): void {
  tx.update(piAgentSessions)
    .set({ status: args.status, endedAt: args.endedAt })
    .where(eq(piAgentSessions.id, args.sessionId))
    .run();
}

/**
 * Additive usage rollup for one run, its session and its container in one
 * go (the transaction-local twin of usage.ts). Cost columns stay NULL unless
 * a cost is present.
 */
export function applyUsageTx(
  tx: KernelTx,
  ids: { runId: string; sessionId: string; containerId: string },
  delta: UsageDelta,
): void {
  tx.update(agentRuns)
    .set({
      usageInputTokens: sql`${agentRuns.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${agentRuns.usageOutputTokens} + ${delta.outputTokens}`,
      usageCacheRead: sql`${agentRuns.usageCacheRead} + ${delta.cacheReadTokens}`,
      usageCacheWrite: sql`${agentRuns.usageCacheWrite} + ${delta.cacheWriteTokens}`,
      ...(delta.costEstimate !== undefined && {
        usageCostEstimate: sql`coalesce(${agentRuns.usageCostEstimate}, 0) + ${delta.costEstimate}`,
      }),
    })
    .where(eq(agentRuns.id, ids.runId))
    .run();

  tx.update(piAgentSessions)
    .set({
      usageInputTokens: sql`${piAgentSessions.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${piAgentSessions.usageOutputTokens} + ${delta.outputTokens}`,
    })
    .where(eq(piAgentSessions.id, ids.sessionId))
    .run();

  tx.update(containers)
    .set({
      usageInputTokens: sql`${containers.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${containers.usageOutputTokens} + ${delta.outputTokens}`,
      usageCacheRead: sql`${containers.usageCacheRead} + ${delta.cacheReadTokens}`,
      usageCacheWrite: sql`${containers.usageCacheWrite} + ${delta.cacheWriteTokens}`,
      ...(delta.costEstimate !== undefined && {
        usageCostEstimate: sql`coalesce(${containers.usageCostEstimate}, 0) + ${delta.costEstimate}`,
      }),
    })
    .where(eq(containers.id, ids.containerId))
    .run();
}

/** A session's runs, oldest first. `inboundEventId` locates each run's start event. */
export function listRunsForSessionTx(
  tx: KernelTx,
  sessionId: string,
): Array<{
  id: string;
  status: RunStatus;
  startedAt: string;
  inboundEventId: string | null;
}> {
  return tx
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      inboundEventId: agentRuns.inboundEventId,
    })
    .from(agentRuns)
    .where(eq(agentRuns.piSessionId, sessionId))
    .orderBy(asc(agentRuns.startedAt), asc(agentRuns.id))
    .all();
}
