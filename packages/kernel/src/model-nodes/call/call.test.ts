/**
 * `kernel.call` (plan §3.4, M3-A) against a real temp database: intent-first
 * claim, one snapshot and one turn per engine attempt, output and raw-output
 * blobs, failure mapping to KernelCallError, cancellation and the operation
 * deadline, route failures, usage roll-up, replay, and model resolution. The
 * engine is the scripted fake; routes resolve through an offline Pi provider.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
	getAgentRun,
	getPiAgentSession,
	getTraceEventsForRun,
	type KernelDatabase,
} from "@agent-kernel/db";
import {
	kernelNodeEventId,
	type CallEndData,
	type CallStartData,
	type PiRequestSnapshotData,
	type PiTurnEndData,
	type TraceEvent,
} from "@agent-kernel/protocol";

import { runTraceDoctor } from "../../doctor";
import { createTempKernel, disableNetwork } from "../__fixtures__/temp-kernel";
import { canonicalJson } from "../blobs";
import { ROUTE_FAILURE_MESSAGES } from "../pi-models";
import type { ModelNodeLogger } from "../context";
import { KernelCallError, KernelNodeError, type CallFailure, type NodeIds } from "../types";
import { createCallKit, readBlob, type CallKit, type CallKitOptions, type TestClient } from "./__fixtures__/call-kit";
import {
	createFakeCallEngine,
	fakeAttempt,
	fakeFailure,
	fakeOk,
	untilAborted,
	FAKE_CALL_BASE_URL,
	FAKE_CALL_MODEL_REF,
} from "./__fixtures__/fake-call-engine";

let networkStub: typeof fetch;
let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
	networkStub = globalThis.fetch;
});
afterAll(() => {
	restoreFetch();
});

const kits: CallKit[] = [];
async function kit(opts: CallKitOptions = {}): Promise<CallKit> {
	const created = await createCallKit(opts);
	kits.push(created);
	return created;
}
afterEach(() => {
	globalThis.fetch = networkStub;
	for (const created of kits.splice(0)) created.cleanup();
});

const VALUE = { kept: ["type_erasing_cast"], reason: "needed for matching" };

function runIdOf(k: CallKit, index = 0): string {
	const runId = k.engine.invocations[index]?.tags.runId;
	if (!runId) throw new Error(`invocation ${index} has no runId tag`);
	return runId;
}

async function eventsOf(db: KernelDatabase, runId: string, type: string): Promise<TraceEvent[]> {
	return getTraceEventsForRun(db, runId, [type]);
}

async function callEnd(db: KernelDatabase, runId: string): Promise<CallEndData> {
	const [end] = await eventsOf(db, runId, "call_end");
	if (!end) throw new Error(`run ${runId} has no call_end`);
	return end.eventData as CallEndData;
}

async function callStart(db: KernelDatabase, runId: string): Promise<TraceEvent & { eventData: CallStartData }> {
	const [start] = await eventsOf(db, runId, "call_start");
	if (!start) throw new Error(`run ${runId} has no call_start`);
	return start as TraceEvent & { eventData: CallStartData };
}

async function rejection<E extends Error>(promise: Promise<unknown>, type: abstract new (...args: never[]) => E): Promise<E> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(type);
		return error as E;
	}
	throw new Error(`expected a ${type.name}`);
}

function countRows(db: KernelDatabase, table: string): number {
	const [row] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`);
	if (typeof row?.n !== "number") throw new Error(`count(${table}) returned no number`);
	return row.n;
}

async function expectDoctorOk(db: KernelDatabase): Promise<void> {
	const report = await runTraceDoctor(db);
	expect(report.violations).toEqual([]);
	expect(report.ok).toBe(true);
}

/** An OpenAI Responses SSE stream whose one message says `text` (pi-ai's openai-responses parser). */
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

describe("kernel.call", () => {
	test("call is intent-first: identity rows and call_start are committed before the engine runs", async () => {
		let started: NodeIds | undefined;
		let seen: Record<string, unknown> = {};
		const k: CallKit = await kit({
			async respond(req) {
				const runId = req.tags.runId!;
				const run = await getAgentRun(k.temp.db, runId);
				const session = run ? await getPiAgentSession(k.temp.db, run.piSessionId) : null;
				const [start] = await eventsOf(k.temp.db, runId, "call_start");
				const input = await readBlob(k.temp.db, (start?.eventData as CallStartData | undefined)?.input_blob_hash);
				seen = {
					startedFired: started?.runId === runId,
					runStatus: run?.status,
					sessionKind: session?.kind,
					inbound: run?.inboundEventId,
					startId: start?.eventId,
					input: { kind: input.kind, value: JSON.parse(input.text) as unknown },
				};
				return fakeOk(VALUE);
			},
		});
		const parent = await k.temp.seedParentRun();
		await k.call("Extract", ["note"], {
			parentRunId: parent.runId,
			onNodeStarted: (ids) => {
				started = ids;
			},
		});
		const runId = runIdOf(k);
		const startId = kernelNodeEventId(runId, 0, "call_start");
		expect(seen).toEqual({
			startedFired: true,
			runStatus: "running",
			sessionKind: "call",
			inbound: startId,
			startId,
			// The claim's placeholder input is readable while the engine runs.
			input: { kind: "call-input", value: { pending: true, redacted: ["note"] } },
		});
		expect(started).toMatchObject({ runId, containerId: k.temp.containerId, parentRunId: parent.runId });
		const [req] = k.engine.invocations;
		expect(req?.tags).toEqual({ runId, containerId: k.temp.containerId, functionName: "Extract" });
		expect(req?.timeoutMs).toBe(120_000);
		expect(req?.route).toMatchObject({ modelRef: FAKE_CALL_MODEL_REF, api: "openai-responses", reasoning: "low" });
		expect((await callStart(k.temp.db, runId)).eventData).toMatchObject({
			node_kind: "call",
			function_name: "Extract",
			engine: "baml",
			transport: "baml-http",
			model: FAKE_CALL_MODEL_REF,
			provider: "fake",
			api: "openai-responses",
			prompt_hash: "baml1-fake-Extract",
			trigger: "post-run",
			parent_run_id: parent.runId,
		});
	});

	test("one snapshot and one turn per attempt, ordered by start, with request and response blobs", async () => {
		const output = JSON.stringify(VALUE);
		const k = await kit({
			respond() {
				const t0 = Date.now() + 5;
				const failed = fakeAttempt({
					startedAtMs: t0,
					durationMs: 20,
					selected: false,
					status: 500,
					usage: null,
					system: "Be terse.",
					user: "Note B",
				});
				const retried = fakeAttempt({ startedAtMs: t0 + 40, durationMs: 30, system: "Be terse.", user: "Note B", output });
				// The engine lists the winner first; the kernel orders by start time.
				return fakeOk(VALUE, [retried, failed]);
			},
		});
		await k.call("Extract", ["Note B"]);
		const runId = runIdOf(k);
		const db = k.temp.db;
		const all = await getTraceEventsForRun(db, runId);
		const startId = kernelNodeEventId(runId, 0, "call_start");

		for (const type of ["pi_request_snapshot", "pi_turn_start", "pi_turn_end"]) {
			const events = all.filter((e) => e.type === type);
			expect(events.map((e) => e.eventId)).toEqual([0, 1].map((i) => kernelNodeEventId(runId, i, type)));
			expect(events.every((e) => e.parentEventId === startId)).toBe(true);
		}
		expect(all[0]?.type).toBe("call_start");
		expect(all.at(-1)?.type).toBe("call_end");
		const ends = all.filter((e) => e.type === "pi_turn_end").map((e) => e.eventData as PiTurnEndData);
		expect(ends.map((e) => [e.turn_number, e.http_status, e.stop_reason, e.duration_ms])).toEqual([
			[0, 500, "error", 20],
			[1, 200, "stop", 30],
		]);
		expect(ends[0]?.usage).toBeUndefined();
		const response = await readBlob(db, ends[1]?.response_blob_hash);
		expect(response.kind).toBe("call-response");
		expect(JSON.parse(response.text)).toMatchObject({
			status: 200,
			body: { output: [{ content: [{ type: "output_text", text: output }] }] },
		});

		for (const snapshot of all.filter((e) => e.type === "pi_request_snapshot")) {
			const data = snapshot.eventData as PiRequestSnapshotData;
			expect(data).toMatchObject({ request_kind: "baml-http", prompt_hash: "baml1-fake-Extract", message_count: 1 });
			expect(await readBlob(db, data.system_prompt_blob_hash)).toEqual({ kind: "text", text: "Be terse." });
			expect(data.message_refs).toEqual([
				expect.objectContaining({ role: "user", index: 0, text_chars: "Note B".length, image_count: 0 }),
			]);
			const message = await readBlob(db, data.message_refs[0]?.blob_hash);
			expect(message.kind).toBe("message");
			expect(JSON.parse(message.text)).toEqual({ role: "user", content: [{ type: "text", text: "Note B" }] });
			const raw = await readBlob(db, data.raw_request_blob_hash);
			expect(raw.kind).toBe("call-request");
			expect(JSON.parse(raw.text)).toMatchObject({
				method: "POST",
				url: `${FAKE_CALL_BASE_URL}/responses`,
				body: { model: "fake-model", input: [{ role: "system" }, { role: "user" }] },
			});
		}

		const startMs = Date.parse(all[0]!.timestamp);
		const endMs = Date.parse(all.at(-1)!.timestamp);
		for (const event of all.slice(1, -1)) {
			expect(Date.parse(event.timestamp)).toBeGreaterThan(startMs);
			expect(Date.parse(event.timestamp)).toBeLessThan(endMs);
		}
		expect((await callEnd(db, runId)).attempts).toBe(2);
		await expectDoctorOk(db);
	});

	test("snapshots read the conversation from Responses, chat-completions and Anthropic request bodies", async () => {
		const bodies: Array<{ shape: string; body: unknown }> = [
			{
				shape: "openai-responses",
				body: {
					instructions: "Sys",
					input: [
						{ role: "user", content: "Hi" },
						{ role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
					],
				},
			},
			{
				shape: "openai-generic",
				body: {
					messages: [
						{ role: "system", content: "Sys" },
						{ role: "user", content: [{ type: "text", text: "Hi" }, { type: "image_url", image_url: { url: "x" } }] },
						{ role: "assistant", content: "Hello" },
					],
				},
			},
			{
				shape: "anthropic",
				body: {
					system: [{ type: "text", text: "Sys" }],
					messages: [
						{ role: "user", content: "Hi" },
						{ role: "assistant", content: [{ type: "text", text: "Hello" }] },
					],
				},
			},
		];
		const k = await kit({ respond: (_req, index) => fakeOk(VALUE, [fakeAttempt({ requestBody: bodies[index]!.body })]) });
		for (const { shape } of bodies) {
			await k.call("Extract", [shape]);
		}
		for (const [index, { shape }] of bodies.entries()) {
			const [snapshot] = await eventsOf(k.temp.db, runIdOf(k, index), "pi_request_snapshot");
			const data = snapshot!.eventData as PiRequestSnapshotData;
			const system = await readBlob(k.temp.db, data.system_prompt_blob_hash);
			const messages = await Promise.all(
				data.message_refs.map(async (ref) => JSON.parse((await readBlob(k.temp.db, ref.blob_hash)).text) as unknown),
			);
			expect({ shape, system: system.text, messages, images: data.total_image_count }).toEqual({
				shape,
				system: "Sys",
				messages: [
					{ role: "user", content: [{ type: "text", text: "Hi" }] },
					{ role: "assistant", content: [{ type: "text", text: "Hello" }] },
				],
				images: shape === "openai-generic" ? 1 : 0,
			});
		}
	});

	test("ok writes a call-output blob equal to JSON(value); run done, session ended", async () => {
		const k = await kit({ respond: () => fakeOk(VALUE) });
		const value = await k.call("Extract", ["note"]);
		expect(value).toEqual(VALUE);
		const runId = runIdOf(k);
		const end = await callEnd(k.temp.db, runId);
		expect(end).toMatchObject({ status: "ok", attempts: 1, resolved_model: FAKE_CALL_MODEL_REF });
		expect(end.error).toBeUndefined();
		const output = await readBlob(k.temp.db, end.output_blob_hash);
		expect(output.kind).toBe("call-output");
		expect(JSON.parse(output.text)).toEqual(VALUE);
		// The final input is referenced from call_end; call_start keeps naming the placeholder.
		expect(await readBlob(k.temp.db, end.input_blob_hash)).toEqual({ kind: "call-input", text: canonicalJson(["note"]) });
		const start = await callStart(k.temp.db, runId);
		expect(start.eventData.input_blob_hash).not.toBe(end.input_blob_hash);
		const run = await getAgentRun(k.temp.db, runId);
		expect(run?.status).toBe("done");
		expect(run?.outboundEventId).toBe(kernelNodeEventId(runId, 0, "call_end"));
		expect((await getPiAgentSession(k.temp.db, run!.piSessionId))?.status).toBe("ended");
		await expectDoctorOk(k.temp.db);
	});

	test("parse failure throws KernelCallError(parse); run error; raw output blob kept; no model text in the message", async () => {
		const k = await kit({
			respond: () =>
				fakeFailure(
					{ kind: "parse", message: "Failed to coerce ---PROMPT--- secret prompt words", rawOutput: "banana, not JSON" },
					[fakeAttempt({ output: "banana, not JSON" })],
				),
		});
		const error = await rejection(k.call("Extract", ["note"]), KernelCallError);
		const runId = runIdOf(k);
		expect(error.message).toBe("Extract failed: parse");
		expect(error.runId).toBe(runId);
		expect(error.failure).toMatchObject({ kind: "parse", rawOutput: "banana, not JSON" });
		expect((await getAgentRun(k.temp.db, runId))?.status).toBe("error");
		const end = await callEnd(k.temp.db, runId);
		expect(end).toMatchObject({ status: "error", attempts: 1, error: { kind: "parse" } });
		expect(JSON.stringify(end.error)).not.toContain("banana");
		expect(JSON.stringify(end.error)).not.toContain("prompt words");
		expect(await readBlob(k.temp.db, end.output_blob_hash)).toEqual({ kind: "call-raw-output", text: "banana, not JSON" });
		const [turnEnd] = await eventsOf(k.temp.db, runId, "pi_turn_end");
		expect((turnEnd!.eventData as PiTurnEndData).stop_reason).toBe("error");
		await expectDoctorOk(k.temp.db);
	});

	test("an HTTP failure records its status on call_end and the error turn", async () => {
		const k = await kit({
			respond: () => fakeFailure({ kind: "http", status: 429, rawResponse: "slow down" }, [fakeAttempt({ status: 429, usage: null })]),
		});
		const error = await rejection(k.call("Extract", ["note"]), KernelCallError);
		expect(error.failure).toEqual({ kind: "http", status: 429, rawResponse: "slow down" });
		const end = await callEnd(k.temp.db, runIdOf(k));
		expect(end).toMatchObject({ status: "error", error: { kind: "http", message: "HTTP 429", http_status: 429 } });
		expect(end.output_blob_hash).toBeUndefined();
		await expectDoctorOk(k.temp.db);
	});

	const cancellations: Array<{
		name: string;
		expected: CallFailure["kind"];
		timeoutMs?: number;
		abortAfterMs?: number;
		/** The engine ignores the abort and still returns a value afterwards. */
		lateSuccess?: boolean;
	}> = [
		{ name: "the caller aborts", expected: "aborted", abortAfterMs: 5 },
		{ name: "the operation deadline passes", expected: "timeout", timeoutMs: 50 },
		{ name: "the caller aborts and the engine still returns a value", expected: "aborted", abortAfterMs: 5, lateSuccess: true },
		{ name: "the deadline passes and the engine still returns a value", expected: "timeout", timeoutMs: 50, lateSuccess: true },
	];
	for (const c of cancellations) {
		test(`abort ends the run aborted when ${c.name}`, async () => {
			const controller = new AbortController();
			const k = await kit({
				async respond(req) {
					if (c.abortAfterMs !== undefined) setTimeout(() => controller.abort(), c.abortAfterMs);
					await untilAborted(req.signal);
					const attempt = fakeAttempt({ status: null, usage: null, durationMs: 5 });
					if (c.lateSuccess) return fakeOk(VALUE, [{ ...attempt, status: 200 }]);
					// BAML reports both as an abort: the deadline is an abort signal too.
					return fakeFailure({ kind: "aborted" }, [attempt]);
				},
			});
			const started = Date.now();
			const error = await rejection(
				k.call("Extract", ["note"], {
					signal: controller.signal,
					...(c.timeoutMs !== undefined && { timeoutMs: c.timeoutMs }),
				}),
				KernelCallError,
			);
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(error.failure).toEqual({ kind: c.expected } as CallFailure);
			const runId = runIdOf(k);
			const run = await getAgentRun(k.temp.db, runId);
			expect(run?.status).toBe("aborted");
			expect((await getPiAgentSession(k.temp.db, run!.piSessionId))?.status).toBe("error");
			expect(await callEnd(k.temp.db, runId)).toMatchObject({ status: "aborted", error: { kind: c.expected } });
			const start = await callStart(k.temp.db, runId);
			const budget = c.timeoutMs ?? 120_000;
			expect(Date.parse(start.eventData.deadline_at) - Date.parse(start.timestamp)).toBe(budget);
			await expectDoctorOk(k.temp.db);
		});
	}

	test("a route failure is recorded and thrown as KernelCallError(route) without invoking the engine", async () => {
		const k = await kit();
		const error = await rejection(k.call("Extract", ["note"], { model: "fake/missing-model" }), KernelCallError);
		expect(error.failure).toEqual({ kind: "route", message: ROUTE_FAILURE_MESSAGES["unknown-model"] });
		expect(k.engine.invocations).toHaveLength(0);
		const run = await getAgentRun(k.temp.db, error.runId);
		expect(run?.status).toBe("error");
		expect((await callStart(k.temp.db, error.runId)).eventData).toMatchObject({ model: "fake/missing-model", provider: "fake" });
		expect(await callEnd(k.temp.db, error.runId)).toMatchObject({
			status: "error",
			attempts: 0,
			error: { kind: "route", message: ROUTE_FAILURE_MESSAGES["unknown-model"] },
		});
		await expectDoctorOk(k.temp.db);
	});

	test("usage across attempts rolls up, priced by the served provider/id (doctor invariant 8 ok)", async () => {
		const k = await kit({
			models: { prices: { "fake/fake-model-0601": { inputPerMTok: 2, outputPerMTok: 8 } } },
			respond() {
				const t0 = Date.now() + 5;
				return fakeOk(VALUE, [
					fakeAttempt({ startedAtMs: t0, selected: false, status: 500, model: "fake-model-0601", usage: { inputTokens: 100, outputTokens: 20 } }),
					fakeAttempt({
						startedAtMs: t0 + 40,
						model: "fake-model-0601",
						usage: { inputTokens: 110, outputTokens: 25, cacheReadTokens: 10 },
					}),
				]);
			},
		});
		await k.call("Extract", ["note"]);
		const runId = runIdOf(k);
		const cost = (210 * 2 + 45 * 8) / 1_000_000;
		const turns = (await eventsOf(k.temp.db, runId, "pi_turn_end")).map((e) => (e.eventData as PiTurnEndData).usage);
		expect(turns.map((u) => u?.model)).toEqual(["fake/fake-model-0601", "fake/fake-model-0601"]);
		expect(turns[0]?.costEstimate).toBeCloseTo((100 * 2 + 20 * 8) / 1_000_000, 12);
		const end = await callEnd(k.temp.db, runId);
		expect(end.resolved_model).toBe("fake/fake-model-0601");
		expect(end.usage).toMatchObject({ inputTokens: 210, outputTokens: 45, cacheReadTokens: 10, model: "fake/fake-model-0601" });
		expect(end.usage?.costEstimate).toBeCloseTo(cost, 12);
		const run = await getAgentRun(k.temp.db, runId);
		expect([run?.usageInputTokens, run?.usageOutputTokens, run?.usageCacheRead]).toEqual([210, 45, 10]);
		expect(run?.usageCostEstimate).toBeCloseTo(cost, 12);
		await expectDoctorOk(k.temp.db);
	});

	test("requestId replay returns the stored value without invoking the engine", async () => {
		const k = await kit({ respond: (_req, index) => fakeOk({ kept: [`answer-${index}`], reason: "r" }) });
		const first = await k.call("Extract", ["note"], { requestId: "extract-1" });
		const second = await k.call("Extract", ["note"], { requestId: "extract-1" });
		expect(first).toEqual({ kept: ["answer-0"], reason: "r" });
		expect(second).toEqual(first);
		expect(k.engine.invocations).toHaveLength(1);
		expect(countRows(k.temp.db, "agent_runs")).toBe(1);
		await expectDoctorOk(k.temp.db);
	});

	test("a completion write failure surfaces row-write-failed carrying the call's value", async () => {
		const k: CallKit = await kit({
			respond() {
				// The process loses its database between the engine and the completion write.
				k.temp.handle.close();
				return fakeOk(VALUE);
			},
		});
		const error = await rejection(k.call("Extract", ["note"]), KernelNodeError);
		expect(error.code).toBe("row-write-failed");
		expect(error.value).toEqual(VALUE);
	});

	test("the model resolves opts.model, then the manifest, then models.defaults.call, each through aliases", async () => {
		const cases = [
			{ opts: { model: "opt-alias" }, expected: "opt-alias" },
			{ opts: {}, expected: "manifest-alias" },
		];
		const aliased = await kit({
			models: {
				aliases: { "opt-alias": FAKE_CALL_MODEL_REF, "manifest-alias": FAKE_CALL_MODEL_REF, "default-alias": FAKE_CALL_MODEL_REF },
				defaults: { call: "default-alias" },
			},
			manifests: { Extract: { $schema: "agent-kernel/call-v1", name: "Extract", description: "d", model: "manifest-alias" } },
		});
		for (const [index, c] of cases.entries()) {
			await aliased.call("Extract", ["note"], c.opts);
			expect((await callStart(aliased.temp.db, runIdOf(aliased, index))).eventData).toMatchObject({
				model: FAKE_CALL_MODEL_REF,
				model_alias: c.expected,
			});
		}
		await aliased.call("Summarize", ["text", 3]);
		expect((await callStart(aliased.temp.db, runIdOf(aliased, 2))).eventData).toMatchObject({
			model: FAKE_CALL_MODEL_REF,
			model_alias: "default-alias",
		});
		expect(aliased.engine.invocations.map((req) => req.route.modelRef)).toEqual(Array(3).fill(FAKE_CALL_MODEL_REF));
	});

	test("invalid requests throw KernelNodeError before any row", async () => {
		const engine = createFakeCallEngine<TestClient>({ functions: ["Extract"], respond: () => fakeOk(VALUE) });
		const withDefault = await createTempKernel<TestClient>({ calls: { engine }, models: { defaults: { call: FAKE_CALL_MODEL_REF } } });
		const withoutModel = await createTempKernel<TestClient>({ calls: { engine } });
		try {
			const cases: Array<{ name: string; code: KernelNodeError["code"]; run: () => Promise<unknown> }> = [
				{ name: "unknown function", code: "unknown-function", run: () => withDefault.kernel.call("Summarize", ["t", 1]) },
				{ name: "no model", code: "invalid-request", run: () => withoutModel.kernel.call("Extract", ["n"]) },
				{ name: "zero timeout", code: "invalid-request", run: () => withDefault.kernel.call("Extract", ["n"], { timeoutMs: 0 }) },
				{
					name: "unknown parent run",
					code: "unknown-parent-run",
					run: () => withDefault.kernel.call("Extract", ["n"], { parentRunId: "no-such-run" }),
				},
			];
			for (const c of cases) {
				const error = await rejection(c.run(), KernelNodeError);
				expect({ name: c.name, code: error.code }).toEqual({ name: c.name, code: c.code });
			}
			for (const { tempDb } of [withDefault, withoutModel]) {
				for (const table of ["pi_agent_sessions", "agent_runs", "trace_events", "trace_blobs"]) {
					expect({ table, rows: countRows(tempDb.db, table) }).toEqual({ table, rows: 0 });
				}
			}
			expect(engine.invocations).toHaveLength(0);
		} finally {
			withDefault.cleanup();
			withoutModel.cleanup();
		}
	});

	test("a Pi-transport engine sends through the route's model with the bound reasoning; its request is traced", async () => {
		const seen: Array<{ authorization: string | null; body: Record<string, unknown> }> = [];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			seen.push({
				authorization: new Headers(init?.headers).get("authorization"),
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			});
			return responsesStream(JSON.stringify(VALUE));
		}) as unknown as typeof fetch;
		const k = await kit({
			transport: "pi",
			async respond(req) {
				const out = await req.transport.complete({
					systemPrompt: "Extract kept advisories.",
					messages: [{ role: "user", text: "Checkpoint note" }],
				});
				if (out.text === null) return fakeFailure({ kind: "other", message: out.errorMessage ?? "no text" }, [out.attempt]);
				return { ok: true, value: JSON.parse(out.text) as unknown, attempts: [out.attempt], rawText: out.text };
			},
		});
		expect(await k.call("Extract", ["Checkpoint note"], { reasoning: "high" })).toEqual(VALUE);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.authorization).toBe(`Bearer ${k.pi.apiKey}`);
		expect(seen[0]?.body).toMatchObject({ model: "fake-model", reasoning: { effort: "high" } });

		const runId = runIdOf(k);
		const [snapshot] = await eventsOf(k.temp.db, runId, "pi_request_snapshot");
		const data = snapshot!.eventData as PiRequestSnapshotData;
		expect(data.request_kind).toBe("pi-transport");
		expect((await readBlob(k.temp.db, data.system_prompt_blob_hash)).text).toBe("Extract kept advisories.");
		expect(data.message_refs.map((ref) => ref.role)).toEqual(["user"]);
		const raw = JSON.parse((await readBlob(k.temp.db, data.raw_request_blob_hash)).text) as {
			headers: Record<string, string>;
		};
		expect(raw.headers.authorization).toBe("<redacted>");
		const [turnEnd] = await eventsOf(k.temp.db, runId, "pi_turn_end");
		expect(turnEnd!.eventData).toMatchObject({
			http_status: 200,
			reasoning_tokens: 3,
			// Pi reports cached input separately: 12 input tokens, 2 of them cached.
			usage: { inputTokens: 10, cacheReadTokens: 2, outputTokens: 5, model: FAKE_CALL_MODEL_REF },
		});
		await expectDoctorOk(k.temp.db);
	});

	test("call logs carry ids, names and kinds only, never args, outputs or raw text", async () => {
		const logs: unknown[] = [];
		const capture = (message: string, data?: Record<string, unknown>) => logs.push({ message, data });
		const logger: ModelNodeLogger = { debug: capture, info: capture, warn: capture, error: capture };
		const k = await kit({
			logger,
			respond: (_req, index) =>
				index === 0
					? fakeOk({ kept: ["OUTPUT-SENTINEL"], reason: "r" })
					: fakeFailure({ kind: "parse", message: "Failed to coerce PROMPT-SENTINEL", rawOutput: "RAW-SENTINEL" }),
		});
		await k.call("Extract", ["ARGS-SENTINEL"]);
		const error = await rejection(k.call("Extract", ["ARGS-SENTINEL"]), KernelCallError);
		expect(error.message).not.toContain("SENTINEL");
		expect(logs.length).toBeGreaterThan(0);
		const text = JSON.stringify(logs);
		for (const sentinel of ["ARGS-SENTINEL", "OUTPUT-SENTINEL", "PROMPT-SENTINEL", "RAW-SENTINEL"]) {
			expect(text).not.toContain(sentinel);
		}
	});
});
