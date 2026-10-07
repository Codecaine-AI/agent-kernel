/**
 * A scripted `CallEngine` for tests (plan §7.1): the test's `respond`
 * handler produces each invocation's outcome and attempts; the fake records
 * every invoke request. Attempt builders produce OpenAI Responses-shaped
 * requests and responses like the BAML engine's, and `fakePiModels` gives
 * call routes a keyed, offline Pi provider.
 *
 * Used by the call core tests and, through `@agent-kernel/kernel/model-nodes/testing`,
 * by step/gate, viewer fixture and harness tests.
 */
import {
	InMemoryCredentialStore,
	type Api,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { PiModelsSource } from "../../context";
import { createPiModels } from "../../pi-models";
import type {
	CallEngine,
	CallEngineInvokeRequest,
	CallEngineOutcome,
	CallFailure,
	CallManifest,
	EngineAttempt,
	FnName,
} from "../../types";

/** An outcome as the test writes it; `value` is not checked against the client's types. */
export type FakeCallResponse = { attempts?: EngineAttempt[]; rawText?: string | null } & (
	| { ok: true; value: unknown }
	| { ok: false; failure: CallFailure }
);

export type FakeCallRequest<C> = CallEngineInvokeRequest<C, FnName<C>>;

export interface FakeCallEngineOptions<C> {
	/** The client's function names, as `functionNames()` reports them. */
	functions: readonly FnName<C>[];
	/** Produces invocation `index` (0-based, across every function). */
	respond: (req: FakeCallRequest<C>, index: number) => FakeCallResponse | Promise<FakeCallResponse>;
	/** Default "baml". */
	engine?: "baml" | "pi-ai";
	/** Default "baml-http". */
	transport?: "baml-http" | "pi";
	manifests?: Partial<Record<FnName<C>, CallManifest>>;
	/** Default "baml1-fake-<name>". */
	promptHash?: (name: FnName<C>) => string;
}

export interface FakeCallEngine<C> extends CallEngine<C> {
	/** Every invoke request, in call order. */
	readonly invocations: FakeCallRequest<C>[];
}

export function createFakeCallEngine<C>(opts: FakeCallEngineOptions<C>): FakeCallEngine<C> {
	const invocations: FakeCallRequest<C>[] = [];
	return {
		engine: opts.engine ?? "baml",
		invocations,
		transportFor: () => opts.transport ?? "baml-http",
		functionNames: () => [...opts.functions],
		manifest: (name) => opts.manifests?.[name],
		promptHash: (name) => opts.promptHash?.(name) ?? `baml1-fake-${name}`,
		async invoke<K extends FnName<C>>(req: CallEngineInvokeRequest<C, K>): Promise<CallEngineOutcome<C, K>> {
			const index = invocations.push(req as unknown as FakeCallRequest<C>) - 1;
			const response = await opts.respond(req as unknown as FakeCallRequest<C>, index);
			return { attempts: [], rawText: null, ...response } as CallEngineOutcome<C, K>;
		},
	};
}

/** A successful outcome with one attempt that answers `value` as JSON. */
export function fakeOk(value: unknown, attempts: EngineAttempt[] = [fakeAttempt({ output: JSON.stringify(value) })]): FakeCallResponse {
	return { ok: true, value, attempts, rawText: JSON.stringify(value) };
}

/** A failed outcome; `rawText` defaults to the failure's raw output when it has one. */
export function fakeFailure(failure: CallFailure, attempts: EngineAttempt[] = [], rawText?: string | null): FakeCallResponse {
	return {
		ok: false,
		failure,
		attempts,
		rawText: rawText !== undefined ? rawText : "rawOutput" in failure ? failure.rawOutput : null,
	};
}

export interface FakeAttemptOptions {
	transport?: "baml-http" | "pi";
	/** Default "openai-responses" (BAML's provider name; the Pi provider comes from the route). */
	provider?: string;
	startedAtMs?: number;
	/** Default 25. */
	durationMs?: number | null;
	/** Default true. */
	selected?: boolean;
	/** Default 200. */
	status?: number | null;
	system?: string;
	/** Default "Extract the facts." */
	user?: string;
	/** Model text in the response body. Default "{}". */
	output?: string;
	/** Served model id (bare). Default "fake-model". */
	model?: string;
	/** null: the attempt reports no usage. */
	usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | null;
	reasoningTokens?: number;
	/** Request headers as the engine reports them (already redacted by a real engine). */
	headers?: Record<string, string>;
	/** Replaces the response: SSE frames, or null for no response. */
	response?: EngineAttempt["response"];
	/** Replaces the request body. */
	requestBody?: unknown;
}

/** One OpenAI Responses-shaped HTTP attempt. */
export function fakeAttempt(opts: FakeAttemptOptions = {}): EngineAttempt {
	const model = opts.model ?? "fake-model";
	const usage = opts.usage === undefined ? { inputTokens: 120, outputTokens: 30 } : opts.usage;
	const status = opts.status === undefined ? 200 : opts.status;
	const input = [
		...(opts.system !== undefined ? [{ role: "system", content: [{ type: "input_text", text: opts.system }] }] : []),
		{ role: "user", content: [{ type: "input_text", text: opts.user ?? "Extract the facts." }] },
	];
	const body =
		status !== null && status >= 400
			? { error: { message: "fake provider error", type: "invalid_request_error" } }
			: {
					id: "resp_fake",
					object: "response",
					status: "completed",
					model,
					output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: opts.output ?? "{}" }] }],
					...(usage && {
						usage: {
							input_tokens: usage.inputTokens,
							output_tokens: usage.outputTokens,
							output_tokens_details: { reasoning_tokens: opts.reasoningTokens ?? 0 },
						},
					}),
				};
	return {
		transport: opts.transport ?? "baml-http",
		clientName: "KernelCall",
		provider: opts.provider ?? "openai-responses",
		startedAtMs: opts.startedAtMs ?? Date.now(),
		durationMs: opts.durationMs === undefined ? 25 : opts.durationMs,
		selected: opts.selected ?? true,
		status,
		usage: usage && {
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens ?? 0,
			cacheWriteTokens: usage.cacheWriteTokens ?? 0,
			model,
		},
		...(opts.reasoningTokens !== undefined && { reasoningTokens: opts.reasoningTokens }),
		request: {
			method: "POST",
			url: "http://fake.invalid/v1/responses",
			headers: opts.headers ?? { authorization: "<redacted>", "content-type": "application/json" },
			body: opts.requestBody ?? { model, input },
		},
		response:
			opts.response !== undefined
				? opts.response
				: status === null
					? null
					: { status, headers: { "content-type": "application/json" }, body },
	};
}

/** Resolves once `signal` aborts (an engine that runs until cancelled). */
export function untilAborted(signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (!signal) return;
		if (signal.aborted) return resolve();
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

// ── an offline Pi provider for call routes ────────────────────────────────────

export const FAKE_CALL_PROVIDER = "fake";
export const FAKE_CALL_MODEL = "fake-model";
export const FAKE_CALL_MODEL_REF = `${FAKE_CALL_PROVIDER}/${FAKE_CALL_MODEL}`;
export const FAKE_CALL_BASE_URL = "http://fake.invalid/v1";

export interface FakePiModelsOptions {
	/** Runtime api key of the fake provider (≥ 8 characters unless a test wants a refusal). Default "sk-fake-call-key-0123456789". */
	apiKey?: string;
	/** Extra provider headers, e.g. a custom auth header. */
	headers?: Record<string, string>;
	/** Default "openai-responses". */
	api?: Api;
	/** Default FAKE_CALL_BASE_URL (unroutable); a local mock server's URL for real-engine tests. */
	baseUrl?: string;
}

export interface FakePiModels extends PiModelsSource {
	readonly apiKey: string;
	/** Changes the provider's runtime key (rotation after preflight). */
	rotateApiKey(apiKey: string): Promise<void>;
}

/**
 * A Pi models source with one keyed provider, `fake/fake-model`, built from
 * an in-memory runtime (no auth.json, no models.json, no network).
 */
export function fakePiModels(opts: FakePiModelsOptions = {}): FakePiModels {
	const apiKey = opts.apiKey ?? "sk-fake-call-key-0123456789";
	let runtime: ModelRuntime | undefined;
	const build = async () => {
		if (runtime) return runtime;
		const created = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			refreshOnCreate: false,
		});
		created.registerProvider(FAKE_CALL_PROVIDER, {
			name: "Fake",
			baseUrl: opts.baseUrl ?? FAKE_CALL_BASE_URL,
			api: opts.api ?? "openai-responses",
			...(opts.headers !== undefined && { headers: opts.headers }),
			models: [
				{
					id: FAKE_CALL_MODEL,
					name: "Fake model",
					reasoning: true,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128_000,
					maxTokens: 4_096,
				},
			],
		});
		await created.setRuntimeApiKey(FAKE_CALL_PROVIDER, apiKey);
		runtime = created;
		return created;
	};
	const models = createPiModels({ runtime: build });
	return {
		apiKey,
		runtime: models.runtime,
		registry: models.registry,
		async rotateApiKey(next) {
			await (await build()).setRuntimeApiKey(FAKE_CALL_PROVIDER, next);
		},
	};
}
