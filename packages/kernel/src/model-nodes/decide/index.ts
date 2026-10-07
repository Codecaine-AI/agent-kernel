/**
 * `kernel.decide` (plan §3.5): closed questions through a DecisionEngine
 * (default: Pi `classify()`), answers validated and thresholded, recorded
 * intent-first through the shared node lifecycle (`runModelNode`).
 *
 * decide rejects only with KernelDecideValidationError (before any row) or
 * KernelNodeError (scope, `in-flight-elsewhere`, `row-write-failed`, and
 * `invalid-request` for a requestId reused for a different request). Every
 * engine failure resolves: all answers abstain and the outcome carries the
 * error. Logs carry ids, names, model refs and error kinds only (§4.7).
 *
 * Secrets (§4.7): decision credentials are known only from the outbound
 * request headers, so the claim commits a pending classifier-context
 * placeholder and the completion stores the context scrubbed with the
 * complete set under call_end.input_blob_hash; the snapshot, wire request and
 * response, answers, model ids and error summaries are scrubbed the same way.
 *
 * Cancellation wins over a late result (§4.6): once the caller's signal or
 * the operation deadline fired, the decision ends aborted (error kind
 * "aborted" or "timeout") with every answer abstained. A requestId whose
 * decision already completed replays its stored outcome even with an
 * aborted signal: replay happens at the claim, before any engine work.
 */
import { createHash } from "node:crypto";

import type { TraceBlobInput } from "@agent-kernel/db";
import {
	createDecisionMadeEvent,
	createPiRequestSnapshotEvent,
	createPiTurnEndEvent,
	createPiTurnStartEvent,
	type CallEndData,
	type CallStartData,
	type DecisionMadeData,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";
import type { ClassifierQuestion, JsonObject as PiJsonObject } from "@earendil-works/pi-ai";

import { canonicalJson, jsonBlob } from "../blobs";
import { resolveModelAlias, type ModelNodeContext } from "../context";
import {
	requestFingerprint,
	runModelNode,
	type NodeExecution,
	type NodeReplayInput,
	type NodeRunHandle,
} from "../node-run";
import { splitModelRef } from "../pi-models";
import { priceNodeUsage } from "../pricing";
import { mergeSecrets, redactDeep, redactText } from "../redact";
import { resolveNodeScope } from "../scope";
import {
	DEFAULT_DECIDE_MAX_RETRIES,
	DEFAULT_DECIDE_MAX_RETRY_DELAY_MS,
	DEFAULT_DECIDE_TIMEOUT_MS,
	KernelDecideValidationError,
	KernelNodeError,
	toPiQuestions,
	type Decision,
	type DecisionEngine,
	type DecisionOutcome,
	type DecisionQuestion,
	type DecisionState,
	type EngineErrorKind,
	type EngineResult,
	type KernelDecideFn,
	type KernelDecideOptions,
	type NodeIds,
	type ThresholdApplied,
} from "../types";
import { budgetFor, DEFAULT_TOKEN_BUDGETS, estimateDecisionTokens } from "./budget";
import { createPiDecisionEngine, isDescribedEngine, summarizeEngineError, type PiEngineRequest } from "./pi-engine";
import {
	applyThresholds,
	chosenLabel,
	DEFAULT_THRESHOLDS,
	mostSevereReason,
	outcomeConfidenceSource,
} from "./thresholds";
import { callOptionIssues, checkState, decideConfigIssues, effectiveThresholds, questionIssues } from "./validate";
import { DEFAULT_WIRE_PRECISION, malformedAnswers, precisionFor } from "./validate-answers";

export {
	classifyError,
	createPiDecisionEngine,
	engineIdForApi,
	summarizeEngineError,
	type DecisionRoute,
	type PiDecisionEngine,
	type PiDecisionEngineOptions,
	type PiEngineRequest,
} from "./pi-engine";
export { DEFAULT_THRESHOLDS } from "./thresholds";
export { DEFAULT_TOKEN_BUDGETS } from "./budget";
export { DEFAULT_WIRE_PRECISION } from "./validate-answers";

/** Internal options for a decide run on behalf of another node (M4 gates). */
export interface DecideInternalOptions {
	/** The enclosing gate's span id: written as `gate_span_id` on call_start, decision_made and call_end. */
	gateSpanId?: string;
}

/** Called once per kernel from createKernel; validates `ctx.decide` and throws KernelDecideValidationError. */
export function createDecide(ctx: ModelNodeContext): KernelDecideFn {
	const decider = deciderFor(ctx);
	return (name, state, opts) => decider.run(name, state, opts, {});
}

/** `kernel.decide` with internal options (gate checks). Same contract as kernel.decide. */
export function decideInternal<Q extends Record<string, DecisionQuestion>>(
	ctx: ModelNodeContext,
	name: string,
	state: DecisionState,
	opts: KernelDecideOptions<Q>,
	internal: DecideInternalOptions,
): Promise<DecisionOutcome<Q>> {
	return deciderFor(ctx).run(name, state, opts, internal);
}

/**
 * Throws KernelDecideValidationError when `questions` (thresholds merged
 * with this kernel's defaults) or `state` are invalid. No rows, no network:
 * gates call it for every decide check before gate_start.
 */
export function validateDecideRequest(
	ctx: ModelNodeContext,
	state: DecisionState,
	questions: Record<string, DecisionQuestion>,
): void {
	deciderFor(ctx).validate(state, questions, {});
}

// ── per-kernel decider ─────────────────────────────────────────────────────────

interface ResolvedDecideConfig {
	engine: DecisionEngine;
	timeoutMs: number;
	maxRetries: number;
	maxRetryDelayMs: number;
	tokenBudgets: Readonly<Record<string, number>>;
	defaults: Required<ThresholdApplied>;
	wirePrecision: Readonly<Record<string, number>>;
}

interface Decider {
	/** `name` is checked only when given (kernel.decide always gives it; gate pre-validation has none yet). */
	validate(
		state: DecisionState,
		questions: unknown,
		opts: { timeoutMs?: unknown; maxRetries?: unknown },
		name?: { value: unknown },
	): { state: PiJsonObject; stateJson: string };
	run<Q extends Record<string, DecisionQuestion>>(
		name: string,
		state: DecisionState,
		opts: KernelDecideOptions<Q>,
		internal: DecideInternalOptions,
	): Promise<DecisionOutcome<Q>>;
}

const deciders = new WeakMap<ModelNodeContext, Decider>();

function deciderFor(ctx: ModelNodeContext): Decider {
	let decider = deciders.get(ctx);
	if (!decider) {
		decider = buildDecider(ctx);
		deciders.set(ctx, decider);
	}
	return decider;
}

function resolveConfig(ctx: ModelNodeContext): ResolvedDecideConfig {
	const config = ctx.decide;
	const issues = decideConfigIssues(config);
	if (issues.length > 0) throw new KernelDecideValidationError(issues);
	const maxRetryDelayMs = config?.maxRetryDelayMs ?? DEFAULT_DECIDE_MAX_RETRY_DELAY_MS;
	const models = config?.models;
	return {
		engine:
			config?.engine ??
			createPiDecisionEngine({
				models: models ?? (async () => ctx.piModels().registry()),
				maxRetryDelayMs,
			}),
		timeoutMs: config?.timeoutMs ?? DEFAULT_DECIDE_TIMEOUT_MS,
		maxRetries: config?.maxRetries ?? DEFAULT_DECIDE_MAX_RETRIES,
		maxRetryDelayMs,
		tokenBudgets: { ...DEFAULT_TOKEN_BUDGETS, ...config?.tokenBudgets },
		defaults: { ...(config?.defaults ?? DEFAULT_THRESHOLDS) },
		wirePrecision: { ...DEFAULT_WIRE_PRECISION, ...config?.wirePrecision },
	};
}

function buildDecider(ctx: ModelNodeContext): Decider {
	const config = resolveConfig(ctx);

	const validate: Decider["validate"] = (state, questions, opts, name) => {
		const issues: string[] = [];
		if (name !== undefined && !(typeof name.value === "string" && name.value.trim().length > 0)) {
			issues.push("decision name must be a non-empty string");
		}
		const checked = checkState(state);
		if (!checked.ok) issues.push(...checked.issues);
		issues.push(...questionIssues(questions, config.defaults), ...callOptionIssues(opts));
		if (issues.length > 0 || !checked.ok) throw new KernelDecideValidationError(issues);
		return { state: checked.state, stateJson: checked.json };
	};

	return {
		validate,
		async run<Q extends Record<string, DecisionQuestion>>(
			name: string,
			rawState: DecisionState,
			opts: KernelDecideOptions<Q>,
			internal: DecideInternalOptions,
		): Promise<DecisionOutcome<Q>> {
			const { state, stateJson } = validate(rawState, opts?.questions, opts ?? {}, { value: name });
			const questions: Record<string, DecisionQuestion> = opts.questions;
			const scope = await resolveNodeScope(
				{
					...(opts.containerId !== undefined && { containerId: opts.containerId }),
					...(opts.parentRunId !== undefined && { parentRunId: opts.parentRunId }),
					...(opts.parentToolUseId !== undefined && { parentToolUseId: opts.parentToolUseId }),
					...(opts.displayLabel !== undefined && { displayLabel: opts.displayLabel }),
					...(opts.trigger !== undefined && { trigger: opts.trigger }),
				},
				{ db: ctx.db(), defaultTrigger: "judge" },
			);

			const piQuestions = toPiQuestions(questions);
			const requestedRef = opts.model ?? ctx.models.defaults.decide;
			const modelRef = requestedRef !== undefined ? resolveModelAlias(requestedRef, ctx.models.aliases) : undefined;
			const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
			const maxRetries = opts.maxRetries ?? config.maxRetries;
			const deadlineMs = operationDeadlineMs(timeoutMs, maxRetries, config.maxRetryDelayMs);

			const synthetic = preflight(modelRef, stateJson, piQuestions, config.tokenBudgets);
			const route = modelRef && isDescribedEngine(config.engine) ? await config.engine.describe(modelRef) : undefined;
			const split = modelRef ? splitModelRef(modelRef) : undefined;
			const label = {
				engine: route?.engine ?? ("pi-ai" as const),
				provider: route?.provider ?? split?.provider ?? "",
				...(route?.api ? { api: route.api } : {}),
			};

			const contextValue = { state, questions: piQuestions };
			const promptHash = `dq1-${createHash("sha256").update(canonicalJson({ questions: piQuestions })).digest("hex")}`;
			// The credential set is complete only after the engine sent (§4.7): the claim commits a pending
			// placeholder, and the completion stores the scrubbed context under call_end.input_blob_hash.
			const input = jsonBlob("classifier-context", PENDING_CONTEXT, new Date(ctx.clock.now()).toISOString());
			// One requestId names one request: everything that decides the outcome, thresholds included.
			const fingerprint = requestFingerprint({
				kind: "decision",
				name,
				state,
				questions: Object.fromEntries(
					Object.entries(questions).map(([id, q]) => [
						id,
						{ question: piQuestions[id], thresholds: effectiveThresholds(q, config.defaults) },
					]),
				),
				model: modelRef ?? null,
				// The run it describes, not where it is filed: a container can legitimately differ per job.
				scope: { parentRunId: scope.parentRunId ?? null, parentToolUseId: scope.parentToolUseId ?? null },
			});
			const logIds = { name, model: modelRef ?? null };

			const result = await runModelNode<DecisionOutcome<Q>>(ctx, {
				kind: "decision",
				name,
				scope,
				...(opts.requestId !== undefined && { requestId: opts.requestId }),
				...(opts.signal !== undefined && { signal: opts.signal }),
				...(opts.onNodeStarted !== undefined && { onNodeStarted: opts.onNodeStarted }),
				deadlineMs,
				fingerprint,
				start: {
					engine: label.engine,
					model: modelRef ?? "",
					...(requestedRef !== undefined && requestedRef !== modelRef && { model_alias: requestedRef }),
					...(label.provider && { provider: label.provider }),
					...(label.api && { api: label.api }),
					prompt_hash: promptHash,
					input_blob_hash: input.hash,
					...(internal.gateSpanId !== undefined && { gate_span_id: internal.gateSpanId }),
				},
				startBlobs: [input.blob],
				async execute(handle) {
					const engineResult: EngineResult = synthetic
						? syntheticResult(synthetic, modelRef ?? "", label)
						: await invokeEngine(config.engine, {
								model: modelRef!,
								state,
								questions: piQuestions,
								signal: handle.signal,
								timeoutMs,
								maxRetries,
								maxRetryDelayMs: config.maxRetryDelayMs,
							});
					const execution = buildExecution<Q>({
						handle,
						name,
						questions,
						contextValue,
						promptHash,
						engineResult,
						callerAborted: opts.signal?.aborted === true,
						gateSpanId: internal.gateSpanId,
						config,
						ctx,
					});
					const o = execution.outcome;
					ctx.logger?.debug("decision made", {
						...logIds,
						runId: handle.ids.runId,
						servedModel: o.model,
						abstained: o.abstained,
						...(o.error && { errorKind: o.error.kind }),
					});
					return execution;
				},
				replay: (prior) => replayOutcome<Q>(prior, { name, promptHash }),
			});
			return { ...result.outcome, ids: result.ids, replayed: result.replayed, coalesced: result.coalesced };
		},
	};
}

/**
 * §4.6 operation deadline: every request and every server-allowed retry delay,
 * plus a grace (10 %, 50 ms to 1 s). The deadline clock starts before the
 * claim, so without the grace it would beat Pi's own per-attempt timeout: an
 * ordinary attempt timeout must end `error` (timeout), and only a real
 * overrun of the operation ends `aborted`.
 */
export function operationDeadlineMs(timeoutMs: number, maxRetries: number, maxRetryDelayMs: number): number {
	const budget = timeoutMs * (maxRetries + 1) + maxRetries * maxRetryDelayMs;
	return budget + Math.min(1_000, Math.max(50, Math.round(budget * 0.1)));
}

/** No network for an unconfigured model or an over-budget request (§4.3 token budget). */
function preflight(
	modelRef: string | undefined,
	stateJson: string,
	questions: Record<string, ClassifierQuestion>,
	budgets: Readonly<Record<string, number>>,
): { kind: EngineErrorKind; message: string } | undefined {
	if (!modelRef) {
		return { kind: "not-configured", message: "no decision model: pass opts.model or set models.defaults.decide" };
	}
	const budget = budgetFor(modelRef, budgets);
	if (budget === undefined) return undefined;
	const estimate = estimateDecisionTokens(stateJson, questions);
	if (estimate <= budget) return undefined;
	return { kind: "too-large", message: `estimated ${estimate} tokens exceeds the ${budget}-token budget of ${modelRef}` };
}

/** The claim-time classifier-context: the scrubbed context is written with the completion. */
const PENDING_CONTEXT = { pending: true } as const;

/** Results the kernel built itself (preflight, a rejecting engine): their messages carry no provider text. */
const kernelAuthored = new WeakSet<EngineResult>();

function syntheticResult(
	failure: { kind: EngineErrorKind; message: string },
	modelRef: string,
	label: { engine: EngineResult["engine"]; provider: string; api?: string },
): EngineResult {
	const result: EngineResult = {
		ok: false,
		engine: label.engine,
		api: label.api ?? "",
		provider: label.provider,
		requestedModel: modelRef,
		resolvedModel: modelRef,
		answers: {},
		latencyMs: 0,
		attempts: 0,
		startedAtMs: Date.now(),
		error: failure,
		secrets: [],
	};
	kernelAuthored.add(result);
	return result;
}

/** The engine contract is "never rejects"; a rejecting engine is mapped to a provider error, never propagated. */
async function invokeEngine(engine: DecisionEngine, request: PiEngineRequest): Promise<EngineResult> {
	try {
		const result = await engine.classify(request);
		if (result === null || typeof result !== "object") throw new TypeError("decision engine returned no result");
		return {
			...result,
			answers: result.answers ?? {},
			secrets: Array.isArray(result.secrets) ? result.secrets : [],
		};
	} catch (error) {
		const split = splitModelRef(request.model);
		const result: EngineResult = {
			ok: false,
			engine: "pi-ai",
			api: "",
			provider: split?.provider ?? "",
			requestedModel: request.model,
			resolvedModel: request.model,
			answers: {},
			latencyMs: 0,
			attempts: 0,
			startedAtMs: Date.now(),
			error: {
				kind: request.signal?.aborted ? "aborted" : "provider",
				message: `decision engine threw ${error instanceof Error ? error.name : typeof error}`,
			},
			secrets: [],
		};
		kernelAuthored.add(result);
		return result;
	}
}

// ── outcome and events ─────────────────────────────────────────────────────────

interface BuildExecutionInput {
	handle: NodeRunHandle;
	name: string;
	questions: Record<string, DecisionQuestion>;
	contextValue: { state: PiJsonObject; questions: Record<string, ClassifierQuestion> };
	promptHash: string;
	engineResult: EngineResult;
	callerAborted: boolean;
	gateSpanId: string | undefined;
	config: ResolvedDecideConfig;
	ctx: ModelNodeContext;
}

function buildExecution<Q extends Record<string, DecisionQuestion>>(
	input: BuildExecutionInput,
): NodeExecution<DecisionOutcome<Q>> {
	const { handle, name, questions, engineResult: r, config, ctx } = input;
	// The kernel's second scrub pass (§4.7) over everything engine-supplied that gets persisted.
	const secrets = mergeSecrets(r.secrets);
	const wireRequest = r.wireRequest !== undefined ? redactDeep(r.wireRequest, secrets) : undefined;
	const wireResponse = r.wireResponse !== undefined ? redactDeep(r.wireResponse, secrets) : undefined;

	// Cancellation wins over a late result (§4.6): once the caller's signal or the operation deadline
	// fired, the decision ends aborted with every answer abstained, even if the engine still answered.
	const aborted = handle.signal.aborted || (!r.ok && r.error?.kind === "aborted");
	const deadline = aborted && handle.deadlineExceeded() && !input.callerAborted;
	const accepted = !aborted && r.ok;
	const malformed = accepted ? malformedAnswers(r.answers, questions, precisionFor(r.api, config.wirePrecision)) : [];
	const answers = applyThresholds(
		aborted ? { ok: false, answers: {}, error: { kind: "aborted", message: "aborted" } } : r,
		questions,
		config.defaults,
		new Set(malformed),
	);
	const abstainReason = mostSevereReason(Object.values(answers));
	const abstained = Object.values(answers).some((d) => d.abstained);

	let error: DecisionOutcome<Q>["error"];
	if (deadline) {
		error = { kind: "timeout", message: "decision operation deadline exceeded" };
	} else if (aborted) {
		error = { kind: "aborted", message: "decision request aborted" };
	} else if (r.error && !r.ok) {
		error = {
			kind: r.error.kind,
			// Engine messages can quote provider bodies that echo state and instructions (§4.4): summary only.
			message: redactText(
				kernelAuthored.has(r)
					? r.error.message
					: summarizeEngineError({ ...r.error, message: redactText(r.error.message, secrets) }),
				secrets,
			),
			...(r.error.httpStatus !== undefined && { httpStatus: r.error.httpStatus }),
		};
	} else if (malformed.length > 0) {
		error = { kind: "malformed-answer", message: `malformed answers: ${malformed.join(", ")}` };
	}
	const runStatus = aborted ? "aborted" : abstainReason === "engine-error" ? "error" : "done";
	// A done decision was answered (a refusal is an answer), so the engine reached the model at least once.
	const attempts = runStatus === "done" ? Math.max(1, r.attempts) : r.attempts;

	const requestedModel = redactText(r.requestedModel, secrets);
	const servedModel = redactText(r.resolvedModel, secrets) || requestedModel;
	const usage: TurnUsage | undefined = r.usage
		? priceNodeUsage(
				{
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					model: servedModel,
				},
				ctx.models.prices,
			)
		: undefined;

	// Engine-reported timing is clamped into this run: [handle start, now].
	const nowMs = Math.max(ctx.clock.now(), handle.startedAtMs);
	const attemptStartMs = clampMs(r.startedAtMs, handle.startedAtMs, nowMs);
	const timing = { attemptStartMs, latencyMs: Math.round(clampMs(r.latencyMs, 0, nowMs - attemptStartMs)) };

	const events: TraceEvent[] = [];
	const blobs: TraceBlobInput[] = [];
	const addBlob = (kind: string, value: unknown, at: string) => {
		const blob = jsonBlob(kind, value, at);
		blobs.push(blob.blob);
		return blob.hash;
	};
	// Every persisted copy of the request goes through the complete credential set (§4.7).
	const context = redactDeep(input.contextValue, secrets);

	if (attempts > 0) {
		// pi_turn_start < pi_request_snapshot < pi_turn_end, as a chat turn orders them (the snapshot is
		// recorded at its turn_start); the window spans at least 2 ms so no two share a timestamp.
		const window = handle.turnWindow(timing.attemptStartMs, Math.max(timing.latencyMs, 2));
		const snapshotAt = new Date(Date.parse(window.start) + 1).toISOString();
		const text = JSON.stringify(context, null, 2);
		const messageHash = addBlob(
			"message",
			{ role: "classifier_context", content: [{ type: "text", text }] },
			snapshotAt,
		);
		const rawRequestHash = wireRequest !== undefined ? addBlob("classifier-request", wireRequest, snapshotAt) : undefined;
		const responseHash = wireResponse !== undefined ? addBlob("call-response", wireResponse, window.end) : undefined;
		events.push(
			createPiTurnStartEvent(handle.traceIds, {
				turnNumber: 0,
				eventId: handle.eventId(0, "pi_turn_start"),
				parentEventId: handle.startEventId,
				timestamp: window.start,
			}),
			createPiRequestSnapshotEvent(
				handle.traceIds,
				{
					turn_number: 0,
					system_prompt_blob_hash: null,
					prompt_hash: input.promptHash,
					message_count: 1,
					message_refs: [
						{
							blob_hash: messageHash,
							role: "classifier_context",
							index: 0,
							text_chars: text.length,
							image_count: 0,
							tool_call_count: 0,
						},
					],
					total_text_chars: text.length,
					total_image_count: 0,
					...(rawRequestHash !== undefined && { raw_request_blob_hash: rawRequestHash }),
					request_kind: "classifier",
				},
				{ eventId: handle.eventId(0, "pi_request_snapshot"), parentEventId: handle.startEventId, timestamp: snapshotAt },
			),
			createPiTurnEndEvent(handle.traceIds, {
				turnNumber: 0,
				stopReason: aborted ? "aborted" : r.ok ? "stop" : "error",
				...(usage && { usage }),
				...(responseHash !== undefined && { responseBlobHash: responseHash }),
				...(r.error?.httpStatus !== undefined && { httpStatus: r.error.httpStatus }),
				durationMs: timing.latencyMs,
				eventId: handle.eventId(0, "pi_turn_end"),
				parentEventId: handle.startEventId,
				timestamp: window.end,
			}),
		);
	}

	const thresholdApplied: Record<string, ThresholdApplied> = {};
	for (const [id, decision] of Object.entries(answers)) thresholdApplied[id] = decision.thresholdApplied;
	const chosen = chosenLabel(answers);
	const confidenceSource = outcomeConfidenceSource(Object.values(answers));
	const madeAt = handle.timestamp();
	// Labels are caller-declared; the persisted copies are scrubbed all the same.
	const persistedAnswers = redactDeep(answers, secrets);
	const made: DecisionMadeData = {
		run_id: handle.ids.runId,
		decision_name: name,
		answers: persistedAnswers,
		chosen: redactText(chosen, secrets),
		confidence_source: confidenceSource,
		abstained,
		...(abstainReason && { abstain_reason: abstainReason }),
		threshold_applied: thresholdApplied,
		engine: r.engine,
		provider: r.provider,
		...(r.api && { api: r.api }),
		model: servedModel,
		requested_model: requestedModel,
		...(error && { error_kind: error.kind }),
		...(input.gateSpanId !== undefined && { gate_span_id: input.gateSpanId }),
	};
	events.push(
		createDecisionMadeEvent(handle.traceIds, made, {
			eventId: handle.eventId(0, "decision_made"),
			parentEventId: handle.startEventId,
			timestamp: madeAt,
		}),
	);
	const outputHash = addBlob("call-output", persistedAnswers, madeAt);
	const inputHash = addBlob("classifier-context", context, madeAt);

	return {
		outcome: {
			decisionName: name,
			ids: handle.ids,
			answers: answers as DecisionOutcome<Q>["answers"],
			chosen,
			abstained,
			...(abstainReason && { abstainReason }),
			confidenceSource,
			engine: r.engine,
			provider: r.provider,
			...(r.api && { api: r.api }),
			model: servedModel,
			requestedModel,
			...(usage && { usage }),
			latencyMs: timing.latencyMs,
			...(error && { error }),
			replayed: false,
			coalesced: false,
		},
		runStatus,
		end: {
			status: runStatus === "done" ? "ok" : runStatus,
			input_blob_hash: inputHash,
			output_blob_hash: outputHash,
			...(error && {
				error: {
					kind: error.kind,
					message: error.message,
					...(error.httpStatus !== undefined && { http_status: error.httpStatus }),
				},
			}),
			...(usage && { usage }),
			attempts,
			resolved_model: servedModel,
		},
		events,
		blobs,
	};
}

/** `value` clamped into [min, max]; a non-finite value becomes `min`. */
function clampMs(value: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return min;
	return Math.min(Math.max(value, min), max);
}

/**
 * Rebuilds a prior done run's outcome from its decision_made and call_end;
 * writes nothing. The requestId must name the same decision: a different
 * name or question set (prompt hash) is rejected, never answered with
 * another decision's answers.
 */
function replayOutcome<Q extends Record<string, DecisionQuestion>>(
	prior: NodeReplayInput,
	expected: { name: string; promptHash: string },
): DecisionOutcome<Q> {
	const start = prior.events.find((e) => e.type === "call_start")?.eventData as CallStartData | undefined;
	const made = prior.events.find((e) => e.type === "decision_made")?.eventData as DecisionMadeData | undefined;
	const end = prior.events.find((e) => e.type === "call_end")?.eventData as CallEndData | undefined;
	if (start && (start.function_name !== expected.name || start.prompt_hash !== expected.promptHash)) {
		throw new KernelNodeError(
			"invalid-request",
			`requestId was already used for a different decision (run ${prior.ids.runId}): name or questions differ`,
		);
	}
	if (!made) {
		throw new KernelNodeError("invalid-request", `decision run ${prior.ids.runId} has no decision_made to replay`);
	}
	return {
		decisionName: made.decision_name,
		ids: prior.ids as NodeIds,
		answers: made.answers as Record<string, Decision> as DecisionOutcome<Q>["answers"],
		chosen: made.chosen,
		abstained: made.abstained,
		...(made.abstain_reason && { abstainReason: made.abstain_reason }),
		confidenceSource: made.confidence_source,
		engine: made.engine,
		provider: made.provider,
		...(made.api && { api: made.api }),
		model: made.model,
		requestedModel: made.requested_model,
		...(end?.usage && { usage: end.usage }),
		latencyMs: end?.duration_ms ?? 0,
		...(end?.error && {
			error: {
				kind: end.error.kind as EngineErrorKind,
				message: end.error.message,
				...(end.error.http_status !== undefined && { httpStatus: end.error.http_status }),
			},
		}),
		replayed: true,
		coalesced: false,
	};
}
