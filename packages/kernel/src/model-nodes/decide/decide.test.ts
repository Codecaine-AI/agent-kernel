/**
 * `kernel.decide` end to end on a temp database (plan §3.5, §4.6, M2):
 * intent-first rows, the snapshot/turn/decision_made/call_end shape, pricing,
 * engine errors that resolve, replay, budget, logging hygiene, and recovery
 * of an abandoned attempt. Global fetch throws for the whole file.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
	getAgentRun,
	getPiAgentSession,
	getTraceBlob,
	getTraceEventsForRun,
	upsertContainer,
	type KernelDatabase,
} from "@agent-kernel/db";
import {
	kernelNodeEventId,
	type CallEndData,
	type CallStartData,
	type DecisionMadeData,
	type PiRequestSnapshotData,
	type PiTurnEndData,
} from "@agent-kernel/protocol";

import type { CreateKernelConfig } from "../../index";
import { createModelNodeContext, type ModelNodeLogger } from "../context";
import { createFakeClassifierRegistry, type FakeReply } from "../__fixtures__/fake-classifier";
import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import { KernelNodeError, type DecisionQuestion } from "../types";
import {
	answeringEngine,
	boolQ,
	choiceQ,
	countRows,
	expectDoctorOk,
	FAKE_REF,
	rowsContaining,
	scoreQ,
	scriptedEngine,
	SYSTEM_ONE_REPLY,
	typesafeRegistry,
	wire,
	wireFetch,
} from "./__fixtures__/decide-harness";
import { REQUEST_MISMATCH_MESSAGE } from "../node-run";
import { createDecide, decideInternal } from "./index";
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

async function kernel(config: Omit<CreateKernelConfig, "db" | "id"> = {}): Promise<TempKernel> {
	const temp = await createTempKernel({ models: { defaults: { decide: FAKE_REF } }, ...config });
	temps.push(temp);
	return temp;
}

async function blobJson(db: KernelDatabase, hash: string | undefined | null): Promise<unknown> {
	if (!hash) throw new Error("no blob hash");
	const blob = await getTraceBlob(db, hash);
	if (!blob) throw new Error(`blob ${hash} missing`);
	return JSON.parse(Buffer.from(blob.data).toString("utf8"));
}

const JUDGE: Record<string, DecisionQuestion> = { justified: boolQ() };

describe("kernel.decide", () => {
	test("decide is intent-first", async () => {
		let db: KernelDatabase | undefined;
		const seen: Record<string, unknown> = {};
		const engine = scriptedEngine(async () => {
			const [run] = db!.all<{ id: string; status: string; pi_session_id: string; inbound_event_id: string }>(
				sql`SELECT id, status, pi_session_id, inbound_event_id FROM agent_runs`,
			);
			const session = await getPiAgentSession(db!, run!.pi_session_id);
			const [start] = await getTraceEventsForRun(db!, run!.id, ["call_start"]);
			Object.assign(seen, {
				runStatus: run!.status,
				sessionKind: session?.kind,
				sessionStatus: session?.status,
				startType: start?.type,
				inboundIsStart: run!.inbound_event_id === start?.eventId,
			});
			return { answers: { justified: { type: "bool", probability: 0.9 } } };
		});
		const temp = await kernel({ decide: { engine } });
		db = temp.tempDb.db;
		let startedIds: unknown;
		const outcome = await temp.kernel.decide("intent", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
			onNodeStarted: (ids) => {
				startedIds = ids;
			},
		});
		expect(seen).toEqual({
			runStatus: "running",
			sessionKind: "decision",
			sessionStatus: "active",
			startType: "call_start",
			inboundIsStart: true,
		});
		expect(startedIds).toEqual(outcome.ids);
	});

	test("decide writes snapshot, turn, decision_made, call_end and closes rows", async () => {
		const { fetch } = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const parent = { runId: "" };
		const temp = await kernel({
			decide: { engine: createPiDecisionEngine({ models: await typesafeRegistry(), fetch }) },
			models: { aliases: { jev: "typesafe/jev-1.13.0" } },
		});
		Object.assign(parent, await temp.tempDb.seedParentRun());
		const questions = { justified: boolQ(), next_action: choiceQ(["accept", "revise", "escalate", "other"]), quality: scoreQ(4) };
		const outcome = await temp.kernel.decide("shape", "the cast keeps the ABI", {
			parentRunId: parent.runId,
			model: "jev",
			questions,
		});
		const db = temp.tempDb.db;
		const events = await getTraceEventsForRun(db, outcome.ids.runId);
		expect(events.map((e) => e.type)).toEqual([
			"call_start",
			"pi_turn_start",
			"pi_request_snapshot",
			"pi_turn_end",
			"decision_made",
			"call_end",
		]);
		const startId = kernelNodeEventId(outcome.ids.runId, 0, "call_start");
		expect(events[0]!.eventId).toBe(startId);
		for (const child of events.slice(1)) {
			expect(child.parentEventId).toBe(startId);
			expect(child.piSessionUuid).toBe(outcome.ids.sessionId);
		}
		const timestamps = events.map((e) => Date.parse(e.timestamp));
		for (let i = 1; i < timestamps.length; i++) expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]!);

		const start = events[0]!.eventData as CallStartData;
		expect(start).toMatchObject({
			node_kind: "decision",
			function_name: "shape",
			engine: "jev",
			model: "typesafe/jev-1.13.0",
			model_alias: "jev",
			provider: "typesafe",
			api: "typesafe-system-one",
			trigger: "judge",
			parent_run_id: parent.runId,
		});
		expect(start.prompt_hash).toMatch(/^dq1-[0-9a-f]{64}$/);
		// The claim commits a pending placeholder; the scrubbed context lands on call_end.
		expect(await blobJson(db, start.input_blob_hash)).toEqual({ pending: true });
		expect(await blobJson(db, (events[5]!.eventData as CallEndData).input_blob_hash)).toEqual({
			state: { text: "the cast keeps the ABI" },
			questions,
		});

		const snapshot = events[2]!.eventData as PiRequestSnapshotData;
		expect(snapshot).toMatchObject({ turn_number: 0, message_count: 1, request_kind: "classifier", prompt_hash: start.prompt_hash });
		expect(snapshot.message_refs[0]).toMatchObject({ role: "classifier_context", index: 0 });
		const message = (await blobJson(db, snapshot.message_refs[0]!.blob_hash)) as { role: string; content: Array<{ text: string }> };
		expect(message.role).toBe("classifier_context");
		expect(JSON.parse(message.content[0]!.text)).toEqual({ state: { text: "the cast keeps the ABI" }, questions });
		const rawRequest = (await blobJson(db, snapshot.raw_request_blob_hash)) as { model: string; questions: Record<string, { type: string }> };
		expect(rawRequest.model).toBe("jev-1.13.0");
		expect(rawRequest.questions.justified!.type).toBe("noul");

		const turnEnd = events[3]!.eventData as PiTurnEndData;
		expect(turnEnd.stop_reason).toBe("stop");
		expect(turnEnd.usage).toMatchObject({ inputTokens: 755, outputTokens: 80, model: "typesafe/jev-1.13.0" });
		expect(await blobJson(db, turnEnd.response_blob_hash)).toEqual(SYSTEM_ONE_REPLY);

		const made = events[4]!.eventData as DecisionMadeData;
		expect(made).toMatchObject({
			decision_name: "shape",
			chosen: "justified=true,next_action=accept,quality=3",
			abstained: false,
			confidence_source: "native",
			engine: "jev",
			provider: "typesafe",
			api: "typesafe-system-one",
			model: "typesafe/jev-1.13.0",
			requested_model: "typesafe/jev-1.13.0",
			threshold_applied: {
				justified: { passAt: 0.85, failAt: 0.15 },
				next_action: { minTop: 0.6, minMargin: 0.2 },
				quality: { abstainBelow: 0.5 },
			},
		});
		expect(made.answers).toEqual(outcome.answers);

		const end = events[5]!.eventData as CallEndData;
		expect(end).toMatchObject({ status: "ok", attempts: 1, resolved_model: "typesafe/jev-1.13.0" });
		expect(await blobJson(db, end.output_blob_hash)).toEqual(outcome.answers);

		const run = await getAgentRun(db, outcome.ids.runId);
		expect(run).toMatchObject({ status: "done", trigger: "judge", parentRunId: parent.runId, inboundEventId: startId });
		expect(run?.outboundEventId).toBe(kernelNodeEventId(outcome.ids.runId, 0, "call_end"));
		expect((await getPiAgentSession(db, outcome.ids.sessionId))?.status).toBe("ended");
		expect(outcome).toMatchObject({
			decisionName: "shape",
			chosen: "justified=true,next_action=accept,quality=3",
			abstained: false,
			engine: "jev",
			model: "typesafe/jev-1.13.0",
			requestedModel: "typesafe/jev-1.13.0",
			replayed: false,
			coalesced: false,
		});
		expect(outcome.ids.parentRunId).toBe(parent.runId);
		await expectDoctorOk(db);
	});

	test("Jev usage is priced from models.prices, not Pi's zero cost", async () => {
		const { fetch } = wireFetch(() => wire(SYSTEM_ONE_REPLY));
		const temp = await kernel({
			decide: { engine: createPiDecisionEngine({ models: await typesafeRegistry(), fetch }) },
			models: {
				defaults: { decide: "typesafe/jev-latest" },
				prices: { "typesafe/jev-1.13.0": { inputPerMTok: 0.042, outputPerMTok: 0 } },
			},
		});
		const outcome = await temp.kernel.decide("priced", { a: 1 }, { containerId: temp.tempDb.containerId, questions: JUDGE });
		expect(outcome.model).toBe("typesafe/jev-1.13.0");
		expect(outcome.requestedModel).toBe("typesafe/jev-latest");
		expect(outcome.usage?.costEstimate).toBeCloseTo((755 * 0.042) / 1e6, 15);
		const [end] = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId, ["call_end"]);
		expect((end!.eventData as CallEndData).usage?.costEstimate).toBeCloseTo((755 * 0.042) / 1e6, 15);
		const run = await getAgentRun(temp.tempDb.db, outcome.ids.runId);
		expect(run?.usageCostEstimate).toBeCloseTo((755 * 0.042) / 1e6, 15);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("engine error resolves, run status error, doctor ok", async () => {
		const engine = scriptedEngine(() => ({
			ok: false,
			answers: {},
			attempts: 1,
			error: { kind: "rate-limit", message: "System One API error (429): busy", httpStatus: 429 },
		}));
		const temp = await kernel({ decide: { engine } });
		const outcome = await temp.kernel.decide("busy", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: { a: boolQ(), b: choiceQ() },
		});
		expect(outcome).toMatchObject({
			abstained: true,
			abstainReason: "engine-error",
			confidenceSource: "none",
			chosen: "a=abstain,b=abstain",
			error: { kind: "rate-limit", httpStatus: 429 },
		});
		const db = temp.tempDb.db;
		expect((await getAgentRun(db, outcome.ids.runId))?.status).toBe("error");
		expect((await getPiAgentSession(db, outcome.ids.sessionId))?.status).toBe("error");
		const events = await getTraceEventsForRun(db, outcome.ids.runId);
		const end = events.find((e) => e.type === "call_end")!.eventData as CallEndData;
		expect(end).toMatchObject({ status: "error", error: { kind: "rate-limit", http_status: 429 } });
		const made = events.find((e) => e.type === "decision_made")!.eventData as DecisionMadeData;
		expect(made.error_kind).toBe("rate-limit");
		expect((events.find((e) => e.type === "pi_turn_end")!.eventData as PiTurnEndData).stop_reason).toBe("error");
		await expectDoctorOk(db);
	});

	test("engine error summaries carry no provider-derived numbers: numeric credentials never persist", async () => {
		const numericKey = "8675309142857";
		const numericToken = "5551234567890";
		for (const error of [
			{ kind: "timeout" as const, message: `Request timed out after ${numericKey}ms` },
			{
				kind: "rate-limit" as const,
				message: `Server requested ${numericToken}s retry delay (max: ${numericKey}s). returned 429`,
				httpStatus: 429,
			},
		]) {
			const engine = scriptedEngine(() => ({ ok: false, attempts: 1, error, secrets: [numericKey, numericToken] }));
			const temp = await kernel({ decide: { engine } });
			const outcome = await temp.kernel.decide("numeric", { a: 1 }, { containerId: temp.tempDb.containerId, questions: JUDGE });
			expect(outcome.error!.message).toBe(error.kind === "timeout" ? "decision request timed out" : "provider rate limit (HTTP 429)");
			for (const secret of [numericKey, numericToken]) {
				expect(JSON.stringify(outcome)).not.toContain(secret);
				expect(rowsContaining(temp.tempDb.db, secret)).toEqual([]);
			}
		}
	});

	test("credential-bearing question ids and option labels never persist, on the success and malformed paths", async () => {
		// A collected credential that is also a valid question id and an option label.
		const credential = "sk_live_4f9a8c7e2b1d6a3f";
		const questions = {
			[credential]: boolQ(),
			pick: choiceQ([credential, "other"]),
		};
		for (const [label, answers] of [
			[
				"success",
				{
					[credential]: { type: "bool" as const, probability: 0.97 },
					pick: { type: "choice" as const, choice: credential, distribution: { [credential]: 0.9, other: 0.1 }, confidence: 0.8 },
				},
			],
			[
				"malformed",
				{
					[credential]: { type: "bool" as const, probability: 1.5 },
					pick: { type: "choice" as const, choice: credential, distribution: { [credential]: 0.9, other: 0.1 }, confidence: 0.8 },
				},
			],
		] as const) {
			const engine = scriptedEngine(() => ({ answers, attempts: 1, secrets: [credential] }));
			const temp = await kernel({ decide: { engine } });
			const outcome = await temp.kernel.decide("ids", { a: 1 }, { containerId: temp.tempDb.containerId, questions });
			if (label === "success") expect(outcome.answers[credential]!.verdict).toBe("pass");
			else expect(outcome.error).toEqual({ kind: "malformed-answer", message: "malformed answers (1 of 2)" });
			expect(rowsContaining(temp.tempDb.db, credential), label).toEqual([]);
			const made = (await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId, ["decision_made"]))[0]!
				.eventData as DecisionMadeData;
			expect(Object.keys(made.threshold_applied).sort(), label).toEqual(["<redacted>", "pick"]);
		}
	});

	test("a __proto__ key in parsed JSON state is part of the request and of the stored context", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine } });
		const opts = { containerId: temp.tempDb.containerId, questions: JUDGE, requestId: "req-proto" };
		const first = JSON.parse('{"__proto__":{"a":1}}') as Record<string, never>;
		const changed = JSON.parse('{"__proto__":{"a":2}}') as Record<string, never>;
		const outcome = await temp.kernel.decide("proto", first, opts);
		// The state as sent and as stored keeps its own __proto__ key.
		expect(JSON.stringify(engine.requests[0]!.state)).toBe('{"__proto__":{"a":1}}');
		const [end] = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId, ["call_end"]);
		expect(await blobJson(temp.tempDb.db, (end!.eventData as CallEndData).input_blob_hash)).toMatchObject({
			state: JSON.parse('{"__proto__":{"a":1}}'),
		});
		const stored = (await getTraceBlob(temp.tempDb.db, (end!.eventData as CallEndData).input_blob_hash!))!;
		expect(Buffer.from(stored.data).toString("utf8")).toContain('"__proto__":{"a":1}');
		// A different __proto__ value is a different request; the same one replays.
		const rejected = await temp.kernel.decide("proto", changed, opts).then(
			() => undefined,
			(error: unknown) => error,
		);
		expect((rejected as KernelNodeError).code).toBe("invalid-request");
		const again = await temp.kernel.decide("proto", JSON.parse('{"__proto__":{"a":1}}') as Record<string, never>, opts);
		expect(again).toMatchObject({ replayed: true, ids: { runId: outcome.ids.runId } });
		expect(engine.requests).toHaveLength(1);
	});

	test("a refusal is an answer: abstain refusal, run done", async () => {
		// Through the Pi engine: the in-process provider refuses without any fetch.
		const { fake, registry } = await createFakeClassifierRegistry();
		fake.setScript(() => ({ error: "the model refused to classify this content" }));
		const temp = await kernel({ decide: { models: registry }, models: { defaults: { decide: fake.ref } } });
		const outcome = await temp.kernel.decide("refuse", { a: 1 }, { containerId: temp.tempDb.containerId, questions: JUDGE });
		expect(outcome).toMatchObject({ abstained: true, abstainReason: "refusal", chosen: "abstain", error: { kind: "refusal" } });
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("done");
		const events = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId);
		expect(events.map((e) => e.type)).toContain("pi_turn_end");
		expect((events.find((e) => e.type === "call_end")!.eventData as CallEndData)).toMatchObject({ status: "ok", attempts: 1 });
		// A done refusal replays like any answer.
		const again = await temp.kernel.decide("refuse", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
			requestId: "req-refusal",
		});
		const replayed = await temp.kernel.decide("refuse", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
			requestId: "req-refusal",
		});
		expect(replayed).toMatchObject({ replayed: true, abstainReason: "refusal", error: { kind: "refusal" } });
		expect(replayed.ids.runId).toBe(again.ids.runId);
		expect(fake.calls).toHaveLength(2);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("requestId replay returns the stored outcome without calling the engine", async () => {
		const engine = answeringEngine(
			{ justified: { type: "bool", probability: 0.1 } },
			{ usage: { inputTokens: 40, outputTokens: 2 } },
		);
		const temp = await kernel({ decide: { engine } });
		const opts = { containerId: temp.tempDb.containerId, questions: JUDGE, requestId: "req-replay" };
		const first = await temp.kernel.decide("replayed", { a: 1 }, opts);
		const second = await temp.kernel.decide("replayed", { a: 1 }, opts);
		expect(engine.requests).toHaveLength(1);
		expect(first.replayed).toBe(false);
		expect(second.replayed).toBe(true);
		const { replayed: _r, latencyMs: _l1, ...fresh } = first;
		const { replayed: _s, latencyMs: _l2, ...stored } = second;
		expect(stored).toEqual(fresh);
		expect(second.answers.justified.verdict).toBe("fail");
		expect(countRows(temp.tempDb.db, "agent_runs")).toBe(1);
	});

	test("a requestId reused for a different decision is rejected, not replayed", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 }, other: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine } });
		const parent = await temp.tempDb.seedParentRun();
		const base = { containerId: temp.tempDb.containerId, requestId: "req-reused" };
		const first = await temp.kernel.decide("first", { a: 1 }, { ...base, questions: JUDGE });
		/** The rejection, or undefined when the decision resolved. */
		const rejected = (promise: Promise<unknown>) =>
			promise.then(
				() => undefined,
				(error: unknown) => error,
			);
		const changes: Array<[string, Promise<unknown>]> = [
			["questions", temp.kernel.decide("first", { a: 1 }, { ...base, questions: { other: boolQ() } })],
			// Thresholds decide the verdict: a changed threshold is a different request.
			["thresholds", temp.kernel.decide("first", { a: 1 }, { ...base, questions: { justified: boolQ({ passAt: 0.95 }) } })],
			["state", temp.kernel.decide("first", { a: 2 }, { ...base, questions: JUDGE })],
			["model", temp.kernel.decide("first", { a: 1 }, { ...base, questions: JUDGE, model: "fake-decide/other" })],
			["scope", temp.kernel.decide("first", { a: 1 }, { ...base, questions: JUDGE, parentRunId: parent.runId })],
			["name", temp.kernel.decide("second", { a: 1 }, { ...base, questions: JUDGE })],
		];
		for (const [label, promise] of changes) {
			const error = await rejected(promise);
			expect(error, label).toBeInstanceOf(KernelNodeError);
			expect((error as KernelNodeError).code, label).toBe("invalid-request");
			expect((error as KernelNodeError).message, label).toBe(REQUEST_MISMATCH_MESSAGE);
		}
		// The identical request still replays; nothing above reached the engine or wrote a run.
		const again = await temp.kernel.decide("first", { a: 1 }, { ...base, questions: JUDGE });
		expect(again).toMatchObject({ replayed: true, ids: { runId: first.ids.runId } });
		// Where it is filed is not part of the request (a harness container can differ per job): it replays too.
		const elsewhere = await upsertContainer(temp.tempDb.db, {
			id: "second-container",
			kernelId: temp.tempDb.kernelId,
			kind: "test",
			appKey: ["second-container"],
			createdAt: new Date().toISOString(),
		});
		const filedElsewhere = await temp.kernel.decide("first", { a: 1 }, { ...base, containerId: elsewhere.id, questions: JUDGE });
		expect(filedElsewhere).toMatchObject({ replayed: true, ids: { runId: first.ids.runId } });
		expect(engine.requests).toHaveLength(1);
		expect(countRows(temp.tempDb.db, "agent_runs")).toBe(2); // the decision and the seeded parent
	});

	test("concurrent same-requestId decisions with different requests: one runs, the other is rejected", async () => {
		const release = { fn: () => {} };
		const held = new Promise<void>((resolve) => {
			release.fn = resolve;
		});
		const engine = scriptedEngine(async () => {
			await held;
			return { answers: { justified: { type: "bool", probability: 0.9 } } };
		});
		const temp = await kernel({ decide: { engine } });
		const base = { containerId: temp.tempDb.containerId, requestId: "req-concurrent" };
		const settle = (promise: Promise<unknown>) =>
			promise.then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
		// Same kernel: the second would coalesce onto the first; a different request must not.
		const a = settle(temp.kernel.decide("concurrent", { a: 1 }, { ...base, questions: JUDGE }));
		while (engine.requests.length === 0) await Bun.sleep(1);
		const sameKernel = await settle(temp.kernel.decide("concurrent", { a: 2 }, { ...base, questions: JUDGE }));
		// Another kernel instance on its own handle: the claim sees the running attempt of a different request.
		const other = createDecide(
			createModelNodeContext({
				kernelId: temp.tempDb.kernelId,
				db: temp.tempDb.openHandle().db,
				models: { defaults: { decide: FAKE_REF } },
				decide: { engine },
			}),
		);
		const otherKernel = await settle(other("concurrent", { a: 3 }, { ...base, questions: JUDGE }));
		release.fn();
		const winner = await a;
		for (const result of [sameKernel, otherKernel]) {
			expect("error" in result && (result.error as KernelNodeError).code).toBe("invalid-request");
		}
		expect("value" in winner && (winner.value as { answers: { justified: { verdict?: string } } }).answers.justified.verdict).toBe(
			"pass",
		);
		expect(engine.requests).toHaveLength(1);
		expect(countRows(temp.tempDb.db, "agent_runs")).toBe(1);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("a run written before request fingerprints still replays", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine } });
		const opts = { containerId: temp.tempDb.containerId, questions: JUDGE, requestId: "req-legacy" };
		const first = await temp.kernel.decide("legacy", { a: 1 }, opts);
		// Strip the fingerprint, as a database written before this change would have it.
		temp.tempDb.db.run(
			sql`UPDATE trace_events SET event_data = json_remove(event_data, '$.request_fingerprint') WHERE type = 'call_start'`,
		);
		const [start] = await getTraceEventsForRun(temp.tempDb.db, first.ids.runId, ["call_start"]);
		expect((start!.eventData as { request_fingerprint?: string }).request_fingerprint).toBeUndefined();
		const again = await temp.kernel.decide("legacy", { a: 1 }, opts);
		expect(again).toMatchObject({ replayed: true, ids: { runId: first.ids.runId } });
		expect(engine.requests).toHaveLength(1);
	});

	test("a late success after the caller aborted ends aborted, every answer abstained", async () => {
		const ac = new AbortController();
		// The engine ignores the signal and answers after the caller gave up.
		const engine = scriptedEngine(() => {
			ac.abort();
			return { answers: { justified: { type: "bool", probability: 0.95 } } };
		});
		const temp = await kernel({ decide: { engine } });
		const outcome = await temp.kernel.decide("late", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
			signal: ac.signal,
		});
		expect(outcome).toMatchObject({
			abstained: true,
			abstainReason: "engine-error",
			error: { kind: "aborted", message: "decision request aborted" },
		});
		expect(outcome.answers.justified.verdict).toBeUndefined();
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("aborted");
		const events = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId);
		expect((events.find((e) => e.type === "call_end")!.eventData as CallEndData).status).toBe("aborted");
		expect((events.find((e) => e.type === "pi_turn_end")!.eventData as PiTurnEndData).stop_reason).toBe("aborted");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("a late success after the operation deadline ends aborted with kind timeout", async () => {
		// Deadline 50 + 50 ms grace; the engine ignores the signal and answers well after it.
		const engine = scriptedEngine(async () => {
			await Bun.sleep(250);
			return { answers: { justified: { type: "bool", probability: 0.95 } } };
		});
		const temp = await kernel({ decide: { engine, timeoutMs: 50, maxRetries: 0 } });
		const outcome = await temp.kernel.decide("late-deadline", { a: 1 }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
		});
		expect(outcome).toMatchObject({
			abstained: true,
			error: { kind: "timeout", message: "decision operation deadline exceeded" },
		});
		expect(outcome.answers.justified.verdict).toBeUndefined();
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("aborted");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("a completed decision replays by requestId even when the signal is already aborted", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine } });
		const opts = { containerId: temp.tempDb.containerId, questions: JUDGE, requestId: "req-replay-aborted" };
		const first = await temp.kernel.decide("served", { a: 1 }, opts);
		const replay = await temp.kernel.decide("served", { a: 1 }, { ...opts, signal: AbortSignal.abort() });
		expect(replay).toMatchObject({
			replayed: true,
			model: first.model,
			answers: { justified: { verdict: "pass" } },
			ids: { runId: first.ids.runId },
		});
		expect(replay.error).toBeUndefined();
		expect(engine.requests).toHaveLength(1);
	});

	test("engine-reported timing is clamped into the run", async () => {
		for (const timing of [
			{ startedAtMs: 9e15, latencyMs: 1e12 },
			{ startedAtMs: 0, latencyMs: Number.NaN },
			{ startedAtMs: Number.NaN, latencyMs: -5 },
		]) {
			const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } }, timing);
			const temp = await kernel({ decide: { engine } });
			const outcome = await temp.kernel.decide("clock", { a: 1 }, { containerId: temp.tempDb.containerId, questions: JUDGE });
			const events = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId);
			expect(events.map((e) => e.type)).toEqual([
				"call_start",
				"pi_turn_start",
				"pi_request_snapshot",
				"pi_turn_end",
				"decision_made",
				"call_end",
			]);
			// Strictly increasing even for a zero or unknown latency: no two events share a timestamp.
			const stamps = events.map((e) => Date.parse(e.timestamp));
			for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]!);
			const start = stamps[0]!;
			const end = stamps[5]!;
			for (const event of events.slice(1, 4)) {
				expect(Date.parse(event.timestamp)).toBeGreaterThan(start);
				expect(Date.parse(event.timestamp)).toBeLessThan(end);
			}
			expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
			expect(outcome.latencyMs).toBeLessThan(60_000);
			await expectDoctorOk(temp.tempDb.db);
		}
	});

	test("over-budget state abstains too-large without calling the engine", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine, tokenBudgets: { "fake-decide/*": 100 } } });
		const outcome = await temp.kernel.decide("big", { text: "x".repeat(200) }, {
			containerId: temp.tempDb.containerId,
			questions: JUDGE,
		});
		expect(engine.requests).toHaveLength(0);
		expect(outcome.error?.kind).toBe("too-large");
		expect(outcome.answers.justified).toMatchObject({ abstained: true, abstainReason: "engine-error" });
		const events = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId);
		expect(events.map((e) => e.type)).toEqual(["call_start", "decision_made", "call_end"]);
		expect((events[1]!.eventData as DecisionMadeData).error_kind).toBe("too-large");
		// An exact provider/id budget wins over provider/*; within it the engine runs.
		const exact = await kernel({
			decide: { engine, tokenBudgets: { "fake-decide/*": 100, "fake-decide/fake-jev": 10_000 } },
		});
		await exact.kernel.decide("big", { text: "x".repeat(200) }, { containerId: exact.tempDb.containerId, questions: JUDGE });
		expect(engine.requests).toHaveLength(1);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("a kernel without a decision model resolves not-configured, fully traced, with no engine call", async () => {
		const engine = answeringEngine({});
		const temp = await kernel({ decide: { engine }, models: {} });
		const outcome = await temp.kernel.decide("unset", { a: 1 }, { containerId: temp.tempDb.containerId, questions: JUDGE });
		expect(engine.requests).toHaveLength(0);
		expect(outcome).toMatchObject({ abstained: true, abstainReason: "engine-error", error: { kind: "not-configured" } });
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("error");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("decide never logs state or instructions", async () => {
		const logs: string[] = [];
		const capture = (level: string) => (message: string, data?: Record<string, unknown>) =>
			logs.push(`${level} ${message} ${JSON.stringify(data ?? {})}`);
		const logger: ModelNodeLogger = {
			debug: capture("debug"),
			info: capture("info"),
			warn: capture("warn"),
			error: capture("error"),
		};
		const stateMarker = "STATE-MARKER-c0ffee";
		const instructionMarker = "INSTRUCTION-MARKER-beef";
		const questions = { q: boolQ({ instructions: `Decide ${instructionMarker}` }) };
		const temp = await kernel({
			logger,
			decide: {
				engine: scriptedEngine((request) =>
					request.state.n === 1
						? { answers: { q: { type: "bool", probability: 0.5 } } }
						: { ok: false, error: { kind: "provider", message: "provider failed" } },
				),
			},
		});
		const opts = { containerId: temp.tempDb.containerId, questions };
		await temp.kernel.decide("logged", { n: 1, marker: stateMarker }, opts);
		await temp.kernel.decide("logged", { n: 2, marker: stateMarker }, opts);
		await temp.kernel.decide("logged", stateMarker, { ...opts, requestId: "req-logged" });
		await temp.kernel.decide("logged", stateMarker, { ...opts, requestId: "req-logged" });
		expect(logs.length).toBeGreaterThan(0);
		const all = logs.join("\n");
		expect(all).not.toContain(stateMarker);
		expect(all).not.toContain(instructionMarker);
		expect(all).not.toContain("Decide ");
	});

	test("doctor is ok after a mixed batch", async () => {
		const { fake, registry } = await createFakeClassifierRegistry();
		let n = 0;
		fake.setScript((): FakeReply => {
			n++;
			if (n === 2) return { error: 'System One API error (500): {"detail":"boom"}' };
			if (n === 3) return { answers: { q: { type: "bool", probability: 0.5 } } }; // abstain
			if (n === 4) return { answers: {} }; // missing answer → malformed
			return { answers: { q: { type: "bool", probability: n === 1 ? 0.97 : 0.02 } }, usage: { input: 30, output: 1 } };
		});
		const temp = await kernel({ decide: { models: registry }, models: { defaults: { decide: fake.ref } } });
		const parent = await temp.tempDb.seedParentRun();
		const outcomes = [];
		for (let i = 0; i < 5; i++) {
			outcomes.push(await temp.kernel.decide(`batch-${i}`, { i }, { parentRunId: parent.runId, questions: { q: boolQ() } }));
		}
		expect(outcomes.map((o) => o.answers.q.verdict ?? o.answers.q.abstainReason)).toEqual([
			"pass",
			"engine-error",
			"low-confidence",
			"engine-error",
			"fail",
		]);
		expect(outcomes.map((o) => o.error?.kind)).toEqual([undefined, "provider", undefined, "malformed-answer", undefined]);
		expect(fake.calls).toHaveLength(5);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("decideInternal stamps gate_span_id on call_start, decision_made and call_end", async () => {
		const engine = answeringEngine({ justified: { type: "bool", probability: 0.9 } });
		const temp = await kernel({ decide: { engine } });
		const ctx = createModelNodeContext({
			kernelId: temp.tempDb.kernelId,
			db: temp.tempDb.db,
			models: { defaults: { decide: FAKE_REF } },
			decide: { engine },
		});
		const outcome = await decideInternal(
			ctx,
			"gate-check",
			{ a: 1 },
			{ containerId: temp.tempDb.containerId, questions: JUDGE },
			{ gateSpanId: "gate-span-1" },
		);
		const events = await getTraceEventsForRun(temp.tempDb.db, outcome.ids.runId, ["call_start", "decision_made", "call_end"]);
		expect(events.map((e) => (e.eventData as { gate_span_id?: string }).gate_span_id)).toEqual([
			"gate-span-1",
			"gate-span-1",
			"gate-span-1",
		]);
	});

	test("a late completion after recovery changes 0 rows and rolls back", async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = false;
		// Ignores its signal: it resolves only when the test releases it, after the takeover.
		const original = scriptedEngine(async () => {
			entered = true;
			await held;
			return { answers: { justified: { type: "bool", probability: 0.99 } } };
		});
		const temp = await kernel({ decide: { engine: original } });
		const opts = { containerId: temp.tempDb.containerId, questions: JUDGE, requestId: "req-late" };
		const first = temp.kernel.decide("late", { a: 1 }, opts).then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		while (!entered) await Bun.sleep(1);

		const [stuck] = await getTraceEventsForRun(temp.tempDb.db, runningRunId(temp.tempDb.db)!, ["call_start"]);
		const deadlineAtMs = Date.parse((stuck!.eventData as CallStartData).deadline_at);
		const takeover = answeringEngine({ justified: { type: "bool", probability: 0.02 } });
		const recover = createDecide(
			createModelNodeContext({
				kernelId: temp.tempDb.kernelId,
				db: temp.tempDb.openHandle().db,
				now: () => deadlineAtMs + 60_001,
				models: { defaults: { decide: FAKE_REF } },
				decide: { engine: takeover },
			}),
		);
		const recovered = await recover("late", { a: 1 }, opts);
		expect(recovered.answers.justified.verdict).toBe("fail");
		expect((await getAgentRun(temp.tempDb.db, stuck!.runId!))?.status).toBe("aborted");

		release();
		const late = await first;
		expect("error" in late).toBe(true);
		expect((late as { error: KernelNodeError }).error).toBeInstanceOf(KernelNodeError);
		expect((late as { error: KernelNodeError }).error.code).toBe("row-write-failed");
		// The abandoned attempt keeps only its call_start and the synthesized aborted call_end.
		const abandoned = await getTraceEventsForRun(temp.tempDb.db, stuck!.runId!);
		expect(abandoned.map((e) => e.type)).toEqual(["call_start", "call_end"]);
		expect((abandoned[1]!.eventData as CallEndData).status).toBe("aborted");
		expect((await getAgentRun(temp.tempDb.db, recovered.ids.runId))?.status).toBe("done");
		// The request now replays the takeover's outcome.
		const again = await recover("late", { a: 1 }, opts);
		expect(again).toMatchObject({ replayed: true, ids: { runId: recovered.ids.runId } });
		await expectDoctorOk(temp.tempDb.db);
	});
});

function runningRunId(db: KernelDatabase): string | undefined {
	const [row] = db.all<{ id: string }>(sql`SELECT id FROM agent_runs WHERE status = 'running'`);
	return row?.id;
}
