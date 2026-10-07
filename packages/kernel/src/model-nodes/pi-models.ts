/**
 * Pi models for model nodes (plan §4.1, §4.7): one lazily built
 * ModelRuntime + ModelRegistry per kernel, call-route resolution with the
 * preflight secret set, and the Pi transport that `kernel.call` sends through
 * when a call engine does not own the HTTP request.
 */
import { join } from "node:path";

import type { Api, AssistantMessage, Context, Message, Model, Usage } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
	collectSecrets,
	findShortCredential,
	mergeSecrets,
	redactDeep,
	redactHeaders,
	redactText,
} from "./redact";
import { defineOwn } from "./blobs";
import type { EngineAttempt, PiTransport, PiTransportRequest, ResolvedRoute } from "./types";

export type PiReasoning = "low" | "medium" | "high";

export const SHORT_CREDENTIAL_MESSAGE = "credential too short to redact safely";
export const PI_TRANSPORT_UNSUPPORTED_MESSAGE = "provider does not support the kernel's Pi transport";
export const PI_TRANSPORT_NOT_ROUTED_MESSAGE = "provider did not send through the kernel's Pi transport";

/**
 * Route failure summaries, one constant per reason (§4.7). Pi's lookup and
 * auth diagnostics can quote credential sources, stores and values, so they
 * never leave `resolveCallRoute`: a route failure carries only one of these.
 */
export const ROUTE_FAILURE_MESSAGES = {
	"invalid-model-ref": 'invalid model ref: expected "provider/id"',
	"unknown-model": "unknown model",
	"missing-credential": "no credential configured for the model's provider",
	"auth-failed": "credential resolution failed",
	"short-credential": SHORT_CREDENTIAL_MESSAGE,
	"models-unavailable": "Pi models unavailable",
} as const;
export type RouteFailureReason = keyof typeof ROUTE_FAILURE_MESSAGES;

/** Every kernel-written route refusal: the only route messages persisted verbatim. */
export const ROUTE_REFUSAL_MESSAGES: ReadonlySet<string> = new Set<string>([
	...Object.values(ROUTE_FAILURE_MESSAGES),
	PI_TRANSPORT_UNSUPPORTED_MESSAGE,
	PI_TRANSPORT_NOT_ROUTED_MESSAGE,
]);

/**
 * Pi apis whose adapters send every HTTP request through the injected
 * `fetch` option (pi-ai 1.0.4): openai-responses and openai-completions hand it
 * to the OpenAI SDK client (`api/openai-responses.js:122,190-221`,
 * `api/openai-completions.js:186,532-563`), anthropic-messages to the
 * Anthropic SDK client (`api/anthropic-messages.js:424,751-821`). Everything
 * else is refused before sending (fail closed): google-generative-ai and
 * google-vertex reject a custom fetch, openai-codex-responses prefers a
 * WebSocket that bypasses fetch, and the rest are unverified.
 */
export const PI_TRANSPORT_APIS: readonly string[] = ["openai-responses", "openai-completions", "anthropic-messages"];

export function isPiTransportApi(api: string): boolean {
	return PI_TRANSPORT_APIS.includes(api);
}

// ── runtime + registry ────────────────────────────────────────────────────────

export interface PiModelsHandle {
	runtime(): Promise<ModelRuntime>;
	registry(): Promise<ModelRegistry>;
}

export interface CreatePiModelsOptions {
	/** Default: Pi's agent dir (`PI_CODING_AGENT_DIR` or `~/.pi/agent`). */
	piAgentDir?: string;
	/** Injected runtime (tests); skips loading auth.json and models.json. */
	runtime?: ModelRuntime | (() => Promise<ModelRuntime>);
}

/**
 * Builds the runtime on first use and caches it; a failed build is not
 * cached, so the next call retries. `ModelRuntime.create` refreshes catalogs
 * from the network only with `allowModelNetwork: true` (default false).
 */
export function createPiModels(opts: CreatePiModelsOptions = {}): PiModelsHandle {
	let pending: Promise<{ runtime: ModelRuntime; registry: ModelRegistry }> | undefined;
	const load = () => {
		if (!pending) {
			const attempt = buildRuntime(opts).then((runtime) => ({ runtime, registry: new ModelRegistry(runtime) }));
			pending = attempt;
			attempt.catch(() => {
				if (pending === attempt) pending = undefined;
			});
		}
		return pending;
	};
	return {
		runtime: async () => (await load()).runtime,
		registry: async () => (await load()).registry,
	};
}

async function buildRuntime(opts: CreatePiModelsOptions): Promise<ModelRuntime> {
	if (typeof opts.runtime === "function") return opts.runtime();
	if (opts.runtime) return opts.runtime;
	const dir = opts.piAgentDir ?? getAgentDir();
	return ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json") });
}

// ── call routes ───────────────────────────────────────────────────────────────

/** Splits "provider/id" at the first "/"; undefined when either side is empty. */
export function splitModelRef(ref: string): { provider: string; modelId: string } | undefined {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return undefined;
	return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

export type CallRouteResult =
	| { ok: true; route: ResolvedRoute; model: Model<Api>; secrets: string[] }
	| { ok: false; failure: { kind: "route"; message: string } };

/**
 * Resolves "provider/id" through Pi (`find` + `getApiKeyAndHeaders`) and
 * builds the preflight secret set (§4.7). A 1–7 character credential is a
 * route failure. Failure messages are `ROUTE_FAILURE_MESSAGES` constants;
 * Pi's own error text is dropped (the call already records the model ref).
 */
export async function resolveCallRoute(
	registry: ModelRegistry,
	ref: string,
	reasoning: PiReasoning,
): Promise<CallRouteResult> {
	const split = splitModelRef(ref);
	if (!split) return routeFailure("invalid-model-ref");
	const model = registry.find(split.provider, split.modelId);
	if (!model) return routeFailure("unknown-model");
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) return routeFailure(/^No API key found\b/.test(auth.error) ? "missing-credential" : "auth-failed");
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(auth.headers ?? {})) {
		if (typeof value === "string") defineOwn(headers, name, value);
	}
	if (findShortCredential(headers, [auth.apiKey]) !== undefined) return routeFailure("short-credential");
	return {
		ok: true,
		model,
		secrets: collectSecrets(headers, [auth.apiKey]),
		route: {
			modelRef: `${model.provider}/${model.id}`,
			provider: model.provider,
			modelId: model.id,
			api: model.api,
			baseUrl: auth.baseUrl ?? model.baseUrl,
			...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
			headers,
			reasoning,
		},
	};
}

function routeFailure(reason: RouteFailureReason): { ok: false; failure: { kind: "route"; message: string } } {
	return { ok: false, failure: { kind: "route", message: ROUTE_FAILURE_MESSAGES[reason] } };
}

// ── Pi transport ──────────────────────────────────────────────────────────────

export interface PiTransportOptions {
	reasoning: PiReasoning;
	/** The preflight secret set from `resolveCallRoute`. */
	secrets?: readonly string[];
	maxRetryDelayMs?: number;
	/** Base fetch; default `globalThis.fetch` read at send time. */
	fetch?: typeof fetch;
}

/**
 * A `PiTransport` bound to one model and reasoning level (§4.1). Apis outside
 * `PI_TRANSPORT_APIS` are refused before sending, and a success that never
 * went through the wrapped fetch is refused too: its outbound credentials
 * were not captured, so its text cannot be trusted to be scrubbed.
 * `complete()` never rejects.
 */
export function createPiTransport(
	registry: ModelRegistry,
	model: Model<Api>,
	opts: PiTransportOptions,
): PiTransport {
	const preflight = [...(opts.secrets ?? [])];
	return {
		async complete(req) {
			const startedAtMs = Date.now();
			if (!isPiTransportApi(model.api)) {
				return finish(preflight, emptyAttempt(model, startedAtMs, 0), null, PI_TRANSPORT_UNSUPPORTED_MESSAGE);
			}
			const capture = createFetchCapture(opts.fetch);
			let message: AssistantMessage | undefined;
			let thrown: unknown;
			try {
				message = await registry
					.streamSimple(model, toContext(req, model), {
						reasoning: opts.reasoning,
						...(req.signal !== undefined && { signal: req.signal }),
						...(req.timeoutMs !== undefined && { timeoutMs: req.timeoutMs }),
						...(opts.maxRetryDelayMs !== undefined && { maxRetryDelayMs: opts.maxRetryDelayMs }),
						fetch: capture.fetch,
					})
					.result();
			} catch (error) {
				thrown = error;
			}
			await capture.settle();
			const secrets = mergeSecrets(preflight, capture.secrets());

			const last = capture.last();
			const attemptStart = last?.startedAtMs ?? startedAtMs;
			const usage = message ? toUsage(message) : null;
			const attempt: EngineAttempt = {
				...emptyAttempt(model, attemptStart, Math.max(0, Date.now() - attemptStart)),
				status: last?.status ?? null,
				usage,
				...(usage && message?.usage.reasoning !== undefined && { reasoningTokens: message.usage.reasoning }),
				request: last?.request ?? null,
				response: last?.response ?? null,
			};

			let text: string | null = null;
			let errorMessage: string | undefined;
			if (capture.refused()) {
				errorMessage = SHORT_CREDENTIAL_MESSAGE;
			} else if (thrown !== undefined || !message) {
				errorMessage = describeError(thrown);
			} else if (message.stopReason === "error" || message.stopReason === "aborted") {
				errorMessage = message.errorMessage ?? `pi request ${message.stopReason}`;
			} else if (capture.calls() === 0) {
				errorMessage = PI_TRANSPORT_NOT_ROUTED_MESSAGE;
			} else {
				text = assistantText(message);
				if (text === null) errorMessage = `pi response has no text (stopReason ${message.stopReason})`;
			}
			return finish(secrets, attempt, text, errorMessage);
		},
	};
}

function finish(
	secrets: string[],
	attempt: EngineAttempt,
	text: string | null,
	errorMessage: string | undefined,
): Awaited<ReturnType<PiTransport["complete"]>> {
	return {
		attempt: redactDeep(attempt, secrets),
		text: text === null ? null : redactText(text, secrets),
		...(errorMessage !== undefined && { errorMessage: redactText(errorMessage, secrets) }),
		secrets,
	};
}

function emptyAttempt(model: Model<Api>, startedAtMs: number, durationMs: number): EngineAttempt {
	return {
		transport: "pi",
		clientName: model.id,
		provider: model.provider,
		startedAtMs,
		durationMs,
		selected: true,
		status: null,
		usage: null,
		request: null,
		response: null,
	};
}

function describeError(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return error === undefined ? "pi request failed without a result" : `Error: ${String(error)}`;
}

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Pi messages for the request. Assistant turns are replayed as completed text-only responses of this model. */
function toContext(req: PiTransportRequest, model: Model<Api>): Context {
	const timestamp = Date.now();
	const messages: Message[] = req.messages.map((m): Message =>
		m.role === "user"
			? { role: "user", content: m.text, timestamp }
			: {
					role: "assistant",
					content: [{ type: "text", text: m.text }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: ZERO_USAGE,
					stopReason: "stop",
					timestamp,
				},
	);
	return { ...(req.systemPrompt !== undefined && { systemPrompt: req.systemPrompt }), messages };
}

function assistantText(message: AssistantMessage): string | null {
	const parts = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
	return parts.length === 0 ? null : parts.join("");
}

/** Null when the provider reported no usage (Pi initializes every counter to 0). */
function toUsage(message: AssistantMessage): EngineAttempt["usage"] {
	const u = message.usage;
	if (!u || u.input + u.output + u.cacheRead + u.cacheWrite + u.totalTokens === 0) return null;
	return {
		inputTokens: u.input,
		outputTokens: u.output,
		cacheReadTokens: u.cacheRead,
		cacheWriteTokens: u.cacheWrite,
		model: message.responseModel ?? message.model,
	};
}

// ── the wrapping fetch ────────────────────────────────────────────────────────

interface CapturedExchange {
	startedAtMs: number;
	status: number | null;
	request: NonNullable<EngineAttempt["request"]>;
	response: EngineAttempt["response"];
}

/** Bounds the wait for a response clone that never finishes (a base fetch that ignores abort). */
const CAPTURE_GRACE_MS = 1_000;

/**
 * The fetch handed to Pi. Per call it reads the ACTUAL outbound headers (Pi
 * resolves auth again at send time), adds every sensitive value to the
 * per-call secret set, and throws before calling the base fetch when a
 * credential is 1–7 characters. Then it records the request and, from a
 * clone, the response.
 */
function createFetchCapture(baseFetch: typeof fetch | undefined) {
	const secrets = new Set<string>();
	const exchanges: CapturedExchange[] = [];
	const reads: Promise<void>[] = [];
	let calls = 0;
	let refused = false;

	const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const headers = outboundHeaders(input, init);
		for (const secret of collectSecrets(headers)) secrets.add(secret);
		if (findShortCredential(headers) !== undefined) {
			refused = true;
			throw new Error(SHORT_CREDENTIAL_MESSAGE);
		}
		calls++;
		const exchange: CapturedExchange = {
			startedAtMs: Date.now(),
			status: null,
			request: {
				method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
				url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
				headers: redactHeaders(headers),
				body: await requestBody(input, init),
			},
			response: null,
		};
		exchanges.push(exchange);
		const response = await (baseFetch ?? globalThis.fetch)(input, init);
		exchange.status = response.status;
		const responseHeaders = redactHeaders(response.headers);
		exchange.response = { status: response.status, headers: responseHeaders, body: null };
		reads.push(
			readResponse(response.clone()).then(
				(read) => {
					exchange.response = "sse" in read ? read : { status: response.status, headers: responseHeaders, body: read.body };
				},
				() => {},
			),
		);
		return response;
	};

	return {
		fetch: wrapped as unknown as typeof fetch,
		calls: () => calls,
		refused: () => refused,
		secrets: () => [...secrets],
		last: (): CapturedExchange | undefined => exchanges.at(-1),
		async settle() {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const grace = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, CAPTURE_GRACE_MS);
			});
			await Promise.race([Promise.all(reads), grace]);
			clearTimeout(timer);
		},
	};
}

function outboundHeaders(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Headers {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
	return headers;
}

async function requestBody(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<unknown> {
	const body = init?.body;
	if (typeof body === "string") return parseJsonOrText(body);
	if (body instanceof Uint8Array || body instanceof ArrayBuffer) return parseJsonOrText(new TextDecoder().decode(body));
	if (body == null && input instanceof Request && input.body) return parseJsonOrText(await input.clone().text());
	return body == null ? null : "<unreadable body>";
}

async function readResponse(response: Response): Promise<{ sse: unknown[] } | { body: unknown }> {
	const text = await response.text();
	if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) return { sse: parseSseFrames(text) };
	return { body: text.length === 0 ? null : parseJsonOrText(text) };
}

/** The `data:` payload of every SSE frame, JSON-parsed when it parses. */
function parseSseFrames(text: string): unknown[] {
	const frames: unknown[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""));
		if (data.length > 0) frames.push(parseJsonOrText(data.join("\n")));
	}
	return frames;
}

function parseJsonOrText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
