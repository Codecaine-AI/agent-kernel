/**
 * Acknowledged writes for model-node sessions (kernel.call / kernel.decide).
 *
 * Each export is an awaited wrapper around ONE synchronous transaction that
 * throws on failure, so a node's intent (start) and outcome (completion) are
 * either fully committed or not at all. Transaction bodies are synchronous
 * and use only the transaction-local helpers in ./tx-local (.run/.all/.get);
 * never `await` inside them and never call the async actions from them.
 */
import { eq } from "drizzle-orm";
import {
  createCallEndEvent,
  kernelNodeEventId,
  type CallEndData,
  type CallStartData,
  type TraceEvent,
} from "@agent-kernel/protocol";
import type { KernelDatabase } from "../client";
import { agentRuns, RUN_STATUS, type RunTrigger } from "../schema/agent-runs";
import { SESSION_STATUS } from "../schema/pi-agent-sessions";
import { traceEvents } from "../schema/trace-events";
import type { TraceBlobInput } from "../types";
import {
  applyUsageTx,
  insertAgentRunTx,
  insertTraceEventsTx,
  listRunsForSessionTx,
  runImmediateTransaction,
  setRunStatusTx,
  setSessionStatusTx,
  upsertPiAgentSessionTx,
  upsertTraceBlobsTx,
  type KernelTx,
} from "./tx-local";
import type { UsageDelta } from "./usage";

/**
 * A "running" run stays owned by its original attempt until its recorded
 * operation deadline (call_start.deadline_at) plus this grace has passed.
 */
export const NODE_STALE_GRACE_MS = 60_000;

/** error.kind on the call_end that recovery synthesizes for an abandoned run. */
export const ABANDONED_ERROR_KIND = "abandoned";

export interface NodeStartInput {
  kind: "call" | "decision";
  /** Deterministic when requestId is given, else random. */
  sessionId: string;
  /** Allocated by the lifecycle before the claim, so call_start's id is known. */
  runId: string;
  requestId?: string;
  containerId: string;
  agentName: string;
  displayLabel?: string | null;
  model: string;
  promptHash: string;
  parentRunId?: string | null;
  parentToolUseId?: string | null;
  trigger: RunTrigger;
  startedAt: string;
  /** Its eventId becomes agent_runs.inbound_event_id. */
  startEvent: TraceEvent;
  startBlobs: TraceBlobInput[];
  /** Fallback for runs written without deadline_at. */
  staleAfterMs: number;
  nowMs: number;
  /** Operation deadline (ISO); stamped into the start event as deadline_at. */
  deadlineAt: string;
  /**
   * The canonical request fingerprint (requestId claims only). Stamped into the
   * start event as `request_fingerprint` and compared, inside the claim, with
   * every run of the session: a different one is a `mismatch` and nothing is
   * written. Runs recorded without one are not compared.
   */
  requestFingerprint?: string;
}

export type NodeClaim =
  /** A prior run of this request finished "done"; nothing was written. */
  | { kind: "replay"; runId: string }
  /** A fresh "running" run exists (another instance owns it); nothing was written. */
  | { kind: "in-flight"; runId: string }
  | { kind: "claimed"; runId: string; attempt: number; abandonedRunIds: string[] }
  /** A run of this request recorded a different request fingerprint; nothing was written. */
  | { kind: "mismatch"; runId: string };

export interface NodeCompletion {
  runId: string;
  sessionId: string;
  containerId: string;
  runStatus: "done" | "error" | "aborted";
  sessionStatus: "ended" | "error";
  endedAt: string;
  /** Snapshots, turns, decision_made, call_end (call_end last). */
  events: TraceEvent[];
  blobs: TraceBlobInput[];
  usage: UsageDelta | null;
}

/** The run a completion targeted was no longer "running" (it was abandoned meanwhile). */
export class NodeRunNotRunningError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`node run ${runId} is no longer running; completion rolled back`);
    this.name = "NodeRunNotRunningError";
    this.runId = runId;
  }
}

/**
 * Claim and start one node attempt in ONE synchronous `BEGIN IMMEDIATE`
 * transaction:
 *   1. list the session's runs (only when requestId is given);
 *   1a. with a requestFingerprint, any run whose call_start recorded a
 *      different fingerprint → `mismatch` (nothing written, before replay,
 *      recovery or insertion, so a rejected request never blocks the original);
 *   2. any "done" run → `replay` (nothing written);
 *   3. a "running" run is fresh while now ≤ its call_start.deadline_at + 60 s
 *      (runs without deadline_at: startedAt + staleAfterMs) → `in-flight`
 *      (nothing written); every running run past that point is abandoned in
 *      this same transaction (synthesized aborted call_end, run "aborted",
 *      session kept "active" for the new attempt);
 *   4. upsert the session ("active", kind), insert the run ("running",
 *      inbound_event_id = startEvent.eventId), the start blobs and the start
 *      event → `claimed` with attempt = runs.length + 1.
 * The start event is stored with `deadline_at` (and, with a requestId,
 * `attempt`) stamped into its data, since the attempt is only known here.
 * SQLITE_BUSY is retried outside the transaction; any other throw rolls
 * everything back and rejects (the caller maps it to row-write-failed). The
 * engine may be invoked only after a `claimed` result.
 */
export async function claimAndStartNode(
  db: KernelDatabase,
  input: NodeStartInput,
): Promise<NodeClaim> {
  return runImmediateTransaction(db, (tx) => claimTx(tx, input));
}

/**
 * Persist a node's outcome in ONE synchronous transaction: blobs, events,
 * usage, then the run status (only if still "running"; outbound = the
 * call_end id) and the session status. If the run is no longer running the
 * transaction throws NodeRunNotRunningError and rolls back, so a run is never
 * "done" unless its outcome events, blobs and usage committed with it.
 */
export async function persistNodeCompletion(
  db: KernelDatabase,
  c: NodeCompletion,
): Promise<void> {
  const callEnd = [...c.events].reverse().find((e) => e.type === "call_end");
  if (!callEnd) {
    throw new Error(`persistNodeCompletion: run ${c.runId} has no call_end event`);
  }
  await runImmediateTransaction(db, (tx) =>
    completeTx(tx, c, callEnd.eventId),
  );
}

/**
 * Standalone recovery for a run left "running": one transaction that
 * inserts the deterministic aborted call_end (insert-or-ignore, so a real
 * call_end is kept), sets the run "aborted" and the session "error". A run
 * that is not running is left untouched. Ids and times of the written rows
 * come from the run row itself.
 */
export async function abandonNodeRun(
  db: KernelDatabase,
  args: { runId: string; sessionId: string; containerId: string; at: string },
): Promise<void> {
  await runImmediateTransaction(db, (tx) => {
    abandonRunTx(tx, {
      runId: args.runId,
      at: args.at,
      sessionStatus: SESSION_STATUS.ERROR,
    });
  });
}

// ─── Transaction bodies (synchronous) ───────────────────────────────────────

function claimTx(tx: KernelTx, input: NodeStartInput): NodeClaim {
  const runs =
    input.requestId === undefined ? [] : listRunsForSessionTx(tx, input.sessionId);

  if (input.requestFingerprint !== undefined) {
    for (const run of runs) {
      const stored = readStartEvent(tx, run.inboundEventId)?.data.request_fingerprint;
      if (typeof stored === "string" && stored !== input.requestFingerprint) {
        return { kind: "mismatch", runId: run.id };
      }
    }
  }

  const done = runs.filter((run) => run.status === RUN_STATUS.DONE).at(-1);
  if (done) return { kind: "replay", runId: done.id };

  const running = runs.filter((run) => run.status === RUN_STATUS.RUNNING);
  const fresh = running.find(
    (run) => input.nowMs <= staleAtMs(tx, run, input.staleAfterMs),
  );
  if (fresh) return { kind: "in-flight", runId: fresh.id };

  const abandonedAt = new Date(input.nowMs).toISOString();
  for (const run of running) {
    abandonRunTx(tx, {
      runId: run.id,
      at: abandonedAt,
      sessionStatus: SESSION_STATUS.ACTIVE,
    });
  }

  const attempt = runs.length + 1;
  upsertPiAgentSessionTx(tx, {
    id: input.sessionId,
    containerId: input.containerId,
    agentName: input.agentName,
    displayLabel: input.displayLabel ?? null,
    model: input.model,
    promptHash: input.promptHash,
    status: SESSION_STATUS.ACTIVE,
    kind: input.kind,
    createdAt: input.startedAt,
    endedAt: null,
  });
  insertAgentRunTx(tx, {
    id: input.runId,
    piSessionId: input.sessionId,
    containerId: input.containerId,
    parentRunId: input.parentRunId ?? null,
    parentToolUseId: input.parentToolUseId ?? null,
    agentName: input.agentName,
    trigger: input.trigger,
    inboundEventId: input.startEvent.eventId,
    displayLabel: input.displayLabel ?? null,
    status: RUN_STATUS.RUNNING,
    startedAt: input.startedAt,
  });
  upsertTraceBlobsTx(tx, input.startBlobs);
  const inserted = insertTraceEventsTx(tx, [
    stampStartEvent(input.startEvent, {
      deadlineAt: input.deadlineAt,
      attempt: input.requestId === undefined ? undefined : attempt,
      requestFingerprint: input.requestFingerprint,
    }),
  ]);
  if (inserted !== 1) {
    throw new Error(
      `claimAndStartNode: start event ${input.startEvent.eventId} already exists`,
    );
  }

  return {
    kind: "claimed",
    runId: input.runId,
    attempt,
    abandonedRunIds: running.map((run) => run.id),
  };
}

function completeTx(tx: KernelTx, c: NodeCompletion, callEndId: string): void {
  upsertTraceBlobsTx(tx, c.blobs);
  insertTraceEventsTx(tx, c.events);
  if (c.usage) {
    applyUsageTx(
      tx,
      { runId: c.runId, sessionId: c.sessionId, containerId: c.containerId },
      c.usage,
    );
  }
  const changed = setRunStatusTx(tx, {
    runId: c.runId,
    status: c.runStatus,
    endedAt: c.endedAt,
    outboundEventId: callEndId,
    onlyIfStatus: RUN_STATUS.RUNNING,
  });
  if (changed === 0) throw new NodeRunNotRunningError(c.runId);
  setSessionStatusTx(tx, {
    sessionId: c.sessionId,
    status: c.sessionStatus,
    endedAt: c.endedAt,
  });
}

/**
 * Abandon one "running" run: synthesized aborted call_end (insert-or-ignore),
 * run "aborted" (only if still running), session set to `sessionStatus`
 * ("active" keeps it open for a new attempt). Returns false when the run is
 * missing or not running (nothing written).
 */
function abandonRunTx(
  tx: KernelTx,
  args: {
    runId: string;
    at: string;
    sessionStatus: typeof SESSION_STATUS.ACTIVE | typeof SESSION_STATUS.ERROR;
  },
): boolean {
  const run = tx
    .select({
      id: agentRuns.id,
      piSessionId: agentRuns.piSessionId,
      containerId: agentRuns.containerId,
      agentName: agentRuns.agentName,
      inboundEventId: agentRuns.inboundEventId,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, args.runId))
    .get();
  if (!run || run.status !== RUN_STATUS.RUNNING) return false;

  const start = readStartEvent(tx, run.inboundEventId);
  const startData = start?.data;
  const startMs = Date.parse(start?.timestamp ?? run.startedAt);
  const atMs = Date.parse(args.at);
  // Keep the end after its start even when the caller's clock lags.
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(atMs) ? Math.max(atMs, startMs + 1) : atMs;
  const endedAt = Number.isFinite(endMs) ? new Date(endMs).toISOString() : args.at;

  const data: CallEndData = {
    run_id: run.id,
    node_kind: startData?.node_kind ?? "call",
    function_name: startData?.function_name ?? run.agentName,
    status: "aborted",
    error: {
      kind: ABANDONED_ERROR_KIND,
      message: "run was still running past its operation deadline; recovered",
    },
    attempts: 0,
    duration_ms: Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : 0,
    ...(startData?.gate_span_id !== undefined && {
      gate_span_id: startData.gate_span_id,
    }),
  };
  const callEnd = createCallEndEvent(
    { containerId: run.containerId, runId: run.id, piSessionUuid: run.piSessionId },
    data,
    {
      eventId: kernelNodeEventId(run.id, 0, "call_end"),
      parentEventId: run.inboundEventId ?? undefined,
      timestamp: endedAt,
    },
  );

  insertTraceEventsTx(tx, [callEnd]);
  setRunStatusTx(tx, {
    runId: run.id,
    status: RUN_STATUS.ABORTED,
    endedAt,
    outboundEventId: callEnd.eventId,
    onlyIfStatus: RUN_STATUS.RUNNING,
  });
  setSessionStatusTx(tx, {
    sessionId: run.piSessionId,
    status: args.sessionStatus,
    endedAt: args.sessionStatus === SESSION_STATUS.ACTIVE ? null : endedAt,
  });
  return true;
}

/** The run's call_start (via inbound_event_id), if it was written. */
function readStartEvent(
  tx: KernelTx,
  eventId: string | null,
): { data: Partial<CallStartData>; timestamp: string } | undefined {
  if (!eventId) return undefined;
  const row = tx
    .select({
      type: traceEvents.type,
      eventData: traceEvents.eventData,
      timestamp: traceEvents.timestamp,
    })
    .from(traceEvents)
    .where(eq(traceEvents.eventId, eventId))
    .get();
  if (!row || row.type !== "call_start") return undefined;
  const data =
    typeof row.eventData === "object" && row.eventData !== null
      ? (row.eventData as Partial<CallStartData>)
      : {};
  return { data, timestamp: row.timestamp };
}

/** Epoch ms after which a "running" run may be abandoned. */
function staleAtMs(
  tx: KernelTx,
  run: { startedAt: string; inboundEventId: string | null },
  staleAfterMs: number,
): number {
  const deadline = readStartEvent(tx, run.inboundEventId)?.data.deadline_at;
  const deadlineMs = typeof deadline === "string" ? Date.parse(deadline) : Number.NaN;
  if (Number.isFinite(deadlineMs)) return deadlineMs + NODE_STALE_GRACE_MS;
  return Date.parse(run.startedAt) + staleAfterMs;
}

function stampStartEvent(
  event: TraceEvent,
  stamp: { deadlineAt: string; attempt: number | undefined; requestFingerprint: string | undefined },
): TraceEvent {
  if (typeof event.eventData !== "object" || event.eventData === null) return event;
  return {
    ...event,
    eventData: {
      ...event.eventData,
      deadline_at: stamp.deadlineAt,
      ...(stamp.attempt !== undefined && { attempt: stamp.attempt }),
      ...(stamp.requestFingerprint !== undefined && { request_fingerprint: stamp.requestFingerprint }),
    },
  };
}
