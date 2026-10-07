/**
 * Model-node contracts (plan §4.1): `kernel.call`, `kernel.decide`,
 * `kernel.step`, `kernel.gate`, and the engine seams behind them.
 *
 * Serializable decision types live in @agent-kernel/protocol (the
 * `decision_made` payload carries them and protocol cannot depend on the
 * kernel); this module imports and re-exports them, never redefines them.
 */
import type {
	ClassifierQuestion,
	JsonObject as PiJsonObject,
	Models as PiModels,
} from "@earendil-works/pi-ai";
import type {
	AbstainReason,
	ConfidenceSource,
	Decision,
	ThresholdApplied,
	TurnUsage,
} from "@agent-kernel/protocol";

export type { AbstainReason, ConfidenceSource, Decision, ThresholdApplied };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ── scope shared by every node ────────────────────────────────────────────────

export type NodeTrigger = "post-run" | "judge" | "parent-tool" | "system" | "operator";

export interface NodeIds {
	containerId: string;
	/** call/decision only; "" for steps and gates. */
	sessionId: string;
	/** call/decision: the node's own run. step/gate: the parent run or "". */
	runId: string;
	parentRunId?: string;
}

export interface NodeScopeOptions {
	/** Defaults to the parent run's container, then the ambient RunContext container. Required if neither exists. */
	containerId?: string;
	/** The run this node describes. Must exist in this kernel's DB (FK). Defaults to the ambient RunContext run. */
	parentRunId?: string;
	parentToolUseId?: string;
	displayLabel?: string;
	/** Idempotency key, unique per kernel id (§4.6). */
	requestId?: string;
	signal?: AbortSignal;
	/** Fires after identity rows exist and before any engine request. */
	onNodeStarted?: (ids: NodeIds) => void;
}

export type KernelNodeErrorCode =
	| "no-db"
	| "no-container"
	| "unknown-parent-run"
	| "no-engine"
	| "unknown-function"
	| "invalid-request"
	| "row-write-failed"
	| "in-flight-elsewhere";

export interface KernelNodeErrorOptions {
	cause?: unknown;
	/** A computed call value whose completion write failed (§4.6). */
	value?: unknown;
	/** A computed gate result whose gate_end write failed (§3.6). */
	gateResult?: GateResult;
}

export class KernelNodeError extends Error {
	readonly code: KernelNodeErrorCode;
	readonly value?: unknown;
	readonly gateResult?: GateResult;

	constructor(code: KernelNodeErrorCode, message?: string, options: KernelNodeErrorOptions = {}) {
		super(message ?? code, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = "KernelNodeError";
		this.code = code;
		if ("value" in options) this.value = options.value;
		if (options.gateResult !== undefined) this.gateResult = options.gateResult;
	}
}

// ── kernel.call ───────────────────────────────────────────────────────────────

type AnyFn = (...args: any[]) => Promise<any>;

/** Capitalized async methods of a generated BAML client (`b`). */
export type FnName<C> = {
	[K in keyof C]: C[K] extends AnyFn ? (K extends `${Uppercase<string>}${string}` ? K : never) : never;
}[keyof C] &
	string;
type FnOf<C, K extends FnName<C>> = C[K] extends AnyFn ? C[K] : never;
/** Positional BAML arguments without the trailing options bag. */
export type CallArgs<C, K extends FnName<C>> =
	Required<Parameters<FnOf<C, K>>> extends [...infer A, unknown] ? A : never;
export type CallResult<C, K extends FnName<C>> = Awaited<ReturnType<FnOf<C, K>>>;

export interface KernelCallOptions extends NodeScopeOptions {
	/** Default: "parent-tool" when parentToolUseId is passed; else "post-run" with a parent run; else "system" (§4.6). */
	trigger?: Exclude<NodeTrigger, "operator">;
	/** Alias or "provider/id". Default: manifest.model, then models.defaults.call. */
	model?: string;
	/** Default calls.defaultTimeoutMs (120_000). */
	timeoutMs?: number;
	/** Default calls.reasoning ("low"). */
	reasoning?: "low" | "medium" | "high";
}

export interface CallManifest {
	$schema: "agent-kernel/call-v1";
	name: string;
	description: string;
	model?: string;
	/** Reserved, ignored in v1. */
	exposeAsTool?: boolean;
}

export interface ResolvedRoute {
	/** "codex-lb/gpt-5.6-sol" */
	modelRef: string;
	provider: string;
	modelId: string;
	/** Pi api id, e.g. "openai-responses". */
	api: string;
	baseUrl: string;
	/** Never persisted; listed in `secrets`. */
	apiKey?: string;
	headers: Record<string, string>;
	reasoning: "low" | "medium" | "high";
}

export interface EngineAttempt {
	transport: "baml-http" | "pi";
	clientName: string;
	provider: string;
	startedAtMs: number;
	durationMs: number | null;
	selected: boolean;
	/** HTTP status; null for stream/no response. */
	status: number | null;
	/** model = served model id (bare); the kernel prefixes the provider. */
	usage: Omit<TurnUsage, "costEstimate"> | null;
	reasoningTokens?: number;
	/** Already redacted by the engine; the kernel redacts again before persisting. */
	request: { method: string; url: string; headers: Record<string, string>; body: unknown } | null;
	response: { status: number; headers: Record<string, string>; body: unknown } | { sse: unknown[] } | null;
}

export type CallFailure =
	| { kind: "parse"; message: string; rawOutput: string }
	| { kind: "http"; status: number; rawResponse?: string }
	| { kind: "timeout" }
	| { kind: "aborted" }
	| { kind: "finish_reason"; finishReason?: string; rawOutput: string }
	| { kind: "route"; message: string }
	| { kind: "other"; message: string };

export interface PiTransportRequest {
	systemPrompt?: string;
	messages: Array<{ role: "user" | "assistant"; text: string }>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * Bound by the kernel to the resolved model AND reasoning level; used by the
 * Pi-transport engine. `createPiTransport` sends through
 * `registry.streamSimple(model, context, { reasoning, signal, maxRetryDelayMs, fetch }).result()`
 * with a wrapping fetch that captures the ACTUAL outbound credential headers
 * (adding them to the per-call secret set, refusing 1–7 character credentials
 * before sending) and the response. Attempt, text and error message are
 * scrubbed with the union of the preflight and outbound sets before returning.
 */
export interface PiTransport {
	complete(req: PiTransportRequest): Promise<{
		attempt: EngineAttempt;
		text: string | null;
		errorMessage?: string;
		secrets: string[];
	}>;
}

export interface CallEngineInvokeRequest<C, K extends FnName<C>> {
	name: K;
	args: CallArgs<C, K>;
	route: ResolvedRoute;
	transport: PiTransport;
	signal?: AbortSignal;
	timeoutMs: number;
	/** { runId, containerId, functionName } */
	tags: Record<string, string>;
	/** Exact strings to scrub (api keys, bearer tokens). */
	secrets: readonly string[];
}

export type CallEngineOutcome<C, K extends FnName<C>> = { attempts: EngineAttempt[]; rawText: string | null } & (
	| { ok: true; value: CallResult<C, K> }
	| { ok: false; failure: CallFailure }
);

export interface CallEngine<C> {
	readonly engine: "baml" | "pi-ai";
	transportFor(name: FnName<C>): "baml-http" | "pi";
	functionNames(): FnName<C>[];
	manifest(name: FnName<C>): CallManifest | undefined;
	/** "baml1-<sha256>" over non-client sources. */
	promptHash(name: FnName<C>): string;
	/** Must not reject for engine failures; returns ok:false. May reject only for programmer errors. */
	invoke<K extends FnName<C>>(req: CallEngineInvokeRequest<C, K>): Promise<CallEngineOutcome<C, K>>;
}

export class KernelCallError extends Error {
	readonly runId: string;
	/** Its message never contains prompts or raw output. */
	readonly failure: CallFailure;

	constructor(functionName: string, runId: string, failure: CallFailure) {
		super(`${functionName} failed: ${failure.kind}`);
		this.name = "KernelCallError";
		this.runId = runId;
		this.failure = failure;
	}
}

// ── kernel.decide ─────────────────────────────────────────────────────────────

export interface BoolQuestion {
	type: "bool";
	instructions: string;
	criteria: { true: string; false: string };
	passAt?: number;
	failAt?: number;
}
export interface ChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
	minTop?: number;
	minMargin?: number;
}
export interface ScoreQuestion {
	type: "score";
	instructions: string;
	criteria: string[];
	abstainBelow?: number;
}
export type DecisionQuestion = BoolQuestion | ChoiceQuestion | ScoreQuestion;
export type DecisionState = JsonObject | string;

export type DecisionEngineId = "jev" | "openai-decisions" | "pi-ai" | "baml";

export interface KernelDecideOptions<Q extends Record<string, DecisionQuestion>> extends NodeScopeOptions {
	questions: Q;
	/** Default "judge". */
	trigger?: Exclude<NodeTrigger, "operator">;
	/** Alias or "provider/id"; default models.defaults.decide. */
	model?: string;
	/** Default decide.timeoutMs (5_000). */
	timeoutMs?: number;
	/** Default decide.maxRetries (1). */
	maxRetries?: number;
}

export type EngineErrorKind =
	| "aborted"
	| "timeout"
	| "auth"
	| "too-large"
	| "unknown-model"
	| "invalid-request"
	| "rate-limit"
	| "refusal"
	| "provider"
	| "not-configured"
	| "malformed-answer";

export interface DecisionOutcome<Q extends Record<string, DecisionQuestion>> {
	decisionName: string;
	ids: NodeIds;
	answers: { [K in keyof Q]: Decision };
	/** Sole question: its label ("true"/"false"/choice/score as string) or "abstain". Several: "qid=label" pairs, sorted by qid, joined by ",". */
	chosen: string;
	/** Any answer abstained. */
	abstained: boolean;
	/** Most severe: engine-error > refusal > low-confidence. */
	abstainReason?: AbstainReason;
	confidenceSource: ConfidenceSource;
	engine: DecisionEngineId;
	provider: string;
	api?: string;
	/** Served "provider/id" (wire), else requested. */
	model: string;
	requestedModel: string;
	/** Priced; model = served "provider/id". */
	usage?: TurnUsage;
	latencyMs: number;
	error?: { kind: EngineErrorKind; message: string; httpStatus?: number };
	/** True when returned from a prior run via requestId. */
	replayed: boolean;
	/** True when this call awaited an identical in-flight requestId in the same kernel. */
	coalesced: boolean;
}

/**
 * Converts kernel questions to Pi's discriminated union (pi-ai
 * `ClassifierQuestion`): strips the threshold fields, never casts.
 */
export function toPiQuestions(q: Record<string, DecisionQuestion>): Record<string, ClassifierQuestion> {
	const out: Record<string, ClassifierQuestion> = {};
	for (const [id, question] of Object.entries(q)) {
		switch (question.type) {
			case "bool":
				out[id] = {
					type: "bool",
					instructions: question.instructions,
					criteria: { true: question.criteria.true, false: question.criteria.false },
				};
				break;
			case "choice":
				out[id] = { type: "choice", instructions: question.instructions, criteria: { ...question.criteria } };
				break;
			case "score":
				out[id] = { type: "score", instructions: question.instructions, criteria: [...question.criteria] };
				break;
		}
	}
	return out;
}

/** Engine seam (implemented by decide/pi-engine; tests inject fakes). */
export interface EngineRequest {
	/** "provider/id" */
	model: string;
	state: PiJsonObject;
	/** From toPiQuestions. */
	questions: Record<string, ClassifierQuestion>;
	signal?: AbortSignal;
	timeoutMs: number;
	maxRetries: number;
}
export interface EngineAnswer {
	type: "bool" | "choice" | "score";
	probability?: number;
	choice?: string;
	score?: number;
	distribution?: Record<string, number>;
	confidence?: number;
}
export interface EngineResult {
	ok: boolean;
	engine: DecisionEngineId;
	api: string;
	provider: string;
	requestedModel: string;
	resolvedModel: string;
	answers: Record<string, EngineAnswer>;
	usage?: { inputTokens: number; outputTokens: number };
	latencyMs: number;
	attempts: number;
	startedAtMs: number;
	error?: { kind: EngineErrorKind; message: string; httpStatus?: number };
	/** Already scrubbed by the engine. */
	wireRequest?: unknown;
	wireResponse?: unknown;
	/** Credential values captured from outbound request headers; used for the kernel's second scrub pass; never persisted. */
	secrets: string[];
}
/** Never rejects. */
export interface DecisionEngine {
	classify(request: EngineRequest): Promise<EngineResult>;
}

export class KernelDecideValidationError extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super(`invalid decision request: ${issues.length} issue${issues.length === 1 ? "" : "s"}`);
		this.name = "KernelDecideValidationError";
		this.issues = issues;
	}
}

// ── kernel.step / kernel.gate ─────────────────────────────────────────────────

export type StepAttributeValue = string | number | boolean | null;

export interface StepSpan {
	readonly spanId: string;
	/** Merged into step_end.attributes. */
	setAttributes(attrs: Record<string, StepAttributeValue>): void;
	setStatus(status: "ok" | "error", message?: string): void;
	/** Capped at 20, kept in step_end.events. */
	addEvent(name: string, attrs?: Record<string, StepAttributeValue>): void;
}

export interface KernelStepOptions<T = unknown> {
	containerId?: string;
	parentRunId?: string;
	/** Start facts; never prompts or outputs. */
	attributes?: Record<string, StepAttributeValue>;
	/** Deterministic spanId → event dedupe only. */
	requestId?: string;
	/** Small JSON for step_end.output_summary (capped at 4 KB, else replaced by {truncated:true, bytes}). */
	summarize?: (result: T) => JsonValue;
}

export type GateStepOutcome = boolean | { result: "pass" | "fail" | "abstain"; value?: JsonPrimitive; reason?: string };

export type GateCheckSpec =
	| {
			kind: "step";
			name: string;
			attributes?: Record<string, StepAttributeValue>;
			run: (span: StepSpan) => GateStepOutcome | Promise<GateStepOutcome>;
	  }
	| {
			kind: "decide";
			name: string;
			state: DecisionState;
			questions: Record<string, BoolQuestion>;
			model?: string;
			requestId?: string;
			timeoutMs?: number;
	  };

export interface KernelGateOptions {
	containerId?: string;
	parentRunId?: string;
	requestId?: string;
	/** Default "never": every check runs and is traced. */
	stopOn?: "never" | "fail";
	signal?: AbortSignal;
}

export type CheckResult = "pass" | "fail" | "abstain" | "skipped";

export interface GateCheckResult {
	name: string;
	kind: "step" | "decide";
	result: CheckResult;
	value?: JsonPrimitive;
	reason?: string;
	/** A thrown step check → result "fail". */
	error?: string;
	questions?: Array<{
		questionId: string;
		result: Exclude<CheckResult, "skipped">;
		runId: string;
		probability?: number;
		thresholdApplied: ThresholdApplied;
		abstainReason?: AbstainReason;
	}>;
}

export interface GateResult {
	gateName: string;
	spanId: string;
	/** "pass" only when every check was evaluated and passed; cancellation or any skipped check can never pass. */
	verdict: "pass" | "fail" | "abstain";
	/** The signal fired before every check was evaluated. */
	aborted: boolean;
	checks: GateCheckResult[];
	durationMs: number;
}

export class KernelGateError extends Error {
	readonly gateResult: GateResult;
	override readonly cause: unknown;

	constructor(gateResult: GateResult, cause: unknown) {
		const code = cause instanceof KernelNodeError ? cause.code : "error";
		super(`gate ${gateResult.gateName} failed: ${code}`);
		this.name = "KernelGateError";
		this.gateResult = gateResult;
		this.cause = cause;
	}
}

// ── kernel configuration (re-exported from @agent-kernel/kernel) ──────────────

export interface KernelCallsConfig<C> {
	engine: CallEngine<C>;
	/** 120_000 */
	defaultTimeoutMs?: number;
	/** "low" */
	reasoning?: "low" | "medium" | "high";
}

/** The Pi models surface decisions need; a ModelRuntime or ModelRegistry satisfies it. */
export type PiDecisionModels = Pick<PiModels, "classify" | "getModelOfType" | "getModelsOfType">;

export interface KernelDecideConfig {
	/** Default createPiDecisionEngine({ models: piModels() }). */
	engine?: DecisionEngine;
	/** Pi models surface; default: one ModelRuntime + ModelRegistry built from piAgentDir. */
	models?: PiDecisionModels;
	/** 5_000 */
	timeoutMs?: number;
	/** 1 */
	maxRetries?: number;
	/**
	 * 2_000. Pi REJECTS (engine error) a server-requested Retry-After above
	 * this; it does not shorten it. Enters the operation deadline (§4.6).
	 */
	maxRetryDelayMs?: number;
	/** Token budget for estimate(state) + max estimate(question). Keys: "provider/id" or "provider/*". */
	tokenBudgets?: Record<string, number>;
	/** { passAt: .85, failAt: .15, minTop: .6, minMargin: .2, abstainBelow: .5 } */
	defaults?: Required<ThresholdApplied>;
	/** Wire decimal step per Pi api id ("*" = fallback); each value finite, > 0, ≤ 1. */
	wirePrecision?: Record<string, number>;
}

export interface KernelNodesConfig {
	/** Freshness window for a "running" node run written without deadline_at (default 10 min). */
	staleAfterMs?: number;
	/**
	 * Pi model runtime and registry for call routes and transports. Default: one
	 * lazily built from `piAgentDir`. Tests and hosts that already hold a
	 * runtime inject it here.
	 */
	piModels?: import("./context").PiModelsSource;
}

export const DEFAULT_CALL_TIMEOUT_MS = 120_000;
export const DEFAULT_CALL_REASONING = "low" as const;
export const DEFAULT_DECIDE_TIMEOUT_MS = 5_000;
export const DEFAULT_DECIDE_MAX_RETRIES = 1;
export const DEFAULT_DECIDE_MAX_RETRY_DELAY_MS = 2_000;
export const DEFAULT_NODE_STALE_AFTER_MS = 10 * 60_000;

// ── kernel surface (KernelInstance members, built by createModelNodes) ─────────

/**
 * The resolved value of `kernel.call`: CallResult for a typed client;
 * `unknown` for a kernel whose TCalls is unknown, so a typed kernel stays
 * assignable to `KernelInstance<T>` (CallResult<unknown, never> is `never`).
 */
export type KernelCallResult<TCalls, K extends FnName<TCalls>> = unknown extends TCalls
	? unknown
	: CallResult<TCalls, K>;

export type KernelCallFn<TCalls> = <K extends FnName<TCalls>>(
	name: K,
	args: CallArgs<TCalls, K>,
	opts?: KernelCallOptions,
) => Promise<KernelCallResult<TCalls, K>>;

export type KernelDecideFn = <Q extends Record<string, DecisionQuestion>>(
	name: string,
	state: DecisionState,
	opts: KernelDecideOptions<Q>,
) => Promise<DecisionOutcome<Q>>;

export type KernelStepFn = <T>(
	name: string,
	opts: KernelStepOptions<T>,
	fn: (span: StepSpan) => T | Promise<T>,
) => Promise<T>;

export type KernelGateFn = (name: string, opts: KernelGateOptions, checks: readonly GateCheckSpec[]) => Promise<GateResult>;

export interface ModelNodes<TCalls = unknown> {
	call: KernelCallFn<TCalls>;
	decide: KernelDecideFn;
	step: KernelStepFn;
	gate: KernelGateFn;
}
