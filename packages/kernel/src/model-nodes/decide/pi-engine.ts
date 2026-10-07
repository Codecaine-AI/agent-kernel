/**
 * The default DecisionEngine (plan §4.3): one Pi `classify()` round-trip
 * per decision, normalized into an EngineResult. Ported from the
 * pi-classify spike's `createPiEngine` with:
 *
 * - pinning: an unlisted id is cloned from the provider's first listed
 *   classifier (cached per ref); Pi 1.0.4 lists only `jev-latest`;
 * - explicit `timeoutMs`, `maxRetries`, `maxRetryDelayMs` on every request
 *   (Pi REJECTS a server-requested delay above `maxRetryDelayMs`);
 * - a wrapping fetch that reads the ACTUAL outbound headers before sending,
 *   collects every credential into the per-request secret set, refuses a
 *   1–7 character credential before anything is sent, counts attempts, and
 *   captures the response body (served model, score probabilities);
 * - wire request, wire response and error message scrubbed before they
 *   leave the engine; the secret set is returned for the kernel's second pass.
 *
 * `classify` never rejects.
 */
import type { ClassifierAnswer, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";

import { SHORT_CREDENTIAL_MESSAGE, splitModelRef } from "../pi-models";
import {
	collectSecrets,
	findShortCredential,
	headerPairs,
	mergeSecrets,
	redactDeep,
	redactText,
	type HeaderSource,
} from "../redact";
import {
	DEFAULT_DECIDE_MAX_RETRIES,
	DEFAULT_DECIDE_MAX_RETRY_DELAY_MS,
	DEFAULT_DECIDE_TIMEOUT_MS,
	type DecisionEngine,
	type DecisionEngineId,
	type EngineAnswer,
	type EngineErrorKind,
	type EngineRequest,
	type EngineResult,
	type PiDecisionModels,
} from "../types";

/** EngineRequest plus the server retry-delay cap the kernel passes to Pi. */
export interface PiEngineRequest extends EngineRequest {
	/** Default: the engine's `maxRetryDelayMs` option (2_000). */
	maxRetryDelayMs?: number;
}

export interface PiDecisionEngineOptions {
	/** Any Pi models surface (pi-ai Models, ModelRuntime, ModelRegistry), or a lazy source of one. */
	models: PiDecisionModels | (() => Promise<PiDecisionModels>);
	/** Base fetch (tests inject one). Default `globalThis.fetch`, read at send time. */
	fetch?: typeof fetch;
	/** Default 2_000. */
	maxRetryDelayMs?: number;
}

/** What a model ref resolves to, known before any request (for `call_start`). */
export interface DecisionRoute {
	engine: DecisionEngineId;
	api: string;
	provider: string;
	modelId: string;
}

export interface PiDecisionEngine extends DecisionEngine {
	classify(request: PiEngineRequest): Promise<EngineResult>;
	/** Resolves "provider/id" without sending; undefined when the model is unknown or Pi is unavailable. */
	describe(modelRef: string): Promise<DecisionRoute | undefined>;
}

export function isDescribedEngine(engine: DecisionEngine): engine is PiDecisionEngine {
	return typeof (engine as Partial<PiDecisionEngine>).describe === "function";
}

/** Engine id from the Pi api: `typesafe-system-one` → jev, `openai-decisions` → openai-decisions, else pi-ai. */
export function engineIdForApi(api: string): DecisionEngineId {
	if (api === "typesafe-system-one") return "jev";
	if (api === "openai-decisions") return "openai-decisions";
	return "pi-ai";
}

/** A model declining to answer; never a transport failure such as "Connection refused". */
const REFUSAL_PATTERN = /\brefusal\b|\brefused to\b/i;

/**
 * Maps a Pi classify error message to an EngineErrorKind. The HTTP status
 * decides first (401/403 auth, 429/529 rate-limit, 5xx provider), so text in
 * a server body can never turn an outage into a refusal; body patterns only
 * refine other 4xx responses and messages without a status.
 */
export function classifyError(message: string, aborted: boolean): { kind: EngineErrorKind; httpStatus?: number } {
	const status = Number(/\((\d{3})\)/.exec(message)?.[1] ?? /\breturned (\d{3})\b/.exec(message)?.[1]) || undefined;
	if (aborted) return status ? { kind: "aborted", httpStatus: status } : { kind: "aborted" };
	if (status !== undefined) {
		const httpStatus = { httpStatus: status };
		if (status === 401 || status === 403) return { kind: "auth", ...httpStatus };
		if (status === 429 || status === 529) return { kind: "rate-limit", ...httpStatus };
		if (status >= 500) return { kind: "provider", ...httpStatus };
		if (/max_tokens_exceeded/.test(message)) return { kind: "too-large", ...httpStatus };
		if (/Unknown model|model_not_found/i.test(message)) return { kind: "unknown-model", ...httpStatus };
		if (REFUSAL_PATTERN.test(message)) return { kind: "refusal", ...httpStatus };
		if (status === 400 || status === 422) return { kind: "invalid-request", ...httpStatus };
		return { kind: "provider", ...httpStatus };
	}
	if (/timed out after/i.test(message)) return { kind: "timeout" };
	if (/Provider is not configured/i.test(message)) return { kind: "not-configured" };
	if (/Server requested \d+s retry delay/i.test(message)) return { kind: "rate-limit" };
	if (/not configured|No API key/i.test(message)) return { kind: "auth" };
	if (/max_tokens_exceeded/.test(message)) return { kind: "too-large" };
	if (/Unknown model/i.test(message)) return { kind: "unknown-model" };
	if (REFUSAL_PATTERN.test(message)) return { kind: "refusal" };
	return { kind: "provider" };
}

const ENGINE_ERROR_SUMMARIES: Record<EngineErrorKind, string> = {
	aborted: "decision request aborted",
	timeout: "decision request timed out",
	auth: "provider authentication failed",
	"too-large": "request exceeds the model's input limit",
	"unknown-model": "unknown classifier model",
	"invalid-request": "provider rejected the request",
	"rate-limit": "provider rate limit",
	refusal: "the model refused to answer",
	provider: "provider error",
	"not-configured": "provider is not configured",
	"malformed-answer": "malformed answers",
};

/** Engine-authored constants with no provider text, kept verbatim. */
const VERBATIM_ENGINE_MESSAGES: ReadonlySet<string> = new Set([SHORT_CREDENTIAL_MESSAGE]);

/**
 * The bounded summary of an engine error that the kernel returns and
 * persists (call_end.error.message): a constant per kind plus the HTTP
 * status, nothing copied from the message. Engine messages quote provider
 * bodies, which can echo state, instructions and credentials (numeric ones
 * included); the scrubbed response itself stays in the response blob.
 */
export function summarizeEngineError(error: { kind: EngineErrorKind; message: string; httpStatus?: number }): string {
	if (VERBATIM_ENGINE_MESSAGES.has(error.message)) return error.message;
	const summary = ENGINE_ERROR_SUMMARIES[error.kind] ?? "decision engine error";
	const status = Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! <= 599;
	return status ? `${summary} (HTTP ${error.httpStatus})` : summary;
}

export function createPiDecisionEngine(options: PiDecisionEngineOptions): PiDecisionEngine {
	const clones = new Map<string, ClassifierModel<string>>();
	const loadModels = async (): Promise<PiDecisionModels> =>
		typeof options.models === "function" ? options.models() : options.models;

	const resolve = (models: PiDecisionModels, ref: string): ClassifierModel<string> | undefined => {
		const split = splitModelRef(ref);
		if (!split) return undefined;
		const listed = models.getModelOfType("classifier", split.provider, split.modelId);
		if (listed) return listed;
		const cached = clones.get(ref);
		if (cached) return cached;
		// Pinning: classify() does not require a listed id.
		const sibling = models.getModelsOfType("classifier", split.provider)[0];
		if (!sibling) return undefined;
		const clone = { ...sibling, id: split.modelId };
		clones.set(ref, clone);
		return clone;
	};

	return {
		async describe(modelRef) {
			try {
				const model = resolve(await loadModels(), modelRef);
				if (!model) return undefined;
				return { engine: engineIdForApi(model.api), api: model.api, provider: model.provider, modelId: model.id };
			} catch {
				return undefined;
			}
		},

		async classify(request) {
			const startedAtMs = Date.now();
			const t0 = performance.now();
			const split = splitModelRef(request.model);
			const failure = (kind: EngineErrorKind, message: string): EngineResult => ({
				ok: false,
				engine: "pi-ai",
				api: "",
				provider: split?.provider ?? "",
				requestedModel: request.model,
				resolvedModel: request.model,
				answers: {},
				latencyMs: Math.round(performance.now() - t0),
				attempts: 0,
				startedAtMs,
				error: { kind, message },
				secrets: [],
			});

			let models: PiDecisionModels;
			try {
				models = await loadModels();
			} catch (error) {
				// Error names only: a models.json or auth.json parse error can quote file content.
				return failure("not-configured", `Pi models unavailable: ${error instanceof Error ? error.name : typeof error}`);
			}
			let model: ClassifierModel<string> | undefined;
			try {
				model = resolve(models, request.model);
			} catch (error) {
				return failure("unknown-model", `classifier lookup failed: ${error instanceof Error ? error.name : typeof error}`);
			}
			if (!model) return failure("unknown-model", `No classifier model ${request.model}`);

			const capture = createClassifyCapture(options.fetch);
			let wireRequest: unknown;
			let result: ClassifierResult;
			try {
				result = await models.classify(
					model,
					{ state: request.state, questions: request.questions },
					{
						...(request.signal !== undefined && { signal: request.signal }),
						timeoutMs: request.timeoutMs ?? DEFAULT_DECIDE_TIMEOUT_MS,
						maxRetries: request.maxRetries ?? DEFAULT_DECIDE_MAX_RETRIES,
						maxRetryDelayMs:
							request.maxRetryDelayMs ?? options.maxRetryDelayMs ?? DEFAULT_DECIDE_MAX_RETRY_DELAY_MS,
						fetch: capture.fetch,
						onPayload: (payload) => {
							wireRequest = payload;
							return undefined;
						},
					},
				);
			} catch (error) {
				// Models.classify resolves failures; a throwing custom surface is mapped, never propagated.
				result = {
					api: model.api,
					provider: model.provider,
					model: model.id,
					answers: {},
					stopReason: request.signal?.aborted ? "aborted" : "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				};
			}

			const secrets = capture.secrets();
			const wireResponse = capture.lastBody();
			const servedModel = capture.servedModel();
			const errorKind =
				result.stopReason === "stop" ? undefined : classifyError(result.errorMessage ?? "", result.stopReason === "aborted");
			// Providers that do not send through fetch (in-process, fakes) still made one attempt when they
			// answered, refusals included.
			const answered = result.stopReason === "stop" || errorKind?.kind === "refusal";
			const attempts = capture.sent() > 0 ? capture.sent() : answered && !capture.refused() ? 1 : 0;
			const base = {
				engine: engineIdForApi(model.api),
				api: model.api,
				provider: model.provider,
				requestedModel: `${model.provider}/${split?.modelId ?? model.id}`,
				// The served id comes from the response body: scrub it like any other wire value.
				resolvedModel: redactText(`${model.provider}/${servedModel ?? result.model}`, secrets),
				latencyMs: Math.round(performance.now() - t0),
				attempts,
				startedAtMs,
				...(wireRequest !== undefined && { wireRequest: redactDeep(wireRequest, secrets) }),
				...(wireResponse !== undefined && { wireResponse: redactDeep(wireResponse, secrets) }),
				...(result.usage ? { usage: { inputTokens: result.usage.input, outputTokens: result.usage.output } } : {}),
				secrets,
			};

			if (capture.refused()) {
				return { ...base, ok: false, answers: {}, error: { kind: "auth", message: SHORT_CREDENTIAL_MESSAGE } };
			}
			if (errorKind) {
				const message = redactText(result.errorMessage ?? `classify ${result.stopReason}`, secrets);
				return { ...base, ok: false, answers: {}, error: { ...errorKind, message } };
			}
			const rawAnswers = (wireResponse as { answers?: Record<string, unknown> } | undefined)?.answers;
			const answers: Record<string, EngineAnswer> = {};
			for (const [qid, answer] of Object.entries(result.answers)) {
				answers[qid] = normalizeAnswer(answer, rawAnswers && Object.hasOwn(rawAnswers, qid) ? rawAnswers[qid] : undefined);
			}
			return { ...base, ok: true, answers };
		},
	};
}

function normalizeAnswer(answer: ClassifierAnswer, raw: unknown): EngineAnswer {
	if (answer.type === "bool") return { type: "bool", probability: answer.probability };
	if (answer.type === "choice") {
		return { type: "choice", choice: answer.choice, distribution: answer.probabilities, confidence: answer.confidence };
	}
	// Pi drops System One's per-level probabilities; recover them from the wire when present. A present
	// but malformed value (string entries, null, an array) is passed through as-is, never dropped, so
	// answer validation rejects it as malformed-answer.
	const wire = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
	const present = wire !== undefined && Object.hasOwn(wire, "probabilities");
	return {
		type: "score",
		score: answer.score,
		confidence: answer.confidence,
		...(present && { distribution: wire.probabilities as Record<string, number> }),
	};
}

// ── the wrapping fetch ────────────────────────────────────────────────────────

/**
 * The fetch handed to Pi. Per call, before anything is sent, it reads the
 * outbound headers, adds every sensitive value to the secret set, and throws
 * when a credential is 1–7 characters (nothing reaches the base fetch). Then
 * it sends and keeps the response body; the served model is read from 2xx
 * bodies only.
 */
function createClassifyCapture(baseFetch: typeof fetch | undefined) {
	const secrets = new Set<string>();
	let sent = 0;
	let refused = false;
	let lastBody: unknown;
	let servedModel: string | undefined;

	const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const headers = outboundHeaders(input, init);
		for (const secret of collectSecrets(headers)) secrets.add(secret);
		if (findShortCredential(headers) !== undefined) {
			refused = true;
			throw new Error(SHORT_CREDENTIAL_MESSAGE);
		}
		sent++;
		const response = await (baseFetch ?? globalThis.fetch)(input, init);
		try {
			const text = await response.clone().text();
			lastBody = parseJsonOrText(text);
			const model = (lastBody as { model?: unknown } | null)?.model;
			if (response.ok && typeof model === "string" && model.length > 0) servedModel = model;
		} catch {
			// Body unreadable (aborted); Pi reports the failure itself.
		}
		return response;
	};

	return {
		fetch: wrapped as unknown as typeof fetch,
		sent: () => sent,
		refused: () => refused,
		secrets: () => mergeSecrets([...secrets]),
		lastBody: () => lastBody,
		servedModel: () => servedModel,
	};
}

function outboundHeaders(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Headers {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	for (const [name, value] of headerPairs(init?.headers as HeaderSource)) {
		headers.set(name, value);
	}
	return headers;
}

function parseJsonOrText(text: string): unknown {
	if (text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
