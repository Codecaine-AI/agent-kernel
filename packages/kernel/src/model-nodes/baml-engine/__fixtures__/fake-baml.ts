/**
 * Offline stand-in for `@boundaryml/baml` 0.226.2 and a generated client
 * (plan §7.1). The classes mirror the installed declarations: getters shaped
 * like `native.d.ts` (header maps typed `object`, bodies with `text()` and
 * `json()`), the error hierarchy and field names of `errors.d.ts`
 * (`BamlTimeoutError` extends `BamlClientHttpError`; offline parse failures
 * are a plain `BamlError`). `FakeBamlClient` behaves like the generated
 * `async_client.ts`: it reads `opts.collector`, throws `BamlAbortError` for a
 * pre-aborted signal, routes through the stream path when `onTick` is set,
 * and records each LLM call of a scripted run into every collector. Like the
 * real collector, recorded request headers carry the raw bearer token.
 *
 * Fidelity is backed by M1-E's compile check of the real module and client
 * against the same structural types (`baml-runtime-types.ts`).
 */
import type { BamlRuntimeLike } from "../baml-runtime-types";

// ── errors (errors.d.ts) ──────────────────────────────────────────────────────

export class BamlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BamlError";
	}
}

export class BamlClientError extends BamlError {
	constructor(message: string) {
		super(message);
		this.name = "BamlClientError";
	}
}

export class BamlValidationError extends BamlError {
	prompt: string;
	raw_output: string;
	detailed_message: string;
	constructor(prompt: string, raw_output: string, message: string, detailed_message = message) {
		super(message);
		this.name = "BamlValidationError";
		this.prompt = prompt;
		this.raw_output = raw_output;
		this.detailed_message = detailed_message;
	}
}

export class BamlClientFinishReasonError extends BamlError {
	prompt: string;
	raw_output: string;
	finish_reason?: string;
	detailed_message: string;
	constructor(prompt: string, raw_output: string, message: string, finish_reason?: string, detailed_message = message) {
		super(message);
		this.name = "BamlClientFinishReasonError";
		this.prompt = prompt;
		this.raw_output = raw_output;
		if (finish_reason !== undefined) this.finish_reason = finish_reason;
		this.detailed_message = detailed_message;
	}
}

export class BamlClientHttpError extends BamlClientError {
	client_name: string;
	status_code: number;
	detailed_message: string;
	raw_response?: string;
	constructor(client_name: string, message: string, status_code: number, detailed_message = message, raw_response?: string) {
		super(message);
		this.name = "BamlClientHttpError";
		this.client_name = client_name;
		this.status_code = status_code;
		this.detailed_message = detailed_message;
		if (raw_response !== undefined) this.raw_response = raw_response;
	}
}

export class BamlAbortError extends BamlError {
	readonly reason?: unknown;
	detailed_message: string;
	constructor(message: string, reason?: unknown, detailed_message = message) {
		super(message);
		this.name = "BamlAbortError";
		this.reason = reason;
		this.detailed_message = detailed_message;
	}
}

/** A subclass of BamlClientHttpError (errors.d.ts:59); a status that would mislead a mis-ordered classifier. */
export class BamlTimeoutError extends BamlClientHttpError {
	constructor(client_name: string, message: string) {
		super(client_name, message, 408);
		this.name = "BamlTimeoutError";
	}
}

// ── collector and HTTP log objects (native.d.ts) ──────────────────────────────

class FakeHttpBody {
	readonly #text: string;
	constructor(text: string) {
		this.#text = text;
	}
	text(): string {
		return this.#text;
	}
	json(): any {
		return JSON.parse(this.#text);
	}
}

function bodyOf(value: unknown): FakeHttpBody {
	return new FakeHttpBody(typeof value === "string" ? value : JSON.stringify(value ?? null));
}

class FakeHttpRequest {
	readonly #method: string;
	readonly #url: string;
	readonly #headers: object;
	readonly #body: FakeHttpBody;
	constructor(method: string, url: string, headers: object, body: unknown) {
		this.#method = method;
		this.#url = url;
		this.#headers = headers;
		this.#body = bodyOf(body);
	}
	get method(): string {
		return this.#method;
	}
	get url(): string {
		return this.#url;
	}
	get headers(): object {
		return this.#headers;
	}
	get body(): FakeHttpBody {
		return this.#body;
	}
}

class FakeHttpResponse {
	readonly #status: number;
	readonly #headers: object;
	readonly #body: FakeHttpBody;
	constructor(status: number, headers: object, body: unknown) {
		this.#status = status;
		this.#headers = headers;
		this.#body = bodyOf(body);
	}
	get status(): number {
		return this.#status;
	}
	get headers(): object {
		return this.#headers;
	}
	get body(): FakeHttpBody {
		return this.#body;
	}
}

class FakeSse {
	readonly #text: string;
	constructor(frame: unknown) {
		this.#text = typeof frame === "string" ? frame : JSON.stringify(frame);
	}
	get text(): string {
		return this.#text;
	}
	json(): any | null {
		try {
			return JSON.parse(this.#text);
		} catch {
			return null;
		}
	}
}

export interface FakeUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
}

class FakeLlmCall {
	readonly #spec: ResolvedCallSpec;
	constructor(spec: ResolvedCallSpec) {
		this.#spec = spec;
	}
	get clientName(): string {
		return this.#spec.clientName;
	}
	get provider(): string {
		return this.#spec.provider;
	}
	get selected(): boolean {
		return this.#spec.selected;
	}
	get timing(): { startTimeUtcMs: number; durationMs: number | null } {
		return { startTimeUtcMs: this.#spec.startTimeUtcMs, durationMs: this.#spec.durationMs };
	}
	get usage(): FakeUsage | null {
		return this.#spec.usage;
	}
	get httpRequest(): FakeHttpRequest | null {
		const r = this.#spec.request;
		return r ? new FakeHttpRequest(r.method, r.url, r.headers, r.body) : null;
	}
	get httpResponse(): FakeHttpResponse | null {
		const r = this.#spec.response;
		return r ? new FakeHttpResponse(r.status, r.headers, r.body) : null;
	}
}

/** LlmStreamCall: no httpResponse; the frames come from `sseResponses()`. */
class FakeLlmStreamCall extends FakeLlmCall {
	readonly #frames: unknown[];
	constructor(spec: ResolvedCallSpec, frames: unknown[]) {
		super(spec);
		this.#frames = frames;
	}
	sseResponses(): FakeSse[] | null {
		return this.#frames.map((frame) => new FakeSse(frame));
	}
}

class FakeFunctionLog {
	readonly #calls: FakeLlmCall[];
	readonly #raw: string | null;
	constructor(calls: FakeLlmCall[], raw: string | null) {
		this.#calls = calls;
		this.#raw = raw;
	}
	get calls(): FakeLlmCall[] {
		return [...this.#calls];
	}
	get rawLlmResponse(): string | null {
		return this.#raw;
	}
}

export class FakeCollector {
	readonly name: string | null;
	readonly #logs: FakeFunctionLog[] = [];
	constructor(name?: string | null) {
		this.name = name ?? null;
	}
	get last(): FakeFunctionLog | null {
		return this.#logs.at(-1) ?? null;
	}
	/** Called by FakeBamlClient; not part of the real surface. */
	record(log: FakeFunctionLog): void {
		this.#logs.push(log);
	}
}

export interface FakeRegisteredClient {
	provider: string;
	options: Record<string, any>;
	retryPolicy: string | null | undefined;
}

export class FakeClientRegistry {
	readonly clients = new Map<string, FakeRegisteredClient>();
	primary: string | undefined;
	addLlmClient(name: string, provider: string, options: { [key: string]: any }, retryPolicy?: string | null): void {
		this.clients.set(name, { provider, options, retryPolicy });
	}
	setPrimary(primary: string): void {
		this.primary = primary;
	}
	/** The primary client's registration (test helper). */
	primaryClient(): (FakeRegisteredClient & { name: string }) | undefined {
		const client = this.primary === undefined ? undefined : this.clients.get(this.primary);
		return client && { name: this.primary!, ...client };
	}
}

// ── the module object ─────────────────────────────────────────────────────────

/** Every `setLogLevel` call on the fake module (the adapter must never make one). */
export const setLogLevelCalls: string[] = [];

export const fakeBaml = {
	Collector: FakeCollector,
	ClientRegistry: FakeClientRegistry,
	BamlError,
	BamlClientError,
	BamlValidationError,
	BamlClientFinishReasonError,
	BamlClientHttpError,
	BamlTimeoutError,
	BamlAbortError,
	setLogLevel(level: string): void {
		setLogLevelCalls.push(level);
	},
};
// Compile-time check: the fake module satisfies the adapter's structural type.
const fakeBamlIsRuntimeLike: BamlRuntimeLike = fakeBaml;
void fakeBamlIsRuntimeLike;

// ── scripted runs ─────────────────────────────────────────────────────────────

/** One LLM call recorded into the collector. `request: undefined` derives it from the primary client, like BAML. */
export interface FakeCallSpec {
	startTimeUtcMs: number;
	durationMs?: number | null;
	clientName?: string;
	provider?: string;
	selected?: boolean;
	usage?: FakeUsage | null;
	request?: { method?: string; url?: string; headers?: object; body?: unknown } | null;
	response?: { status: number; headers?: object; body?: unknown } | null;
	/** SSE frames (JSON values or raw text): makes this a stream call without an httpResponse. */
	sse?: unknown[];
}

interface ResolvedCallSpec {
	clientName: string;
	provider: string;
	selected: boolean;
	startTimeUtcMs: number;
	durationMs: number | null;
	usage: FakeUsage | null;
	request: { method: string; url: string; headers: object; body: unknown } | null;
	response: { status: number; headers: object; body: unknown } | null;
}

/** One scripted function run: the calls the collector sees, then the outcome. */
export interface FakeScript {
	calls?: FakeCallSpec[];
	rawLlmResponse?: string | null;
	outcome: { value: unknown } | { error: Error };
}

export interface FakeCallOptions {
	clientRegistry?: FakeClientRegistry;
	client?: string;
	collector?: FakeCollector | FakeCollector[];
	env?: Record<string, string | undefined>;
	tags?: Record<string, string>;
	signal?: AbortSignal;
	onTick?: (reason: "Unknown", log: unknown) => void;
}

export interface FakeInvocation {
	fn: string;
	args: unknown[];
	options: FakeCallOptions | undefined;
	/** True when `onTick` routed the call through the stream path. */
	viaStream: boolean;
}

export interface FakeParseCall {
	fn: string;
	text: string;
	options: Pick<FakeCallOptions, "clientRegistry" | "env"> | undefined;
}

export interface ExtractedNote {
	disposition: "KEEP" | "FIX";
	items: string[];
}

/** The static client of the fake `clients.baml`; the adapter must never fall back to it. */
export const FAKE_STATIC_CLIENT = { name: "FakeStatic", base_url: "http://static.invalid/v1", api_key: "static-unused", model: "static" };

const PROMPTS: Record<string, { system: string; user: (args: unknown[]) => string }> = {
	ExtractNote: { system: "Extract the advisories from the note.", user: (args) => String(args[0]) },
	ScoreText: { system: "Score the text.", user: (args) => `${String(args[0])} (scale ${String(args[1])})` },
};

function primaryOf(options: FakeCallOptions | undefined): { name: string; provider: string; options: Record<string, any> } {
	const registered = options?.clientRegistry?.primaryClient();
	if (registered) return registered;
	return { name: FAKE_STATIC_CLIENT.name, provider: "openai-responses", options: FAKE_STATIC_CLIENT };
}

/** The Responses request BAML would send for `fn(args)` through the primary client. */
function renderRequest(fn: string, args: unknown[], options: FakeCallOptions | undefined) {
	const prompt = PROMPTS[fn]!;
	const primary = primaryOf(options);
	const baseUrl = String(primary.options.base_url);
	const { base_url: _baseUrl, api_key: _apiKey, headers: _headers, http: _http, ...bodyOptions } = primary.options;
	return {
		method: "POST",
		url: `${baseUrl}/responses`,
		headers: {
			"content-type": "application/json",
			"baml-original-url": baseUrl,
			authorization: `Bearer ${String(primary.options.api_key ?? "")}`,
			...(primary.options.headers ?? {}),
		},
		body: {
			...bodyOptions,
			input: [
				{ role: "system", content: [{ type: "input_text", text: prompt.system }] },
				{ role: "user", content: [{ type: "input_text", text: prompt.user(args) }] },
			],
		},
	};
}

/**
 * A fake generated client with two functions. Queue runs with `script()`;
 * an unscripted call succeeds with a default value and no recorded calls.
 */
export class FakeBamlClient {
	readonly invocations: FakeInvocation[] = [];
	readonly renders: FakeInvocation[] = [];
	readonly parses: FakeParseCall[] = [];
	readonly #scripts: FakeScript[] = [];
	readonly #request: FakeHttpRequestBuilder;
	readonly #parse: FakeResponseParser;

	constructor() {
		this.#request = new FakeHttpRequestBuilder(this);
		this.#parse = new FakeResponseParser(this);
	}

	script(...scripts: FakeScript[]): this {
		this.#scripts.push(...scripts);
		return this;
	}

	get request(): FakeHttpRequestBuilder {
		return this.#request;
	}

	get parse(): FakeResponseParser {
		return this.#parse;
	}

	/** Lowercase, so never a generated function name. */
	withOptions(_options: FakeCallOptions): FakeBamlClient {
		return this;
	}

	async ExtractNote(note: string, __baml_options__?: FakeCallOptions): Promise<ExtractedNote> {
		return (await this.#run("ExtractNote", [note], __baml_options__)) as ExtractedNote;
	}

	async ScoreText(text: string, scale: number, __baml_options__?: FakeCallOptions): Promise<number> {
		return (await this.#run("ScoreText", [text, scale], __baml_options__)) as number;
	}

	async #run(fn: string, args: unknown[], options: FakeCallOptions | undefined): Promise<unknown> {
		const viaStream = options?.onTick !== undefined;
		this.invocations.push({ fn, args, options, viaStream });
		if (options?.signal?.aborted) throw new BamlAbortError("Operation was aborted", options.signal.reason);
		const script = this.#scripts.shift() ?? { outcome: { value: defaultValue(fn) } };
		const primary = primaryOf(options);
		const calls = (script.calls ?? []).map((spec) => {
			const resolved: ResolvedCallSpec = {
				clientName: spec.clientName ?? primary.name,
				provider: spec.provider ?? primary.provider,
				selected: spec.selected ?? true,
				startTimeUtcMs: spec.startTimeUtcMs,
				durationMs: spec.durationMs === undefined ? 10 : spec.durationMs,
				usage: spec.usage === undefined ? null : spec.usage,
				request:
					spec.request === null
						? null
						: (() => {
								const base = renderRequest(fn, args, options);
								return {
									method: spec.request?.method ?? base.method,
									url: spec.request?.url ?? base.url,
									headers: spec.request?.headers ?? base.headers,
									body: spec.request && "body" in spec.request ? spec.request.body : base.body,
								};
							})(),
				response: spec.response ? { status: spec.response.status, headers: spec.response.headers ?? {}, body: spec.response.body } : null,
			};
			return spec.sse || viaStream ? new FakeLlmStreamCall({ ...resolved, response: null }, spec.sse ?? []) : new FakeLlmCall(resolved);
		});
		const log = new FakeFunctionLog(calls, script.rawLlmResponse ?? null);
		const collectors = options?.collector ? (Array.isArray(options.collector) ? options.collector : [options.collector]) : [];
		for (const collector of collectors) collector.record(log);
		if ("error" in script.outcome) throw script.outcome.error;
		return script.outcome.value;
	}
}

function defaultValue(fn: string): unknown {
	return fn === "ScoreText" ? 0 : { disposition: "KEEP", items: [] };
}

/** `b.request`: renders the HTTP request without sending it (async_request.ts). */
export class FakeHttpRequestBuilder {
	readonly #client: FakeBamlClient;
	constructor(client: FakeBamlClient) {
		this.#client = client;
	}
	async ExtractNote(note: string, __baml_options__?: FakeCallOptions): Promise<FakeHttpRequest> {
		return this.#render("ExtractNote", [note], __baml_options__);
	}
	async ScoreText(text: string, scale: number, __baml_options__?: FakeCallOptions): Promise<FakeHttpRequest> {
		return this.#render("ScoreText", [text, scale], __baml_options__);
	}
	#render(fn: string, args: unknown[], options: FakeCallOptions | undefined): FakeHttpRequest {
		this.#client.renders.push({ fn, args, options, viaStream: false });
		const r = renderRequest(fn, args, options);
		return new FakeHttpRequest(r.method, r.url, r.headers, r.body);
	}
}

/** `b.parse`: synchronous; a failure is a plain BamlError with "Failed to coerce" (R2 §7). */
export class FakeResponseParser {
	readonly #client: FakeBamlClient;
	constructor(client: FakeBamlClient) {
		this.#client = client;
	}
	ExtractNote(llmResponse: string, __baml_options__?: Pick<FakeCallOptions, "clientRegistry" | "env">): ExtractedNote {
		this.#client.parses.push({ fn: "ExtractNote", text: llmResponse, options: __baml_options__ });
		const value = coerceJson(llmResponse) as Partial<ExtractedNote> | undefined;
		if (!value || (value.disposition !== "KEEP" && value.disposition !== "FIX") || !Array.isArray(value.items)) {
			throw new BamlError(`Failed to coerce value: ParsingError { scope: [], reason: "Missing required field: disposition" }`);
		}
		return { disposition: value.disposition, items: value.items.map(String) };
	}
	ScoreText(llmResponse: string, __baml_options__?: Pick<FakeCallOptions, "clientRegistry" | "env">): number {
		this.#client.parses.push({ fn: "ScoreText", text: llmResponse, options: __baml_options__ });
		const value = Number(llmResponse.trim());
		if (!Number.isFinite(value)) throw new BamlError(`Failed to coerce value: expected an int`);
		return value;
	}
}

function coerceJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

// ── script presets ────────────────────────────────────────────────────────────

/** An OpenAI Responses body whose one message says `text`. */
export function responsesBody(
	text: string,
	opts: { model?: string; usage?: Record<string, unknown> } = {},
): Record<string, unknown> {
	return {
		id: "resp_1",
		object: "response",
		status: "completed",
		model: opts.model ?? "served-model-2026",
		output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
		usage: opts.usage ?? { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
	};
}

const USAGE: FakeUsage = { inputTokens: 12, outputTokens: 5, cachedInputTokens: 2 };

export function successScript(value: unknown, raw = JSON.stringify(value)): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, usage: USAGE, response: { status: 200, headers: { "content-type": "application/json" }, body: responsesBody(raw) } }],
		rawLlmResponse: raw,
		outcome: { value },
	};
}

export function parseErrorScript(rawOutput: string): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, usage: USAGE, response: { status: 200, body: responsesBody(rawOutput) } }],
		rawLlmResponse: rawOutput,
		outcome: { error: new BamlValidationError("<prompt>", rawOutput, "Failed to parse LLM response: Failed to coerce value") },
	};
}

export function httpErrorScript(status = 400, rawResponse = `{"error":{"message":"bad request"}}`): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, response: { status, body: rawResponse } }],
		outcome: { error: new BamlClientHttpError("KernelCall", `Request failed with status code: ${status}`, status, "", rawResponse) },
	};
}

export function timeoutScript(): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, durationMs: null, response: null }],
		outcome: { error: new BamlTimeoutError("KernelCall", "Request timed out after 120000ms") },
	};
}

export function abortScript(): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, durationMs: null, response: null }],
		outcome: { error: new BamlAbortError("Operation was aborted", "kernel deadline") },
	};
}

export function finishReasonScript(rawOutput: string, finishReason = "length"): FakeScript {
	return {
		calls: [{ startTimeUtcMs: 1_000, usage: USAGE, response: { status: 200, body: responsesBody(rawOutput) } }],
		rawLlmResponse: rawOutput,
		outcome: { error: new BamlClientFinishReasonError("<prompt>", rawOutput, "Finish reason not allowed", finishReason) },
	};
}

/** A stream call (codex-lb `/backend-api/`): Responses SSE frames ending in `response.completed`. */
export function sseScript(value: unknown, opts: { usage?: Record<string, unknown>; model?: string } = {}): FakeScript {
	const raw = JSON.stringify(value);
	const final = responsesBody(raw, opts);
	return {
		calls: [
			{
				startTimeUtcMs: 1_000,
				usage: USAGE,
				sse: [
					{ type: "response.created", response: { ...final, status: "in_progress", output: [] } },
					{ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: raw },
					{ type: "response.completed", response: final },
				],
			},
		],
		rawLlmResponse: raw,
		outcome: { value },
	};
}
