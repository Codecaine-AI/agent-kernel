/**
 * The shared lifecycle of a `call` or `decision` node (plan §3.4, §3.5,
 * §4.6): allocate ids, coalesce same-requestId calls in this kernel, claim
 * and start in one acknowledged transaction, run the engine step only after a
 * committed claim (under an operation deadline), then persist the outcome in
 * one transaction.
 *
 * Kind-specific work (engine invocation, snapshot/turn/decision events,
 * replay) lives in the `execute` and `replay` callbacks of the spec.
 *
 * A requestId names ONE request: the kind's canonical request fingerprint is
 * stored on call_start (`request_fingerprint`) and compared wherever a
 * requestId could hand back another request's work: in-process coalescing,
 * before the claim, and on every claim outcome (replay, in-flight, and a
 * claimed retry). A mismatch rejects KernelNodeError("invalid-request") and
 * never invokes the engine. Runs written without a fingerprint still replay.
 */
import { createHash, randomUUID } from "node:crypto";

import {
	abandonNodeRun,
	claimAndStartNode,
	getAgentRun,
	getTraceEventsForRun,
	listAgentRunsForPiSession,
	persistNodeCompletion,
	type KernelDatabase,
	type NodeClaim,
	type TraceBlobInput,
} from "@agent-kernel/db";
import {
	createCallEndEvent,
	createCallStartEvent,
	kernelNodeEventId,
	kernelRequestId,
	type CallEndData,
	type CallStartData,
	type RunTraceEventIds,
	type TraceEvent,
} from "@agent-kernel/protocol";

import { canonicalJson } from "./blobs";
import type { ModelNodeContext } from "./context";
import { toUsageDelta } from "./pricing";
import type { ResolvedNodeScope } from "./scope";
import { KernelNodeError, type NodeIds } from "./types";

export type ModelNodeKind = "call" | "decision";

/** call_start fields the kind supplies; the lifecycle fills identity, scope, request and deadline. */
export type NodeStartFields = Omit<
	CallStartData,
	| "run_id"
	| "node_kind"
	| "function_name"
	| "trigger"
	| "parent_run_id"
	| "parent_tool_use_id"
	| "request_id"
	| "attempt"
	| "deadline_at"
	| "display_label"
>;

/** call_end fields the kind supplies; the lifecycle fills identity, duration and gate span. */
export type NodeEndFields = Omit<CallEndData, "run_id" | "node_kind" | "function_name" | "duration_ms" | "gate_span_id">;

/** Handed to `execute` once the claim has committed. */
export interface NodeRunHandle {
	readonly kind: ModelNodeKind;
	readonly name: string;
	readonly ids: NodeIds;
	/** 1-based attempt within the session. */
	readonly attempt: number;
	/** call_start's event id: parentEventId for every child event. */
	readonly startEventId: string;
	readonly startedAtMs: number;
	readonly deadlineAtMs: number;
	/** The caller's signal combined with the operation deadline; pass it to the engine. */
	readonly signal: AbortSignal;
	/** True once the operation deadline fired (as opposed to the caller aborting). */
	deadlineExceeded(): boolean;
	/** Envelope ids for the node's own events: { containerId, runId, piSessionUuid: sessionId }. */
	readonly traceIds: RunTraceEventIds;
	/** Deterministic node event id (§4.4 ordinals: per attempt `i` for snapshots and turns). */
	eventId(ordinal: number, type: string): string;
	/** Next monotonic node timestamp (ISO). */
	timestamp(): string;
	/**
	 * An engine attempt's turn window, clamped after call_start and recorded on
	 * the node clock so call_end sorts after it (§4.4 Timestamps).
	 */
	turnWindow(attemptStartedAtMs: number, durationMs: number | null): { start: string; end: string };
}

export interface NodeExecution<TOutcome> {
	outcome: TOutcome;
	runStatus: "done" | "error" | "aborted";
	/** call_end payload (status, output_blob_hash, error, priced usage roll-up, attempts, resolved_model). */
	end: NodeEndFields;
	/** Snapshots, turns, decision_made in order; call_end is appended by the lifecycle. */
	events: TraceEvent[];
	blobs: TraceBlobInput[];
}

export interface NodeReplayInput {
	db: KernelDatabase;
	ids: NodeIds;
	/** Every event of the prior done run, in timestamp order. */
	events: TraceEvent[];
}

export interface NodeRunSpec<TOutcome> {
	kind: ModelNodeKind;
	/** BAML function name or decision name: session agent_name and call_start function_name. */
	name: string;
	scope: ResolvedNodeScope;
	requestId?: string;
	signal?: AbortSignal;
	onNodeStarted?: (ids: NodeIds) => void;
	/** Operation budget (§4.6): the deadline is fixed at claim time and recorded as call_start.deadline_at. */
	deadlineMs: number;
	/** engine, transport, model (requested "provider/id"), prompt_hash, input_blob_hash, … */
	start: NodeStartFields;
	/** The call-input / classifier-context blob(s) referenced by `start`. */
	startBlobs: TraceBlobInput[];
	/**
	 * The canonical request fingerprint (`requestFingerprint`), compared under a
	 * requestId: a different request with the same requestId is rejected.
	 */
	fingerprint?: string;
	/** Runs the engine; must resolve for engine failures (status error/aborted). */
	execute(run: NodeRunHandle): Promise<NodeExecution<TOutcome>>;
	/** Rebuilds the outcome of a prior done run of the same requestId; writes nothing. */
	replay(prior: NodeReplayInput): Promise<TOutcome> | TOutcome;
}

export interface NodeRunResult<TOutcome> {
	outcome: TOutcome;
	ids: NodeIds;
	/** Returned from a prior run via requestId; nothing was written. */
	replayed: boolean;
	/** Awaited an identical in-flight requestId in this kernel. */
	coalesced: boolean;
	/** 1-based attempt that produced the outcome; undefined for replays. */
	attempt?: number;
}

/** The constant message of a requestId reused for a different request. */
export const REQUEST_MISMATCH_MESSAGE = "requestId was already used for a different request";

/** "rf1-" + sha256 over the canonical JSON of the request's identifying parts. */
export function requestFingerprint(parts: unknown): string {
	return `rf1-${createHash("sha256").update(canonicalJson(parts)).digest("hex")}`;
}

function requestMismatch(): KernelNodeError {
	return new KernelNodeError("invalid-request", REQUEST_MISMATCH_MESSAGE);
}

/** Fingerprints of this kernel's in-flight requestId promises (coalescing compares them). */
const inFlightFingerprints = new WeakMap<Promise<unknown>, string | undefined>();

/** Session id for a node: deterministic from requestId, else random. */
export function nodeSessionId(kernelId: string, requestId: string | undefined): string {
	return requestId === undefined ? randomUUID() : kernelRequestId(kernelId, "session", requestId);
}

/**
 * Runs one node through the acknowledged lifecycle. Rejects only with
 * KernelNodeError (`in-flight-elsewhere`, `row-write-failed`, `no-db`,
 * `invalid-request`) or with an error `execute` threw (a programmer error;
 * the run is closed as error first).
 */
export async function runModelNode<TOutcome>(
	ctx: ModelNodeContext,
	spec: NodeRunSpec<TOutcome>,
): Promise<NodeRunResult<TOutcome>> {
	const db = ctx.db();
	const sessionId = nodeSessionId(ctx.kernelId, spec.requestId);
	const runId = randomUUID();

	if (spec.requestId === undefined) return runClaimed(ctx, db, spec, sessionId, runId);

	const existing = ctx.inFlight.get(sessionId);
	if (existing) {
		if (existing.kind !== spec.kind) {
			throw new KernelNodeError(
				"invalid-request",
				`requestId is already in flight as a ${existing.kind} node in this kernel`,
			);
		}
		const existingFingerprint = inFlightFingerprints.get(existing.promise);
		if (existingFingerprint !== undefined && spec.fingerprint !== undefined && existingFingerprint !== spec.fingerprint) {
			throw requestMismatch();
		}
		const result = (await existing.promise) as NodeRunResult<TOutcome>;
		return { ...result, coalesced: true };
	}

	const promise = runClaimed(ctx, db, spec, sessionId, runId);
	inFlightFingerprints.set(promise, spec.fingerprint);
	const entry = { kind: spec.kind, promise };
	ctx.inFlight.set(sessionId, entry);
	try {
		return await promise;
	} finally {
		if (ctx.inFlight.get(sessionId) === entry) ctx.inFlight.delete(sessionId);
	}
}

async function runClaimed<TOutcome>(
	ctx: ModelNodeContext,
	db: KernelDatabase,
	spec: NodeRunSpec<TOutcome>,
	sessionId: string,
	runId: string,
): Promise<NodeRunResult<TOutcome>> {
	const { scope } = spec;
	const ids: NodeIds = {
		containerId: scope.containerId,
		sessionId,
		runId,
		...(scope.parentRunId !== undefined && { parentRunId: scope.parentRunId }),
	};
	const traceIds: RunTraceEventIds = { containerId: scope.containerId, runId, piSessionUuid: sessionId };
	const logIds = { kind: spec.kind, name: spec.name, runId, sessionId };

	await ctx.ensureSchema();

	const startedAtMs = ctx.clock.nextMs();
	const startedAt = new Date(startedAtMs).toISOString();
	const deadlineAtMs = startedAtMs + Math.max(0, spec.deadlineMs);
	const deadlineAt = new Date(deadlineAtMs).toISOString();
	const startEventId = kernelNodeEventId(runId, 0, "call_start");
	const fingerprint = spec.requestId !== undefined ? spec.fingerprint : undefined;
	// Before any write: a requestId whose earlier attempts were a different request is rejected outright.
	if (fingerprint !== undefined && (await sessionHasOtherRequest(db, sessionId, fingerprint))) {
		throw requestMismatch();
	}
	const startData: CallStartData = {
		run_id: runId,
		node_kind: spec.kind,
		function_name: spec.name,
		...spec.start,
		trigger: scope.trigger,
		...(scope.parentRunId !== undefined && { parent_run_id: scope.parentRunId }),
		...(scope.parentToolUseId !== undefined && { parent_tool_use_id: scope.parentToolUseId }),
		...(spec.requestId !== undefined && { request_id: spec.requestId }),
		deadline_at: deadlineAt,
		...(scope.displayLabel !== undefined && { display_label: scope.displayLabel }),
		...(fingerprint !== undefined && { request_fingerprint: fingerprint }),
	};
	const startEvent = createCallStartEvent(traceIds, startData, { eventId: startEventId, timestamp: startedAt });

	let claim: NodeClaim;
	try {
		claim = await claimAndStartNode(db, {
			kind: spec.kind,
			sessionId,
			runId,
			...(spec.requestId !== undefined && { requestId: spec.requestId }),
			containerId: scope.containerId,
			agentName: spec.name,
			displayLabel: scope.displayLabel ?? null,
			model: spec.start.model,
			promptHash: spec.start.prompt_hash,
			parentRunId: scope.parentRunId ?? null,
			parentToolUseId: scope.parentToolUseId ?? null,
			trigger: scope.trigger,
			startedAt,
			startEvent,
			startBlobs: spec.startBlobs,
			staleAfterMs: ctx.staleAfterMs,
			nowMs: ctx.clock.now(),
			deadlineAt,
		});
	} catch (error) {
		ctx.logger?.error("model node start write failed", { ...logIds, error: errorName(error) });
		throw new KernelNodeError("row-write-failed", `${spec.kind} ${spec.name}: start write failed`, { cause: error });
	}

	if (claim.kind === "replay") return replayRun(ctx, db, spec, sessionId, claim.runId);
	if (claim.kind === "in-flight") {
		if (fingerprint !== undefined && (await runFingerprintDiffers(db, claim.runId, fingerprint))) throw requestMismatch();
		ctx.logger?.info("model node request in flight elsewhere", { ...logIds, inFlightRunId: claim.runId });
		throw new KernelNodeError(
			"in-flight-elsewhere",
			`${spec.kind} ${spec.name}: request is running in another kernel instance (run ${claim.runId})`,
		);
	}
	if (claim.abandonedRunIds.length > 0) {
		ctx.logger?.warn("model node recovered stale attempts", { ...logIds, abandonedRunIds: claim.abandonedRunIds });
	}
	// Claims are serialized (BEGIN IMMEDIATE), so a different request that committed an attempt between the
	// pre-claim check and this claim is visible now: close this attempt unrun and reject.
	if (fingerprint !== undefined && (await sessionHasOtherRequest(db, sessionId, fingerprint, runId))) {
		try {
			await abandonNodeRun(db, { runId, sessionId, containerId: scope.containerId, at: ctx.clock.nextIso() });
		} catch (error) {
			ctx.logger?.error("model node mismatch close failed", { ...logIds, error: errorName(error) });
		}
		throw requestMismatch();
	}

	// Operation deadline: one abort that ends in-flight requests and pending backoff.
	const deadline = new AbortController();
	const timer = setTimeout(
		() => deadline.abort(new DOMException("model node operation deadline exceeded", "TimeoutError")),
		Math.max(0, deadlineAtMs - ctx.clock.now()),
	);
	const signal = spec.signal ? AbortSignal.any([spec.signal, deadline.signal]) : deadline.signal;

	const handle: NodeRunHandle = {
		kind: spec.kind,
		name: spec.name,
		ids,
		attempt: claim.attempt,
		startEventId,
		startedAtMs,
		deadlineAtMs,
		signal,
		deadlineExceeded: () => deadline.signal.aborted,
		traceIds,
		eventId: (ordinal, type) => kernelNodeEventId(runId, ordinal, type),
		timestamp: () => ctx.clock.nextIso(),
		turnWindow(attemptStartedAtMs, durationMs) {
			const start = Math.max(Number.isFinite(attemptStartedAtMs) ? attemptStartedAtMs : startedAtMs, startedAtMs + 1);
			const end = Math.max(start + (durationMs !== null && durationMs > 0 ? durationMs : 0), start + 1);
			ctx.clock.observe(end);
			return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
		},
	};

	let execution: NodeExecution<TOutcome>;
	try {
		spec.onNodeStarted?.(ids);
		execution = await spec.execute(handle);
	} catch (error) {
		clearTimeout(timer);
		ctx.logger?.error("model node execute threw", { ...logIds, error: errorName(error) });
		// The execution error reaches the caller only once the error completion committed.
		await persistOrReject(ctx, db, spec, handle, failedExecution(error), logIds, { executionError: error });
		throw error;
	}
	clearTimeout(timer);

	await persistOrReject(ctx, db, spec, handle, execution, logIds, { value: execution.outcome });

	return { outcome: execution.outcome, ids, replayed: false, coalesced: false, attempt: claim.attempt };
}

async function replayRun<TOutcome>(
	ctx: ModelNodeContext,
	db: KernelDatabase,
	spec: NodeRunSpec<TOutcome>,
	sessionId: string,
	priorRunId: string,
): Promise<NodeRunResult<TOutcome>> {
	const run = await getAgentRun(db, priorRunId);
	const ids: NodeIds = {
		containerId: run?.containerId ?? spec.scope.containerId,
		sessionId,
		runId: priorRunId,
		...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
	};
	const events = await getTraceEventsForRun(db, priorRunId);
	const fingerprint = spec.requestId !== undefined ? spec.fingerprint : undefined;
	const stored = startFingerprint(events.find((event) => event.type === "call_start"));
	if (fingerprint !== undefined && stored !== undefined && stored !== fingerprint) throw requestMismatch();
	ctx.logger?.debug("model node replayed", { kind: spec.kind, name: spec.name, runId: priorRunId, sessionId });
	const outcome = await spec.replay({ db, ids, events });
	return { outcome, ids, replayed: true, coalesced: false };
}

/** The request fingerprint a call_start recorded; undefined for runs written before fingerprints. */
function startFingerprint(start: TraceEvent | undefined): string | undefined {
	const value = (start?.eventData as { request_fingerprint?: unknown } | undefined)?.request_fingerprint;
	return typeof value === "string" ? value : undefined;
}

async function runFingerprintDiffers(db: KernelDatabase, runId: string, fingerprint: string): Promise<boolean> {
	const [start] = await getTraceEventsForRun(db, runId, ["call_start"]);
	const stored = startFingerprint(start);
	return stored !== undefined && stored !== fingerprint;
}

/** True when any run of the session (other than `exceptRunId`) recorded a different fingerprint. */
async function sessionHasOtherRequest(
	db: KernelDatabase,
	sessionId: string,
	fingerprint: string,
	exceptRunId?: string,
): Promise<boolean> {
	for (const run of await listAgentRunsForPiSession(db, sessionId)) {
		if (run.id === exceptRunId) continue;
		if (await runFingerprintDiffers(db, run.id, fingerprint)) return true;
	}
	return false;
}

/** One transaction: outcome events and blobs, usage, then run and session status (call_end last). */
async function persist<TOutcome>(
	db: KernelDatabase,
	spec: NodeRunSpec<TOutcome>,
	handle: NodeRunHandle,
	execution: NodeExecution<TOutcome>,
): Promise<void> {
	const endMs = Date.parse(handle.timestamp());
	const endedAt = new Date(endMs).toISOString();
	const endData: CallEndData = {
		run_id: handle.ids.runId,
		node_kind: spec.kind,
		function_name: spec.name,
		...execution.end,
		duration_ms: Math.max(0, endMs - handle.startedAtMs),
		...(spec.start.gate_span_id !== undefined && { gate_span_id: spec.start.gate_span_id }),
	};
	const callEnd = createCallEndEvent(handle.traceIds, endData, {
		eventId: handle.eventId(0, "call_end"),
		parentEventId: handle.startEventId,
		timestamp: endedAt,
	});
	const events = execution.events.map((event) =>
		event.parentEventId === undefined ? { ...event, parentEventId: handle.startEventId } : event,
	);
	await persistNodeCompletion(db, {
		runId: handle.ids.runId,
		sessionId: handle.ids.sessionId,
		containerId: handle.ids.containerId,
		runStatus: execution.runStatus,
		sessionStatus: execution.runStatus === "done" ? "ended" : "error",
		endedAt,
		events: [...events, callEnd],
		blobs: execution.blobs,
		usage: toUsageDelta(execution.end.usage),
	});
}

/**
 * `persist`, or reject with KernelNodeError("row-write-failed") carrying the
 * write failure as `cause` (the run stays "running"; §4.6). `attach` keeps the
 * computed value, or the execution error of a run whose engine step threw.
 */
async function persistOrReject<TOutcome>(
	ctx: ModelNodeContext,
	db: KernelDatabase,
	spec: NodeRunSpec<TOutcome>,
	handle: NodeRunHandle,
	execution: NodeExecution<TOutcome>,
	logIds: Record<string, unknown>,
	attach: { value: TOutcome } | { executionError: unknown },
): Promise<void> {
	try {
		await persist(db, spec, handle, execution);
	} catch (error) {
		ctx.logger?.error("model node completion write failed", { ...logIds, error: errorName(error) });
		throw new KernelNodeError("row-write-failed", `${spec.kind} ${spec.name}: completion write failed`, {
			cause: error,
			...attach,
		});
	}
}

/** Closes a run whose `execute` threw: status error, no outcome events. */
function failedExecution<TOutcome>(error: unknown): NodeExecution<TOutcome> {
	return {
		outcome: undefined as TOutcome,
		runStatus: "error",
		end: { status: "error", error: { kind: "internal", message: errorName(error) }, attempts: 0 },
		events: [],
		blobs: [],
	};
}

/** Error name only: messages may embed prompts or provider payloads (§4.7). */
function errorName(error: unknown): string {
	if (error instanceof KernelNodeError) return `${error.name}(${error.code})`;
	if (error instanceof Error) return error.name;
	return typeof error;
}
