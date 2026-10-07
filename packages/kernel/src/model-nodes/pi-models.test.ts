import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Api, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
	createPiModels,
	createPiTransport,
	PI_TRANSPORT_APIS,
	PI_TRANSPORT_UNSUPPORTED_MESSAGE,
	resolveCallRoute,
	SHORT_CREDENTIAL_MESSAGE,
	splitModelRef,
} from "./pi-models";

const realFetch = globalThis.fetch;
beforeAll(() => {
	globalThis.fetch = (async () => {
		throw new Error("network disabled in tests");
	}) as unknown as typeof fetch;
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

const BASE_URL = "http://fake.invalid/v1";
const KEY = "sk-fake-key-0123456789";
const ROTATED_KEY = "sk-rotated-key-9876543210";
const HEADER_TOKEN = "hdr-token-abcdefgh";

async function testRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
}

/** A registry with one fake provider `fake/fake-model` on the given Pi api. */
async function fakeRegistry(api: Api = "openai-responses", apiKey = KEY) {
	const runtime = await testRuntime();
	runtime.registerProvider("fake", {
		name: "Fake",
		baseUrl: BASE_URL,
		api,
		headers: { "x-fake-token": HEADER_TOKEN, "x-trace": "visible" },
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
	await runtime.setRuntimeApiKey("fake", apiKey);
	return { runtime, registry: new ModelRegistry(runtime) };
}

async function resolved(registry: ModelRegistry, reasoning: "low" | "medium" | "high" = "low") {
	const result = await resolveCallRoute(registry, "fake/fake-model", reasoning);
	if (!result.ok) throw new Error(result.failure.message);
	return result;
}

interface SeenRequest {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

/** A base fetch that records what Pi sends and answers with `respond(request)`. */
function fakeFetch(respond: (request: SeenRequest) => Response) {
	const seen: SeenRequest[] = [];
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const request: SeenRequest = {
			url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
		};
		seen.push(request);
		return respond(request);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, seen };
}

/** An OpenAI Responses SSE stream whose one message says `text`. */
function responsesStream(text: string): Response {
	const events = [
		{ type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
		},
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_1", delta: text },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_1",
				status: "completed",
				output: [],
				usage: {
					input_tokens: 12,
					output_tokens: 5,
					total_tokens: 17,
					input_tokens_details: { cached_tokens: 2 },
					output_tokens_details: { reasoning_tokens: 3 },
				},
			},
		},
	];
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function bearerOf(request: SeenRequest): string {
	return (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
}

const PROMPT = { systemPrompt: "Answer briefly.", messages: [{ role: "user" as const, text: "Say hello." }] };

/** Everything `complete()` returns that may be persisted or logged (`secrets` is neither). */
function visible(out: { attempt: unknown; text: string | null; errorMessage?: string }): string {
	return JSON.stringify({ attempt: out.attempt, text: out.text, errorMessage: out.errorMessage });
}

describe("createPiModels", () => {
	test("builds the runtime lazily, once, and shares one registry", async () => {
		let builds = 0;
		const models = createPiModels({
			runtime: async () => {
				builds++;
				return testRuntime();
			},
		});
		expect(builds).toBe(0);
		const [first, second] = await Promise.all([models.runtime(), models.runtime()]);
		const [registryA, registryB] = await Promise.all([models.registry(), models.registry()]);
		expect(builds).toBe(1);
		expect(first).toBe(second);
		expect(registryA).toBe(registryB);
		expect(registryA).toBeInstanceOf(ModelRegistry);
	});

	test("retries after a failed build instead of caching the rejection", async () => {
		let builds = 0;
		const models = createPiModels({
			runtime: async () => {
				builds++;
				if (builds === 1) throw new Error("auth.json unreadable");
				return testRuntime();
			},
		});
		await expect(models.registry()).rejects.toThrow("auth.json unreadable");
		expect(await models.runtime()).toBeInstanceOf(ModelRuntime);
		expect(builds).toBe(2);
	});
});

describe("resolveCallRoute", () => {
	test("resolves provider/id to the route, the api key and the secret set", async () => {
		const { registry } = await fakeRegistry();
		const result = await resolveCallRoute(registry, "fake/fake-model", "medium");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.route).toMatchObject({
			modelRef: "fake/fake-model",
			provider: "fake",
			modelId: "fake-model",
			api: "openai-responses",
			baseUrl: BASE_URL,
			apiKey: KEY,
			reasoning: "medium",
		});
		expect(result.route.headers["x-fake-token"]).toBe(HEADER_TOKEN);
		expect(result.model.id).toBe("fake-model");
		expect(result.secrets).toContain(KEY);
		expect(result.secrets).toContain(HEADER_TOKEN);
		expect(result.secrets).not.toContain("visible");
	});

	test("splits the ref at the first slash", () => {
		expect(splitModelRef("openrouter/meta/llama-4")).toEqual({ provider: "openrouter", modelId: "meta/llama-4" });
		expect(splitModelRef("no-slash")).toBeUndefined();
	});

	test("an unknown model is a route failure", async () => {
		const { registry } = await fakeRegistry();
		const result = await resolveCallRoute(registry, "fake/missing-model", "low");
		expect(result).toEqual({ ok: false, failure: { kind: "route", message: 'unknown model "fake/missing-model"' } });
	});

	test("a 5-character api key is refused as too short to redact", async () => {
		const { registry } = await fakeRegistry("openai-responses", "abcde");
		const result = await resolveCallRoute(registry, "fake/fake-model", "low");
		expect(result).toEqual({ ok: false, failure: { kind: "route", message: SHORT_CREDENTIAL_MESSAGE } });
	});
});

describe("createPiTransport", () => {
	test("sends with the bound reasoning level and returns text, usage and a redacted attempt", async () => {
		const { registry } = await fakeRegistry();
		const route = await resolved(registry, "high");
		const base = fakeFetch(() => responsesStream("hello world"));
		const transport = createPiTransport(registry, route.model, {
			reasoning: "high",
			secrets: route.secrets,
			fetch: base.fetch,
		});

		const out = await transport.complete(PROMPT);

		expect(base.seen).toHaveLength(1);
		expect(base.seen[0]!.url).toBe(`${BASE_URL}/responses`);
		expect(base.seen[0]!.body.reasoning).toMatchObject({ effort: "high" });
		expect(out.text).toBe("hello world");
		expect(out.errorMessage).toBeUndefined();
		expect(out.secrets).toContain(KEY);
		expect(out.attempt).toMatchObject({
			transport: "pi",
			clientName: "fake-model",
			provider: "fake",
			selected: true,
			status: 200,
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0, model: "fake-model" },
			reasoningTokens: 3,
		});
		expect(out.attempt.request?.method).toBe("POST");
		expect(out.attempt.request?.headers.authorization).toBe("<redacted>");
		expect(out.attempt.request?.headers["x-fake-token"]).toBe("<redacted>");
		expect(out.attempt.request?.headers["x-trace"]).toBe("visible");
		expect(out.attempt.request?.body).toMatchObject({ model: "fake-model", reasoning: { effort: "high" } });
		expect(out.attempt.response && "sse" in out.attempt.response ? out.attempt.response.sse.length : 0).toBe(5);
		expect(visible(out)).not.toContain(HEADER_TOKEN);

		const low = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });
		await low.complete(PROMPT);
		expect(base.seen[1]!.body.reasoning).toMatchObject({ effort: "low" });
	});

	test("replays assistant turns and the system prompt in order", async () => {
		const { registry } = await fakeRegistry();
		const route = await resolved(registry);
		const base = fakeFetch(() => responsesStream("third"));
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });
		const out = await transport.complete({
			systemPrompt: "Be terse.",
			messages: [
				{ role: "user", text: "first" },
				{ role: "assistant", text: "second" },
				{ role: "user", text: "next?" },
			],
		});
		expect(out.text).toBe("third");
		const input = base.seen[0]!.body.input as Array<{ role: string; content: unknown }>;
		expect(input.map((item) => item.role)).toEqual(["developer", "user", "assistant", "user"]);
		expect(JSON.stringify(input[2]!.content)).toContain("second");
	});

	test("scrubs a credential echoed in an SSE frame and the output text", async () => {
		const { registry } = await fakeRegistry();
		const route = await resolved(registry);
		const base = fakeFetch((request) => responsesStream(`your key is ${bearerOf(request)}`));
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(out.text).toBe("your key is <redacted>");
		expect(visible(out)).not.toContain(KEY);
		expect(JSON.stringify(out.attempt.response)).toContain("your key is <redacted>");
	});

	test("scrubs a credential echoed in an HTTP error body and the error message", async () => {
		const { registry } = await fakeRegistry();
		const route = await resolved(registry);
		const base = fakeFetch(
			(request) =>
				new Response(JSON.stringify({ error: { message: `invalid key ${bearerOf(request)}`, type: "invalid_request_error" } }), {
					status: 400,
					headers: { "content-type": "application/json" },
				}),
		);
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(out.text).toBeNull();
		expect(out.attempt.status).toBe(400);
		expect(out.errorMessage).toContain("invalid key <redacted>");
		expect(out.attempt.response).toMatchObject({ status: 400, body: { error: { message: "invalid key <redacted>" } } });
		expect(visible(out)).not.toContain(KEY);
	});

	test("scrubs a credential echoed in an SSE error frame", async () => {
		const { registry } = await fakeRegistry();
		const route = await resolved(registry);
		const base = fakeFetch((request) => {
			const frame = { type: "error", code: "auth", message: `rejected ${bearerOf(request)}` };
			return new Response(`data: ${JSON.stringify(frame)}\n\n`, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		});
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(out.text).toBeNull();
		expect(out.errorMessage).toContain("rejected <redacted>");
		expect(out.attempt.response).toEqual({ sse: [{ type: "error", code: "auth", message: "rejected <redacted>" }] });
		expect(visible(out)).not.toContain(KEY);
	});

	test("captures and scrubs a credential rotated after preflight", async () => {
		const { runtime, registry } = await fakeRegistry();
		const route = await resolved(registry);
		expect(route.secrets).not.toContain(ROTATED_KEY);
		await runtime.setRuntimeApiKey("fake", ROTATED_KEY);
		const base = fakeFetch((request) => responsesStream(`sent ${bearerOf(request)}`));
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(bearerOf(base.seen[0]!)).toBe(ROTATED_KEY);
		expect(out.secrets).toContain(ROTATED_KEY);
		expect(out.secrets).toContain(KEY);
		expect(out.text).toBe("sent <redacted>");
		expect(visible(out)).not.toContain(ROTATED_KEY);
	});

	test("refuses a rotated 5-character credential before the base fetch is called", async () => {
		const { runtime, registry } = await fakeRegistry();
		const route = await resolved(registry);
		await runtime.setRuntimeApiKey("fake", "abcde");
		const base = fakeFetch(() => responsesStream("never"));
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(base.seen).toHaveLength(0);
		expect(out.text).toBeNull();
		expect(out.errorMessage).toBe(SHORT_CREDENTIAL_MESSAGE);
		expect(out.attempt.request).toBeNull();
		expect(out.attempt.status).toBeNull();
	});

	test("refuses an api outside PI_TRANSPORT_APIS without sending", async () => {
		const { registry } = await fakeRegistry("mistral-conversations");
		const route = await resolved(registry);
		const base = fakeFetch(() => responsesStream("never"));
		const transport = createPiTransport(registry, route.model, { reasoning: "low", secrets: route.secrets, fetch: base.fetch });

		const out = await transport.complete(PROMPT);

		expect(PI_TRANSPORT_APIS).not.toContain("mistral-conversations");
		expect(base.seen).toHaveLength(0);
		expect(out.text).toBeNull();
		expect(out.errorMessage).toBe(PI_TRANSPORT_UNSUPPORTED_MESSAGE);
		expect(out.attempt).toMatchObject({ transport: "pi", request: null, response: null, status: null, usage: null });
	});

	test("every api in PI_TRANSPORT_APIS sends through the injected fetch with the outbound key captured", async () => {
		expect(PI_TRANSPORT_APIS).toContain("openai-responses");
		for (const api of PI_TRANSPORT_APIS) {
			const { registry } = await fakeRegistry(api as Api);
			const route = await resolved(registry);
			const base = fakeFetch(
				() =>
					new Response(JSON.stringify({ error: { message: "stop here", type: "invalid_request_error" } }), {
						status: 400,
						headers: { "content-type": "application/json" },
					}),
			);
			const transport = createPiTransport(registry, route.model, { reasoning: "low", fetch: base.fetch });

			const out = await transport.complete(PROMPT);

			expect({ api, sent: base.seen.length }).toEqual({ api, sent: 1 });
			expect(base.seen[0]!.url.startsWith(BASE_URL)).toBe(true);
			expect(out.secrets).toContain(KEY);
			expect(out.attempt.status).toBe(400);
			expect(JSON.stringify(out.attempt.request)).not.toContain(KEY);
		}
	});
});
