/**
 * The Pi decision engine (plan §4.3) against Pi's real `typesafe` provider
 * with an injected fetch (wire mapping, pinning, served model, retries,
 * secrets), and against the offline fake classifier provider. Global fetch
 * throws for the whole file.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getAgentRun, getTraceEventsForRun, type KernelDatabase } from "@agent-kernel/db";
import type { CallEndData, CallStartData } from "@agent-kernel/protocol";
import { createModels } from "@earendil-works/pi-ai";

import { createModelNodeContext } from "../context";
import { createFakeClassifier, createFakeClassifierRegistry } from "../__fixtures__/fake-classifier";
import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import { SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { KernelNodeError, toPiQuestions, type DecisionQuestion, type KernelDecideConfig } from "../types";
import {
	boolQ,
	choiceQ,
	expectDoctorOk,
	rowsContaining,
	scoreQ,
	SYSTEM_ONE_REPLY,
	TS_KEY,
	typesafeRegistry,
	wire,
	wireFetch,
} from "./__fixtures__/decide-harness";
import { createDecide } from "./index";
import { createPiDecisionEngine } from "./pi-engine";

let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
});
afterAll(() => {
	restoreFetch();
});

let temps: TempKernel[] = [];
afterEach(() => {
	for (const temp of temps.splice(0)) temp.cleanup();
});

const QUESTIONS: Record<string, DecisionQuestion> = {
	justified: boolQ(),
	next_action: choiceQ(["accept", "revise", "escalate", "other"]),
	quality: scoreQ(4),
};
async function typesafeKernel(
	fetch: typeof globalThis.fetch,
	opts: { key?: string; model?: string; decide?: Omit<KernelDecideConfig, "engine"> } = {},
) {
	const registry = await typesafeRegistry(opts.key);
	const temp = await createTempKernel({
		decide: { ...opts.decide, engine: createPiDecisionEngine({ models: registry, fetch }) },
		models: { defaults: { decide: opts.model ?? "typesafe/jev-1.13.0" }, prices: {} },
	});
	temps.push(temp);
	return temp;
}

function request(model: string, extra: { maxRetries?: number; signal?: AbortSignal } = {}) {
	return {
		model,
		state: { finding: "type_erasing_cast" },
		questions: toPiQuestions(QUESTIONS),
		timeoutMs: 5_000,
		maxRetries: extra.maxRetries ?? 1,
		...(extra.signal !== undefined && { signal: extra.signal }),
	};
}

async function eventsOf(db: KernelDatabase, runId: string) {
	return getTraceEventsForRun(db, runId);
}

describe("model resolution and the wire", () => {
	test("pi-engine resolves a listed classifier (fake provider)", async () => {
		const { fake, registry } = await createFakeClassifierRegistry();
		fake.setScript(() => ({ answers: { justified: { type: "bool", probability: 0.91 } }, usage: { input: 12, output: 2 } }));
		const engine = createPiDecisionEngine({ models: registry });
		expect(await engine.describe(fake.ref)).toEqual({
			engine: "pi-ai",
			api: "fake-classify",
			provider: "fake-decide",
			modelId: "fake-jev",
		});
		const result = await engine.classify(request(fake.ref));
		expect(result).toMatchObject({
			ok: true,
			engine: "pi-ai",
			api: "fake-classify",
			provider: "fake-decide",
			requestedModel: "fake-decide/fake-jev",
			resolvedModel: "fake-decide/fake-jev",
			attempts: 1,
			usage: { inputTokens: 12, outputTokens: 2 },
			answers: { justified: { type: "bool", probability: 0.91 } },
			secrets: [],
		});
		expect(fake.calls[0]!.context.questions.justified).toEqual(toPiQuestions({ justified: boolQ() }).justified!);
		expect((await engine.classify(request("fake-decide/"))).error?.kind).toBe("unknown-model");
		expect((await engine.classify(request("nope/nothing"))).error?.kind).toBe("unknown-model");
		expect(await engine.describe("nope/nothing")).toBeUndefined();
	});

	test("pi-engine clones an unlisted pinned id and sends it on the wire", async () => {
		const { fetch, sent } = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const engine = createPiDecisionEngine({ models: await typesafeRegistry(), fetch });
		expect(await engine.describe("typesafe/jev-1.13.0")).toEqual({
			engine: "jev",
			api: "typesafe-system-one",
			provider: "typesafe",
			modelId: "jev-1.13.0",
		});
		const result = await engine.classify(request("typesafe/jev-1.13.0"));
		expect(sent).toHaveLength(1);
		expect(sent[0]!.url).toEndWith("/systemone");
		expect(sent[0]!.body.model).toBe("jev-1.13.0");
		expect((sent[0]!.body.questions as Record<string, { type: string }>).justified!.type).toBe("noul");
		expect(result).toMatchObject({ ok: true, engine: "jev", requestedModel: "typesafe/jev-1.13.0", attempts: 1 });
		// The exact wire request (after Pi's bool → noul mapping) is kept for the snapshot.
		expect((result.wireRequest as { questions: Record<string, { type: string }> }).questions.justified!.type).toBe("noul");
	});

	test("pi-engine records the served model from the response body", async () => {
		const { fetch } = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const engine = createPiDecisionEngine({ models: await typesafeRegistry(), fetch });
		const result = await engine.classify(request("typesafe/jev-latest"));
		expect(result.requestedModel).toBe("typesafe/jev-latest");
		expect(result.resolvedModel).toBe("typesafe/jev-1.13.0");
		expect(result.answers.justified).toEqual({ type: "bool", probability: 0.92 });
		expect(result.answers.quality!.distribution).toEqual({ "0": 0, "1": 0, "2": 0, "3": 1 });
		expect(result.usage).toEqual({ inputTokens: 755, outputTokens: 80 });
	});

	test("pi-engine passes timeoutMs, maxRetries and maxRetryDelayMs; 400 max_tokens_exceeded is not retried and maps to too-large", async () => {
		const { fake, registry } = await createFakeClassifierRegistry();
		const engine = createPiDecisionEngine({ models: registry, maxRetryDelayMs: 1_500 });
		await engine.classify({ ...request(fake.ref, { maxRetries: 3 }), timeoutMs: 4_321 });
		await engine.classify({ ...request(fake.ref), maxRetryDelayMs: 750 });
		expect(fake.calls[0]!.options).toMatchObject({ timeoutMs: 4_321, maxRetries: 3, maxRetryDelayMs: 1_500 });
		expect(fake.calls[1]!.options).toMatchObject({ maxRetryDelayMs: 750 });
		expect(typeof fake.calls[0]!.options?.fetch).toBe("function");

		const tooBig = wireFetch(() => wire({ detail: { error_type: "max_tokens_exceeded" } }, 400));
		const result = await createPiDecisionEngine({ models: await typesafeRegistry(), fetch: tooBig.fetch }).classify(
			request("typesafe/jev-latest", { maxRetries: 2 }),
		);
		expect(result.error).toMatchObject({ kind: "too-large", httpStatus: 400 });
		expect(tooBig.sent).toHaveLength(1);
		expect(result.attempts).toBe(1);
		expect(result.wireResponse).toEqual({ detail: { error_type: "max_tokens_exceeded" } });
	});

	test('pi-engine maps "Provider is not configured" to not-configured and abort to aborted', async () => {
		const unconfigured = await createFakeClassifierRegistry(createFakeClassifier({ configured: false }));
		const notConfigured = await createPiDecisionEngine({ models: unconfigured.registry }).classify(
			request(unconfigured.fake.ref),
		);
		expect(notConfigured).toMatchObject({ ok: false, attempts: 0, error: { kind: "not-configured" } });
		expect(notConfigured.error!.message).toContain("Provider is not configured");

		const { fake, registry } = await createFakeClassifierRegistry();
		fake.setScript(() => ({ hang: true }));
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 10);
		const aborted = await createPiDecisionEngine({ models: registry }).classify(request(fake.ref, { signal: ac.signal }));
		expect(aborted).toMatchObject({ ok: false, error: { kind: "aborted" } });

		// The real adapter aborts its in-flight fetch.
		const neverAnswers = (async (_input: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_, reject) =>
				init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }),
			)) as unknown as typeof globalThis.fetch;
		const ac2 = new AbortController();
		setTimeout(() => ac2.abort(), 10);
		const wireAborted = await createPiDecisionEngine({ models: await typesafeRegistry(), fetch: neverAnswers }).classify(
			request("typesafe/jev-latest", { signal: ac2.signal }),
		);
		expect(wireAborted.error?.kind).toBe("aborted");
	});

	test("openai-decisions api is labelled openai-decisions", async () => {
		const fake = createFakeClassifier({ provider: "openai", api: "openai-decisions", modelId: "gpt-6-luna" });
		fake.setScript(() => ({ answers: { justified: { type: "bool", probability: 0.1 } } }));
		const models = createModels();
		models.setProvider(fake.provider);
		const engine = createPiDecisionEngine({ models });
		expect((await engine.describe("openai/gpt-6-luna"))?.engine).toBe("openai-decisions");
		const result = await engine.classify(request("openai/gpt-6-luna"));
		expect(result).toMatchObject({
			ok: true,
			engine: "openai-decisions",
			api: "openai-decisions",
			provider: "openai",
			resolvedModel: "openai/gpt-6-luna",
		});
	});
});

describe("answers and secrets through kernel.decide", () => {
	test("malformed answers through the real Pi adapter", async () => {
		const { fetch } = wireFetch(() =>
			wire({
				model: "jev-1.13.0",
				answers: {
					ok: { type: "noul", noul: 1.5 },
					pick: { type: "choice", choice: "zzz", confidence: 0.9, probabilities: { zzz: 0.9, a: 0.1 } },
				},
			}),
		);
		const temp = await typesafeKernel(fetch);
		const outcome = await temp.kernel.decide("adapter-malformed", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { ok: boolQ(), pick: choiceQ(["a", "b"]) },
		});
		expect(outcome.answers.ok).toMatchObject({ abstained: true, abstainReason: "engine-error" });
		expect(outcome.answers.ok.verdict).toBeUndefined();
		expect(outcome.answers.pick).toMatchObject({ abstained: true, abstainReason: "engine-error" });
		expect(outcome.error).toMatchObject({ kind: "malformed-answer", message: "malformed answers: ok, pick" });
		expect(outcome.engine).toBe("jev");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("decision fetch secrets are scrubbed", async () => {
		// The service echoes the credential in a 200 JSON body, then in a 400 error text.
		const { fetch, sent } = wireFetch((n, request) =>
			n === 0
				? wire({ ...SYSTEM_ONE_REPLY, echo: { authorization: request.auth, key: TS_KEY } })
				: wire(`invalid request from ${request.auth}; key=${TS_KEY}`, 400),
		);
		const temp = await typesafeKernel(fetch);
		const opts = { containerId: temp.tempDb.containerId, questions: { justified: boolQ() } };
		const echoed = await temp.kernel.decide("secret-echo", { a: 1 }, opts);
		const failed = await temp.kernel.decide("secret-error", { a: 2 }, opts);
		expect(sent.map((s) => s.auth)).toEqual([`Bearer ${TS_KEY}`, `Bearer ${TS_KEY}`]);
		expect(echoed.answers.justified.verdict).toBe("pass");
		expect(failed.error).toMatchObject({ kind: "invalid-request", httpStatus: 400 });
		expect(failed.error!.message).toContain("<redacted>");
		expect(failed.error!.message).not.toContain(TS_KEY);
		// The wire response was persisted, scrubbed.
		const [turnEnd] = (await eventsOf(temp.tempDb.db, echoed.ids.runId)).filter((e) => e.type === "pi_turn_end");
		expect((turnEnd!.eventData as { response_blob_hash?: string }).response_blob_hash).toBeDefined();
		expect(rowsContaining(temp.tempDb.db, TS_KEY)).toEqual([]);
		expect(rowsContaining(temp.tempDb.db, "<redacted>").length).toBeGreaterThan(0);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("short decision credential is refused before sending", async () => {
		const { fetch, sent } = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const temp = await typesafeKernel(fetch, { key: "abc123" });
		const outcome = await temp.kernel.decide("short-key", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { justified: boolQ() },
		});
		expect(sent).toHaveLength(0);
		expect(outcome.error).toEqual({ kind: "auth", message: SHORT_CREDENTIAL_MESSAGE });
		expect(outcome.answers.justified).toMatchObject({ abstained: true, abstainReason: "engine-error" });
		const events = await eventsOf(temp.tempDb.db, outcome.ids.runId);
		expect(events.map((e) => e.type)).toEqual(["call_start", "decision_made", "call_end"]);
		expect(rowsContaining(temp.tempDb.db, "abc123")).toEqual([]);
		await expectDoctorOk(temp.tempDb.db);
	});
});

describe("retries and the operation deadline", () => {
	const backoffConfig = { timeoutMs: 100, maxRetries: 1, maxRetryDelayMs: 50 };

	test("an oversized server Retry-After is an immediate engine error", async () => {
		const { fetch, sent } = wireFetch(() => wire({ detail: "slow down" }, 429, { "retry-after": "60" }));
		const temp = await typesafeKernel(fetch, { decide: { maxRetryDelayMs: 2_000 } });
		const started = performance.now();
		const outcome = await temp.kernel.decide("retry-after-60", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { justified: boolQ() },
		});
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(sent).toHaveLength(1);
		expect(outcome.error?.kind).toBe("rate-limit");
		expect(outcome.error?.message).toContain("Server requested 60s retry delay");
		expect(outcome.answers.justified).toMatchObject({ abstained: true, abstainReason: "engine-error" });
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("error");
	});

	test("an allowed server Retry-After is honoured", async () => {
		const { fetch, sent } = wireFetch((n) =>
			n === 0 ? wire({ detail: "busy" }, 429, { "retry-after": "1" }) : wire(SYSTEM_ONE_REPLY),
		);
		const temp = await typesafeKernel(fetch, { decide: { maxRetryDelayMs: 2_000 } });
		const started = performance.now();
		const outcome = await temp.kernel.decide("retry-after-1", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { justified: boolQ() },
		});
		expect(performance.now() - started).toBeGreaterThanOrEqual(900);
		expect(sent).toHaveLength(2);
		expect(outcome.error).toBeUndefined();
		expect(outcome.answers.justified.verdict).toBe("pass");
		const [end] = (await eventsOf(temp.tempDb.db, outcome.ids.runId)).filter((e) => e.type === "call_end");
		expect((end!.eventData as CallEndData).attempts).toBe(2);
	});

	test("the operation deadline cancels a request during backoff", async () => {
		// 429 without retry headers: Pi backs off 375–500 ms, uncapped by maxRetryDelayMs.
		const { fetch, sent } = wireFetch(() => wire({ detail: "busy" }, 429));
		const temp = await typesafeKernel(fetch, { decide: backoffConfig });
		const outcome = await temp.kernel.decide("deadline", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { justified: boolQ() },
		});
		expect(sent).toHaveLength(1);
		const events = await eventsOf(temp.tempDb.db, outcome.ids.runId);
		const start = events.find((e) => e.type === "call_start")!;
		const end = events.find((e) => e.type === "call_end")!;
		const deadlineAt = Date.parse((start.eventData as CallStartData).deadline_at);
		// deadline = 100 × 2 + 50
		expect(deadlineAt - Date.parse(start.timestamp)).toBe(250);
		expect(Date.parse(end.timestamp) - Date.parse(start.timestamp)).toBeLessThan(375);
		expect(Date.parse(end.timestamp)).toBeGreaterThanOrEqual(deadlineAt);
		expect((end.eventData as CallEndData).status).toBe("aborted");
		expect(outcome.error?.kind).toBe("timeout");
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("aborted");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("recovery waits for deadline + grace while the original is in backoff", async () => {
		const requestId = "req-backoff-recovery";
		// The original is held in Pi's backoff for 1 s by an allowed server delay (deadline 100 × 2 + 2,000 ms),
		// so the second kernel's attempts land inside the backoff however slow the machine is.
		const heldConfig = { timeoutMs: 100, maxRetries: 1, maxRetryDelayMs: 2_000 };
		const original = wireFetch(() => wire({ detail: "busy" }, 429, { "retry-after": "1" }));
		const temp = await typesafeKernel(original.fetch, { decide: heldConfig });
		const opts = { containerId: temp.tempDb.containerId, questions: { justified: boolQ() }, requestId };
		const first = temp.kernel.decide("recovery", { a: 1 }, opts).then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		while (original.sent.length === 0) await Bun.sleep(1);
		// The original attempt is now sleeping in Pi's backoff.

		const [running] = temp.tempDb.db.all<{ id: string; status: string }>(sql`SELECT id, status FROM agent_runs`);
		expect(running?.status).toBe("running");
		const start = (await getTraceEventsForRun(temp.tempDb.db, running!.id, ["call_start"]))[0]!;
		const deadlineAtMs = Date.parse((start.eventData as CallStartData).deadline_at);

		const second = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const secondRegistry = await typesafeRegistry();
		const decideAt = (now: () => number) =>
			createDecide(
				createModelNodeContext({
					kernelId: temp.tempDb.kernelId,
					db: temp.tempDb.openHandle().db,
					now,
					models: { defaults: { decide: "typesafe/jev-1.13.0" } },
					decide: { ...heldConfig, engine: createPiDecisionEngine({ models: secondRegistry, fetch: second.fetch }) },
				}),
			);

		// Another kernel before deadline_at + 60 s: the original still owns the request.
		let early: unknown;
		try {
			await decideAt(Date.now)("recovery", { a: 1 }, opts);
		} catch (error) {
			early = error;
		}
		expect(early).toBeInstanceOf(KernelNodeError);
		expect((early as KernelNodeError).code).toBe("in-flight-elsewhere");
		expect(second.sent).toHaveLength(0);

		// Past deadline_at + 60 s grace: abandon and claim.
		const recovered = await decideAt(() => deadlineAtMs + 60_001)("recovery", { a: 1 }, opts);
		expect(recovered.replayed).toBe(false);
		expect(recovered.answers.justified.verdict).toBe("pass");
		expect(second.sent).toHaveLength(1);
		expect((await getAgentRun(temp.tempDb.db, running!.id))?.status).toBe("aborted");
		// The takeover happened while the original was still waiting out its backoff.
		expect(original.sent).toHaveLength(1);

		// The original's own completion lands after the takeover and rolls back.
		const late = await first;
		expect("error" in late && (late.error as KernelNodeError).code).toBe("row-write-failed");
		const abandoned = await getTraceEventsForRun(temp.tempDb.db, running!.id);
		expect(abandoned.map((e) => e.type)).toEqual(["call_start", "call_end"]);
		expect((abandoned[1]!.eventData as CallEndData).status).toBe("aborted");
		await expectDoctorOk(temp.tempDb.db);
	});
});
