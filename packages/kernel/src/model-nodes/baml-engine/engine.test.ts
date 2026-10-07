import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createPiTransport, resolveCallRoute, SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { collectSecrets } from "../redact";
import {
	KernelNodeError,
	type CallEngineInvokeRequest,
	type CallManifest,
	type CallResult,
	type EngineAttempt,
	type FnName,
	type PiTransport,
	type PiTransportRequest,
	type ResolvedRoute,
} from "../types";
import {
	abortScript,
	BamlError,
	FakeBamlClient,
	fakeBaml,
	type FakeClientRegistry,
	finishReasonScript,
	httpErrorScript,
	parseErrorScript,
	responsesBody,
	setLogLevelCalls,
	sseScript,
	successScript,
	timeoutScript,
} from "./__fixtures__/fake-baml";
import { bamlEngine, type BamlEngineConfig } from "./index";
import { BAML_LOG_NORMALIZED_NOTICE } from "./log-level";

const realFetch = globalThis.fetch;
const ambientBamlLog = process.env.BAML_LOG;
beforeAll(() => {
	globalThis.fetch = (async () => {
		throw new Error("network disabled in tests");
	}) as unknown as typeof fetch;
	// Engines normalize the ambient level at construction; start from a kept value so only the
	// normalization test sees (and spies on) the notice.
	process.env.BAML_LOG = "error";
});
afterAll(() => {
	globalThis.fetch = realFetch;
	if (ambientBamlLog === undefined) delete process.env.BAML_LOG;
	else process.env.BAML_LOG = ambientBamlLog;
});

const KEY = "sk-route-key-0123456789";
const HEADER_TOKEN = "hdr-token-abcdefgh";
const ROTATED_KEY = "sk-rotated-key-9876543210";
const NOTE = { disposition: "KEEP", items: ["type_erasing_cast"] } as const;

const SOURCES: Record<string, string> = {
	"clients.baml": `client<llm> FakeStatic { provider "openai-responses" }`,
	"generators.baml": `generator target { version "0.226.2" }`,
	"functions/extract-note.baml": `function ExtractNote(note: string) -> Note { client FakeStatic prompt #"{{ note }}"# }`,
	"functions/score-text.baml": `function ScoreText(text: string, scale: int) -> int { client FakeStatic prompt #"{{ text }}"# }`,
};

function route(over: Partial<ResolvedRoute> = {}): ResolvedRoute {
	return {
		modelRef: "fake/fake-model",
		provider: "fake",
		modelId: "fake-model",
		api: "openai-responses",
		baseUrl: "http://fake.invalid/v1",
		apiKey: KEY,
		headers: { "x-fake-token": HEADER_TOKEN, "x-trace": "visible" },
		reasoning: "low",
		...over,
	};
}

const SECRETS = collectSecrets(route().headers, [KEY]);

const unusedTransport: PiTransport = {
	async complete() {
		throw new Error("the Pi transport must not be used on the BAML-native path");
	},
};

function engineWith(client = new FakeBamlClient(), extra: Partial<BamlEngineConfig<FakeBamlClient>> = {}) {
	return bamlEngine({ client, baml: fakeBaml, sources: SOURCES, manifests: {}, ...extra });
}

function request(
	over: Partial<CallEngineInvokeRequest<FakeBamlClient, "ExtractNote">> = {},
): CallEngineInvokeRequest<FakeBamlClient, "ExtractNote"> {
	return {
		name: "ExtractNote",
		args: ["Checkpoint 4: kept type_erasing_cast for matching."],
		route: route(),
		transport: unusedTransport,
		timeoutMs: 120_000,
		tags: { runId: "run_1", containerId: "ctr_1", functionName: "ExtractNote" },
		secrets: SECRETS,
		...over,
	};
}

/** The registry the generated function (or render) received. */
function registryOf(options: { clientRegistry?: FakeClientRegistry } | undefined): FakeClientRegistry {
	const registry = options?.clientRegistry;
	if (!registry) throw new Error("no clientRegistry passed");
	return registry;
}

function piAttempt(over: Partial<EngineAttempt> = {}): EngineAttempt {
	return {
		transport: "pi",
		clientName: "fake-model",
		provider: "fake",
		startedAtMs: 5_000,
		durationMs: 30,
		selected: true,
		status: 200,
		usage: { inputTokens: 9, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, model: "fake-model" },
		request: null,
		response: null,
		...over,
	};
}

/** A scripted PiTransport that records what it was asked to send. */
function scriptedTransport(result: Awaited<ReturnType<PiTransport["complete"]>>) {
	const sent: PiTransportRequest[] = [];
	const transport: PiTransport = {
		async complete(req) {
			sent.push(req);
			return result;
		},
	};
	return { transport, sent };
}

describe("bamlEngine construction", () => {
	test("lists the generated functions and resolves each function's transport", () => {
		const engine = engineWith();
		expect(engine.engine).toBe("baml");
		expect(engine.functionNames()).toEqual(["ExtractNote", "ScoreText"]);
		expect(engine.transportFor("ExtractNote")).toBe("baml-http");

		const mixed = engineWith(new FakeBamlClient(), { transport: "pi", transportByFunction: { ScoreText: "baml-http" } });
		expect(mixed.transportFor("ExtractNote")).toBe("pi");
		expect(mixed.transportFor("ScoreText")).toBe("baml-http");

		// Typing against the generated client shape: names, positional args without the options bag, result.
		const name: FnName<FakeBamlClient> = "ScoreText";
		const args: Parameters<typeof mixed.invoke<"ScoreText">>[0]["args"] = ["text", 5];
		const result: CallResult<FakeBamlClient, "ExtractNote"> = { disposition: "FIX", items: [] };
		expect([name, args, result]).toHaveLength(3);
	});

	test("rejects a manifest whose name is not a generated function", () => {
		const manifest: CallManifest = { $schema: "agent-kernel/call-v1", name: "Missing", description: "not generated" };
		const build = (manifests: Record<string, CallManifest>) => () =>
			engineWith(new FakeBamlClient(), { manifests: manifests as BamlEngineConfig<FakeBamlClient>["manifests"] });

		for (const key of ["Missing", "withOptions", "request"]) {
			expect(build({ [key]: manifest })).toThrow(KernelNodeError);
			try {
				build({ [key]: manifest })();
			} catch (error) {
				expect((error as KernelNodeError).code).toBe("unknown-function");
			}
		}
		expect(() =>
			engineWith(new FakeBamlClient(), {
				transportByFunction: { Missing: "pi" } as BamlEngineConfig<FakeBamlClient>["transportByFunction"],
			}),
		).toThrow(/not a generated BAML function/);

		const ok = engineWith(new FakeBamlClient(), {
			manifests: { ExtractNote: { ...manifest, name: "ExtractNote", model: "codex-lb/gpt-5.6-sol" } },
		});
		expect(ok.manifest("ExtractNote")?.model).toBe("codex-lb/gpt-5.6-sol");
		expect(ok.manifest("ScoreText")).toBeUndefined();
	});

	test("promptHash ignores clients.baml and generators.baml and is order-independent", () => {
		const hash = engineWith().promptHash("ExtractNote");
		expect(hash).toMatch(/^baml1-[0-9a-f]{64}$/);

		const reversed = Object.fromEntries(Object.entries(SOURCES).reverse());
		expect(engineWith(new FakeBamlClient(), { sources: reversed }).promptHash("ExtractNote")).toBe(hash);

		const otherClients = {
			...SOURCES,
			"clients.baml": `client<llm> FakeStatic { provider "anthropic" options { model "other" } }`,
			"generators.baml": `generator target { version "0.300.0" }`,
		};
		expect(engineWith(new FakeBamlClient(), { sources: otherClients }).promptHash("ExtractNote")).toBe(hash);

		const otherPrompt = { ...SOURCES, "functions/extract-note.baml": `${SOURCES["functions/extract-note.baml"]} // v2` };
		expect(engineWith(new FakeBamlClient(), { sources: otherPrompt }).promptHash("ExtractNote")).not.toBe(hash);
	});
});

describe("bamlEngine invoke: BAML-native", () => {
	test("maps Pi apis to BAML providers; unknown api → route failure", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client, { retryPolicy: "KernelCallRetry" });
		const cases = [
			["openai-responses", "openai-responses"],
			["openai-completions", "openai-generic"],
			["anthropic-messages", "anthropic"],
		] as const;
		for (const [api, provider] of cases) {
			client.script(successScript(NOTE));
			const out = await engine.invoke(request({ route: route({ api, reasoning: "medium" }) }));
			expect(out.ok).toBe(true);
			const call = client.invocations.at(-1)!;
			const registry = registryOf(call.options);
			expect(registry.clients.size).toBe(1);
			expect(registry.primaryClient()).toMatchObject({
				name: "KernelCall",
				provider,
				retryPolicy: "KernelCallRetry",
				options: {
					base_url: "http://fake.invalid/v1",
					api_key: KEY,
					model: "fake-model",
					headers: { "x-fake-token": HEADER_TOKEN, "x-trace": "visible" },
					http: { request_timeout_ms: 120_000 },
				},
			});
			const options = registry.primaryClient()!.options;
			if (provider === "openai-responses") {
				expect(options).toMatchObject({ store: false, reasoning: { effort: "medium" } });
			} else {
				expect(options.store).toBeUndefined();
				expect(options.reasoning).toBeUndefined();
			}
			// A fresh collector per invoke, named by the run id, plus the kernel's tags.
			const collector = call.options?.collector;
			expect(collector && !Array.isArray(collector) ? collector.name : undefined).toBe("run_1");
			expect(call.options?.tags).toEqual({ runId: "run_1", containerId: "ctr_1", functionName: "ExtractNote" });
			expect(call.options?.client).toBeUndefined();
		}
		const collectors = client.invocations.map((call) => call.options?.collector);
		expect(new Set(collectors).size).toBe(cases.length);

		const before = client.invocations.length;
		const unknown = await engine.invoke(request({ route: route({ api: "google-generative-ai" }) }));
		expect(unknown).toMatchObject({ ok: false, failure: { kind: "route" }, attempts: [], rawText: null });
		expect(unknown.ok ? "" : JSON.stringify(unknown.failure)).toContain("google-generative-ai");
		expect(client.invocations).toHaveLength(before);
	});

	test("a route without an api key still passes api_key, so BAML never falls back to OPENAI_API_KEY", async () => {
		const client = new FakeBamlClient().script(successScript(NOTE));
		const keyless = route({ headers: {} });
		delete keyless.apiKey;
		await engineWith(client).invoke(request({ route: keyless, secrets: [] }));
		const options = registryOf(client.invocations[0]!.options).primaryClient()!.options;
		expect(Object.hasOwn(options, "api_key")).toBe(true);
		expect(options.api_key).toBe("");
	});

	test("adds onTick only for /backend-api/ routes", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		client.script(successScript(NOTE), sseScript(NOTE), successScript(NOTE));
		await engine.invoke(request({ route: route({ baseUrl: "http://127.0.0.1:2455/v1" }) }));
		await engine.invoke(request({ route: route({ baseUrl: "http://127.0.0.1:2455/backend-api/codex" }) }));
		await engine.invoke(request({ route: route({ baseUrl: "https://api.example.com/backend-api" }) }));
		expect(client.invocations.map((call) => call.viaStream)).toEqual([false, true, false]);
		expect(typeof client.invocations[1]!.options?.onTick).toBe("function");
		expect(client.invocations[0]!.options && "onTick" in client.invocations[0]!.options).toBe(false);
	});

	test("classifies abort, timeout-before-http, http, validation, finish-reason, offline \"Failed to coerce\"", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		const failureOf = async (over: Partial<CallEngineInvokeRequest<FakeBamlClient, "ExtractNote">> = {}) => {
			const out = await engine.invoke(request(over));
			if (out.ok) throw new Error("expected a failure");
			return out.failure;
		};

		client.script(abortScript());
		expect(await failureOf()).toEqual({ kind: "aborted" });
		client.script(timeoutScript());
		expect(await failureOf()).toEqual({ kind: "timeout" });
		client.script(httpErrorScript(400, `{"error":"bad"}`));
		expect(await failureOf()).toEqual({ kind: "http", status: 400, rawResponse: `{"error":"bad"}` });
		client.script(parseErrorScript("banana"));
		expect(await failureOf()).toMatchObject({ kind: "parse", rawOutput: "banana" });
		client.script(finishReasonScript("truncated {", "length"));
		expect(await failureOf()).toEqual({ kind: "finish_reason", finishReason: "length", rawOutput: "truncated {" });
		client.script({ rawLlmResponse: "garbage", outcome: { error: new BamlError("Failed to coerce value: expected Note") } });
		expect(await failureOf()).toEqual({ kind: "parse", message: "Failed to coerce value: expected Note", rawOutput: "garbage" });
		client.script({ outcome: { error: new BamlError("template render failed") } });
		expect(await failureOf()).toEqual({ kind: "other", message: "template render failed" });
		client.script({ outcome: { error: new Error("socket hang up") } });
		expect(await failureOf()).toEqual({ kind: "other", message: "socket hang up" });

		// A pre-aborted signal reaches the generated client, which throws BamlAbortError itself.
		expect(await failureOf({ signal: AbortSignal.abort("deadline") })).toEqual({ kind: "aborted" });
		expect(client.invocations.at(-1)!.options?.signal?.aborted).toBe(true);
	});

	test("orders attempts by start time and keeps the selected flag", async () => {
		const client = new FakeBamlClient().script({
			calls: [
				{ startTimeUtcMs: 3_000, clientName: "Third", selected: true, response: { status: 200, body: responsesBody("{}") } },
				{ startTimeUtcMs: 1_000, clientName: "First", selected: false, response: { status: 500, body: "boom" } },
				{ startTimeUtcMs: 2_000, clientName: "Second", selected: false, response: { status: 429, body: "slow down" } },
			],
			rawLlmResponse: JSON.stringify(NOTE),
			outcome: { value: NOTE },
		});
		const out = await engineWith(client).invoke(request());
		expect(out.attempts.map((a) => [a.clientName, a.startedAtMs, a.selected, a.status])).toEqual([
			["First", 1_000, false, 500],
			["Second", 2_000, false, 429],
			["Third", 3_000, true, 200],
		]);
		expect(out.attempts.every((a) => a.transport === "baml-http")).toBe(true);
		expect(out.attempts[1]!.response).toMatchObject({ status: 429, body: "slow down" });
		expect(out.rawText).toBe(JSON.stringify(NOTE));
	});

	test("reads reasoning and cache-write tokens from body and from response.completed SSE", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		const usage = {
			input_tokens: 12,
			output_tokens: 5,
			input_tokens_details: { cached_tokens: 2, cache_write_tokens: 4 },
			output_tokens_details: { reasoning_tokens: 7 },
		};
		client.script({
			calls: [
				{
					startTimeUtcMs: 1_000,
					usage: { inputTokens: 12, outputTokens: 5, cachedInputTokens: 2 },
					response: { status: 200, body: responsesBody(JSON.stringify(NOTE), { model: "served-body", usage }) },
				},
			],
			outcome: { value: NOTE },
		});
		const body = await engine.invoke(request());
		expect(body.attempts[0]).toMatchObject({
			usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 4, model: "served-body" },
			reasoningTokens: 7,
		});

		client.script(
			sseScript(NOTE, {
				model: "served-stream",
				usage: { ...usage, input_tokens_details: { cache_write_tokens: 3 }, output_tokens_details: { reasoning_tokens: 9 } },
			}),
		);
		const stream = await engine.invoke(request({ route: route({ baseUrl: "http://127.0.0.1:2455/backend-api/codex" }) }));
		const attempt = stream.attempts[0]!;
		expect(attempt).toMatchObject({
			status: null,
			usage: { cacheWriteTokens: 3, model: "served-stream" },
			reasoningTokens: 9,
		});
		expect(attempt.response && "sse" in attempt.response ? attempt.response.sse.map((f) => (f as { type: string }).type) : []).toEqual([
			"response.created",
			"response.output_text.delta",
			"response.completed",
		]);

		// Anthropic reports cache writes as cache_creation_input_tokens; no body model falls back to the request's.
		client.script({
			calls: [
				{
					startTimeUtcMs: 1_000,
					usage: { inputTokens: 3, outputTokens: 1, cachedInputTokens: null },
					request: { body: { model: "claude-requested" } },
					response: { status: 200, body: { usage: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 6 } } },
				},
			],
			outcome: { value: NOTE },
		});
		const anthropic = await engine.invoke(request({ route: route({ api: "anthropic-messages" }) }));
		expect(anthropic.attempts[0]!.usage).toEqual({
			inputTokens: 3,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 6,
			model: "claude-requested",
		});
		expect(anthropic.attempts[0]!.reasoningTokens).toBeUndefined();
	});

	test("redacts authorization and the api key everywhere", async () => {
		const client = new FakeBamlClient().script({
			...successScript(NOTE),
			calls: [
				{
					startTimeUtcMs: 1_000,
					usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
					request: { url: `http://fake.invalid/v1/responses?api_key=${KEY}` },
					response: { status: 200, headers: { "set-cookie": `session=${KEY}`, "x-request-id": "req_1" }, body: responsesBody("{}") },
				},
			],
		});
		const out = await engineWith(client).invoke(request());
		const attempt = out.attempts[0]!;
		// The collector's request carries the raw bearer, like the real one; nothing of it survives.
		expect(attempt.request?.headers).toMatchObject({
			authorization: "<redacted>",
			"x-fake-token": "<redacted>",
			"x-trace": "visible",
			"content-type": "application/json",
		});
		expect(attempt.request?.url).toBe("http://fake.invalid/v1/responses?api_key=<redacted>");
		expect(attempt.response && "headers" in attempt.response ? attempt.response.headers : {}).toEqual({
			"set-cookie": "<redacted>",
			"x-request-id": "req_1",
		});
		const visible = JSON.stringify(out);
		expect(visible).not.toContain(KEY);
		expect(visible).not.toContain(HEADER_TOKEN);

		// The route's own credentials are scrubbed even when the caller's secret set misses them.
		const echo = `key=${KEY} token=${HEADER_TOKEN}`;
		client.script({
			calls: [{ startTimeUtcMs: 1_000, response: { status: 200, body: responsesBody(echo) } }],
			rawLlmResponse: echo,
			outcome: { value: { disposition: "KEEP", items: [echo] } },
		});
		const incomplete = await engineWith(client).invoke(request({ secrets: [] }));
		expect(JSON.stringify(incomplete)).not.toContain(KEY);
		expect(JSON.stringify(incomplete)).not.toContain(HEADER_TOKEN);
		expect(incomplete.rawText).toBe("key=<redacted> token=<redacted>");
	});

	test("native header objects normalize to strings", async () => {
		const headers = new Map<string, unknown>([
			["content-length", 42],
			["x-list", ["a", "b"]],
			["x-skip", undefined],
		]);
		const client = new FakeBamlClient().script({
			calls: [
				{
					startTimeUtcMs: 1_000,
					request: { headers: { "x-retry": 2, "x-flags": { beta: true }, authorization: `Bearer ${KEY}` } },
					response: { status: 200, headers, body: responsesBody("{}") },
				},
			],
			outcome: { value: NOTE },
		});
		const out = await engineWith(client).invoke(request());
		const attempt = out.attempts[0]!;
		expect(attempt.request?.headers).toEqual({ "x-retry": "2", "x-flags": `{"beta":true}`, authorization: "<redacted>" });
		expect(attempt.response && "headers" in attempt.response ? attempt.response.headers : {}).toEqual({
			"content-length": "42",
			"x-list": `["a","b"]`,
		});
	});

	test("credential echoes are scrubbed in JSON body, SSE frame, raw text and HTTP error", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		const echo = `key=${KEY} token=${HEADER_TOKEN}`;

		client.script({
			calls: [{ startTimeUtcMs: 1_000, response: { status: 200, body: responsesBody(echo, { model: echo }) } }],
			rawLlmResponse: echo,
			outcome: { value: { disposition: "KEEP", items: [echo] } },
		});
		const json = await engine.invoke(request());

		client.script({
			calls: [{ startTimeUtcMs: 1_000, sse: [{ type: "response.output_text.delta", delta: echo }, `raw frame ${KEY}`] }],
			rawLlmResponse: echo,
			outcome: { value: NOTE },
		});
		const sse = await engine.invoke(request({ route: route({ baseUrl: "http://127.0.0.1:2455/backend-api/codex" }) }));

		client.script(httpErrorScript(401, `{"error":{"message":"invalid ${echo}"}}`));
		const http = await engine.invoke(request());

		client.script(parseErrorScript(echo));
		const parse = await engine.invoke(request());

		for (const out of [json, sse, http, parse]) {
			const visible = JSON.stringify(out);
			expect(visible).not.toContain(KEY);
			expect(visible).not.toContain(HEADER_TOKEN);
			expect(visible).toContain("<redacted>");
		}
		expect(json).toMatchObject({ ok: true, value: { items: ["key=<redacted> token=<redacted>"] }, rawText: "key=<redacted> token=<redacted>" });
		expect(http).toMatchObject({ ok: false, failure: { kind: "http", status: 401, rawResponse: `{"error":{"message":"invalid key=<redacted> token=<redacted>"}}` } });
		expect(parse).toMatchObject({ ok: false, failure: { kind: "parse", rawOutput: "key=<redacted> token=<redacted>" } });
		expect(sse.attempts[0]!.response).toEqual({
			sse: [{ type: "response.output_text.delta", delta: "key=<redacted> token=<redacted>" }, "raw frame <redacted>"],
		});
	});

	test("a short call credential is refused before invoke", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		const shortKey = await engine.invoke(request({ route: route({ apiKey: "x" }), secrets: ["x"] }));
		expect(shortKey).toEqual({
			ok: false,
			failure: { kind: "route", message: SHORT_CREDENTIAL_MESSAGE },
			attempts: [],
			rawText: null,
		});
		const shortHeader = await engine.invoke(request({ route: route({ headers: { "x-api-key": "Bearer abc" } }) }));
		expect(shortHeader).toMatchObject({ ok: false, failure: { kind: "route", message: SHORT_CREDENTIAL_MESSAGE } });
		expect(client.invocations).toHaveLength(0);
	});

	test("a name that is not a generated function rejects as a programmer error", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client);
		const bad = request({ name: "withOptions" as "ExtractNote" });
		await expect(engine.invoke(bad)).rejects.toMatchObject({ name: "KernelNodeError", code: "unknown-function" });
		expect(client.invocations).toHaveLength(0);
	});
});

describe("bamlEngine BAML logging", () => {
	const levelsAfter = (value: string | undefined) => {
		if (value === undefined) delete process.env.BAML_LOG;
		else process.env.BAML_LOG = value;
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			engineWith();
			return { level: process.env.BAML_LOG, notices: warn.mock.calls.map((call) => String(call[0])) };
		} finally {
			warn.mockRestore();
		}
	};
	afterEach(() => {
		process.env.BAML_LOG = "error";
	});

	test("passes env BAML_LOG=error on every invoke and render; normalizes ambient trace/debug/info/warn/unset to error, keeps error and off; never calls setLogLevel", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client, { transportByFunction: { ScoreText: "pi" } });
		client.script(successScript(NOTE), sseScript(NOTE));
		await engine.invoke(request());
		await engine.invoke(request({ route: route({ baseUrl: "http://127.0.0.1:2455/backend-api/codex" }) }));
		const { transport } = scriptedTransport({ attempt: piAttempt(), text: "7", secrets: [] });
		const scored = await engine.invoke({ ...request(), name: "ScoreText", args: ["text", 10], transport });
		expect(scored).toMatchObject({ ok: true, value: 7 });

		const envs = [
			...client.invocations.map((call) => call.options?.env),
			...client.renders.map((call) => call.options?.env),
			...client.parses.map((call) => call.options?.env),
		];
		expect(envs).toHaveLength(4);
		for (const env of envs) expect(env).toEqual({ BAML_LOG: "error" });
		expect(envs[0]).not.toBe(envs[1]); // a fresh object per call

		for (const ambient of [undefined, "trace", "debug", "info", "warn", "verbose", "ERROR"]) {
			const after = levelsAfter(ambient);
			expect(after.level).toBe("error");
			expect(after.notices).toEqual([BAML_LOG_NORMALIZED_NOTICE]);
			expect(after.notices[0]).toContain("BAML_LOG");
		}
		for (const kept of ["error", "off"]) {
			expect(levelsAfter(kept)).toEqual({ level: kept, notices: [] });
		}

		expect(setLogLevelCalls).toEqual([]);
		// The adapter source never calls setLogLevel and never names a warn level.
		const dir = import.meta.dir;
		const sources = readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
		expect(sources.length).toBeGreaterThan(5);
		for (const file of sources) {
			const text = readFileSync(join(dir, file), "utf8");
			expect({ file, calls: /setLogLevel\s*\(/.test(text) }).toEqual({ file, calls: false });
			expect({ file, warnLevel: /["'`]warn["'`]/i.test(text) }).toEqual({ file, warnLevel: false });
		}
	});
});

describe("bamlEngine invoke: Pi transport", () => {
	test("pi transport renders through an inert render registry, completes, parses; a parse error carries rawOutput", async () => {
		const client = new FakeBamlClient();
		const engine = engineWith(client, { transport: "pi", retryPolicy: "KernelCallRetry" });
		const parsed = JSON.stringify({ disposition: "FIX", items: ["a"] });
		const ok = scriptedTransport({ attempt: piAttempt(), text: parsed, secrets: [] });

		const out = await engine.invoke(request({ transport: ok.transport, args: ["the note"], timeoutMs: 30_000 }));

		expect(out).toEqual({ ok: true, value: { disposition: "FIX", items: ["a"] }, attempts: [piAttempt()], rawText: parsed });
		// No generated function ran (BAML sent nothing); one render, one parse.
		expect(client.invocations).toHaveLength(0);
		expect(client.renders).toHaveLength(1);
		const render = client.renders[0]!;
		expect(render.options?.client).toBeUndefined();
		const registry = registryOf(render.options);
		expect(registry.clients.size).toBe(1);
		expect(registry.primaryClient()).toEqual({
			name: "KernelRender",
			provider: "openai-responses",
			options: { base_url: "http://render.invalid/v1", api_key: "render-only", model: "fake-model" },
			retryPolicy: undefined,
		});
		// The route's credentials never reach BAML on this path; the static client is never used.
		expect(JSON.stringify(client.renders)).not.toContain(KEY);
		expect(JSON.stringify(client.renders)).not.toContain("static.invalid");
		expect(ok.sent).toEqual([
			{
				systemPrompt: "Extract the advisories from the note.",
				messages: [{ role: "user", text: "the note" }],
				timeoutMs: 30_000,
			},
		]);
		expect(client.parses).toHaveLength(1);
		expect(client.parses[0]!.text).toBe(parsed);
		expect(client.parses[0]!.options?.clientRegistry).toBe(registry);

		const bad = scriptedTransport({ attempt: piAttempt(), text: "I could not find anything.", secrets: [] });
		const failed = await engine.invoke(request({ transport: bad.transport }));
		expect(failed).toMatchObject({
			ok: false,
			failure: { kind: "parse", rawOutput: "I could not find anything." },
			attempts: [piAttempt()],
			rawText: "I could not find anything.",
		});
		expect(failed.ok ? "" : (failed.failure as { message: string }).message).toContain("Failed to coerce");
	});

	test("maps Pi transport failures: refusals are route failures, then abort, HTTP status, timeout", async () => {
		const engine = engineWith(new FakeBamlClient(), { transport: "pi" });
		const failureFor = async (
			result: Awaited<ReturnType<PiTransport["complete"]>>,
			over: Partial<CallEngineInvokeRequest<FakeBamlClient, "ExtractNote">> = {},
		) => {
			const out = await engine.invoke(request({ transport: scriptedTransport(result).transport, ...over }));
			if (out.ok) throw new Error("expected a failure");
			return out.failure;
		};
		const empty = piAttempt({ status: null, usage: null });

		expect(await failureFor({ attempt: empty, text: null, errorMessage: SHORT_CREDENTIAL_MESSAGE, secrets: [] })).toEqual({
			kind: "route",
			message: SHORT_CREDENTIAL_MESSAGE,
		});
		const controller = new AbortController();
		const aborting: PiTransport = {
			async complete() {
				controller.abort("deadline");
				return { attempt: empty, text: null, errorMessage: "Request was aborted", secrets: [] };
			},
		};
		expect(await engine.invoke(request({ transport: aborting, signal: controller.signal }))).toMatchObject({
			ok: false,
			failure: { kind: "aborted" },
		});
		const rateLimited = piAttempt({ status: 429, response: { status: 429, headers: {}, body: { error: "slow down" } } });
		expect(await failureFor({ attempt: rateLimited, text: null, errorMessage: "429 slow down", secrets: [] })).toEqual({
			kind: "http",
			status: 429,
			rawResponse: `{"error":"slow down"}`,
		});
		expect(await failureFor({ attempt: empty, text: null, errorMessage: "Request timed out.", secrets: [] })).toEqual({
			kind: "timeout",
		});
		expect(await failureFor({ attempt: empty, text: null, errorMessage: "socket closed", secrets: [] })).toEqual({
			kind: "other",
			message: "socket closed",
		});
		const throwing: PiTransport = {
			async complete() {
				throw new Error("transport bug");
			},
		};
		expect(await engine.invoke(request({ transport: throwing }))).toMatchObject({
			ok: false,
			failure: { kind: "other", message: "transport bug" },
			attempts: [],
		});
		// A pre-aborted signal renders and sends nothing.
		const unused = scriptedTransport({ attempt: empty, text: "{}", secrets: [] });
		expect(await engine.invoke(request({ transport: unused.transport, signal: AbortSignal.abort() }))).toMatchObject({
			ok: false,
			failure: { kind: "aborted" },
		});
		expect(unused.sent).toHaveLength(0);
	});
});

// ── through the kernel's real Pi transport (createPiTransport) ─────────────────

const PI_BASE_URL = "http://fake.invalid/v1";

async function fakePiRegistry() {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
	});
	runtime.registerProvider("fake", {
		name: "Fake",
		baseUrl: PI_BASE_URL,
		api: "openai-responses",
		headers: { "x-fake-token": HEADER_TOKEN },
		models: [
			{
				id: "fake-model",
				name: "Fake model",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4_096,
			},
		],
	});
	await runtime.setRuntimeApiKey("fake", KEY);
	const registry = new ModelRegistry(runtime);
	const resolved = await resolveCallRoute(registry, "fake/fake-model", "low");
	if (!resolved.ok) throw new Error(resolved.failure.message);
	return { runtime, registry, resolved };
}

interface SeenRequest {
	headers: Headers;
	body: Record<string, unknown>;
}

function fakeFetch(respond: (request: SeenRequest) => Response) {
	const seen: SeenRequest[] = [];
	const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const request = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
		seen.push(request);
		return respond(request);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, seen };
}

function bearerOf(request: SeenRequest): string {
	return (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
}

/** An OpenAI Responses SSE stream whose one message says `text`; `echo` lands in an extra frame field. */
function responsesStream(text: string, echo: string): Response {
	const events = [
		{ type: "response.created", response: { id: "resp_1", status: "in_progress", output: [], metadata: { echo } } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
		},
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_1", delta: text },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
		},
		{
			type: "response.completed",
			response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
		},
	];
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Wraps a transport the way the kernel collects its returned secrets for the second scrub pass. */
function collecting(transport: PiTransport) {
	const secrets: string[] = [];
	return {
		secrets,
		transport: {
			async complete(req: PiTransportRequest) {
				const out = await transport.complete(req);
				secrets.push(...out.secrets);
				return out;
			},
		} satisfies PiTransport,
	};
}

describe("bamlEngine invoke: through createPiTransport", () => {
	test("Pi transport scrubs credentials rotated after preflight", async () => {
		const { runtime, registry, resolved } = await fakePiRegistry();
		expect(resolved.secrets).not.toContain(ROTATED_KEY);
		await runtime.setRuntimeApiKey("fake", ROTATED_KEY);
		const engine = engineWith(new FakeBamlClient(), { transport: "pi" });
		const invokeWith = async (base: ReturnType<typeof fakeFetch>) => {
			const wrapped = collecting(
				createPiTransport(registry, resolved.model, { reasoning: "low", secrets: resolved.secrets, fetch: base.fetch }),
			);
			const out = await engine.invoke(
				request({ route: resolved.route, secrets: resolved.secrets, transport: wrapped.transport }),
			);
			return { out, secrets: wrapped.secrets };
		};

		// Success: the new key echoed in the output text (so in the parsed value) and in an SSE frame.
		const success = fakeFetch((req) =>
			responsesStream(JSON.stringify({ disposition: "KEEP", items: [`sent ${bearerOf(req)}`] }), bearerOf(req)),
		);
		const ok = await invokeWith(success);
		expect(bearerOf(success.seen[0]!)).toBe(ROTATED_KEY);
		expect(ok.out).toMatchObject({ ok: true, value: { disposition: "KEEP", items: ["sent <redacted>"] } });
		expect(ok.secrets).toContain(ROTATED_KEY);

		// Error: the new key echoed in an HTTP error body and message.
		const rejected = fakeFetch(
			(req) =>
				new Response(JSON.stringify({ error: { message: `invalid key ${bearerOf(req)}`, type: "invalid_request_error" } }), {
					status: 401,
					headers: { "content-type": "application/json" },
				}),
		);
		const error = await invokeWith(rejected);
		expect(error.out).toMatchObject({ ok: false, failure: { kind: "http", status: 401 } });
		expect(error.secrets).toContain(ROTATED_KEY);

		for (const out of [ok.out, error.out]) {
			const visible = JSON.stringify(out);
			expect(visible).not.toContain(ROTATED_KEY);
			expect(visible).not.toContain(KEY);
			expect(visible).not.toContain(HEADER_TOKEN);
			expect(visible).toContain("<redacted>");
		}

		// A rotated 5-character key is refused before anything is sent.
		await runtime.setRuntimeApiKey("fake", "abcde");
		const never = fakeFetch(() => responsesStream("{}", ""));
		const refused = await invokeWith(never);
		expect(never.seen).toHaveLength(0);
		expect(refused.out).toMatchObject({ ok: false, failure: { kind: "route", message: SHORT_CREDENTIAL_MESSAGE } });
	});

	test("Pi transport carries the reasoning level", async () => {
		const { registry, resolved } = await fakePiRegistry();
		const engine = engineWith(new FakeBamlClient(), { transport: "pi" });
		const base = fakeFetch(() => responsesStream(JSON.stringify(NOTE), ""));
		for (const reasoning of ["high", "low"] as const) {
			const transport = createPiTransport(registry, resolved.model, { reasoning, secrets: resolved.secrets, fetch: base.fetch });
			const out = await engine.invoke(
				request({ route: { ...resolved.route, reasoning }, secrets: resolved.secrets, transport }),
			);
			expect(out).toMatchObject({ ok: true, value: NOTE });
		}
		expect(base.seen.map((req) => (req.body.reasoning as { effort?: string } | undefined)?.effort)).toEqual(["high", "low"]);
		// The rendered prompt is what Pi sends: system text as instructions, the note as the user message.
		expect(JSON.stringify(base.seen[0]!.body.input)).toContain("Checkpoint 4: kept type_erasing_cast for matching.");
		expect(JSON.stringify(base.seen[0]!.body.input)).toContain("Extract the advisories from the note.");

		// The BAML-native path carries it in the KernelCall leaf.
		const client = new FakeBamlClient().script(successScript(NOTE));
		await engineWith(client).invoke(request({ route: route({ reasoning: "high" }) }));
		expect(registryOf(client.invocations[0]!.options).primaryClient()!.options.reasoning).toEqual({ effort: "high" });
	});
});
