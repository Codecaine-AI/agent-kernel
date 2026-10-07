/**
 * `kernel.gate` (plan §3.6, §4.4, §4.6) through a real kernel over a temp
 * database: the verdict rule, cancellation, check spans under the gate,
 * stopOn, decide checks through the kernel's own decide (a scripted
 * DecisionEngine stands in for Pi), rejections and write failures on either
 * side of the check loop, and requestId determinism. Insert failures are
 * injected with SQLite triggers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getAgentRun, updateAgentRunStatus } from "@agent-kernel/db";
import { kernelNodeEventId, kernelRequestId, type GateCheckRecord } from "@agent-kernel/protocol";

import { createKernel } from "../../index";
import { runTraceDoctor } from "../../doctor";
import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import {
	KernelDecideValidationError,
	KernelGateError,
	KernelNodeError,
	type BoolQuestion,
	type DecisionEngine,
	type EngineRequest,
	type EngineResult,
	type GateCheckSpec,
	type GateStepOutcome,
} from "../types";
import {
	capturingLogger,
	countRows,
	eventsOfType,
	expectDoctorOk,
	expectNodeError,
	failInsertsOf,
	spanEvents,
	type LogEntry,
} from "./__fixtures__/spans";

let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
});
afterAll(() => {
	restoreFetch();
});

const JUDGE_MODEL = "fake/judge";

/** A DecisionEngine answering each bool question with a scripted p(true); counts its calls. */
function scriptedEngine(probabilities: Record<string, number> = {}): DecisionEngine & { calls: number } {
	const engine = {
		calls: 0,
		async classify(request: EngineRequest): Promise<EngineResult> {
			engine.calls++;
			return answered(request, probabilities);
		},
	};
	return engine;
}

function answered(request: EngineRequest, probabilities: Record<string, number>): EngineResult {
	return {
		ok: true,
		engine: "pi-ai",
		api: "fake-classifier",
		provider: "fake",
		requestedModel: request.model,
		resolvedModel: request.model,
		answers: Object.fromEntries(
			Object.keys(request.questions).map((id) => [id, { type: "bool" as const, probability: probabilities[id] ?? 0.99 }]),
		),
		usage: { inputTokens: 40, outputTokens: 1 },
		latencyMs: 1,
		attempts: 1,
		startedAtMs: Date.now(),
		secrets: [],
	};
}

function boolQuestion(overrides: Partial<BoolQuestion> = {}): BoolQuestion {
	return { type: "bool", instructions: "Is the cast justified?", criteria: { true: "justified", false: "unjustified" }, ...overrides };
}

let temp: TempKernel;
let logs: LogEntry[];
let engine: ReturnType<typeof scriptedEngine>;
beforeEach(async () => {
	const captured = capturingLogger();
	logs = captured.entries;
	engine = scriptedEngine({ cast_ok: 0.97, locals_ok: 0.5 });
	temp = await createTempKernel({
		logger: captured.logger,
		decide: { engine },
		models: { defaults: { decide: JUDGE_MODEL } },
	});
});
afterEach(() => {
	temp.cleanup();
});

function stepCheck(name: string, run: () => GateStepOutcome | Promise<GateStepOutcome>): GateCheckSpec {
	return { kind: "step", name, run };
}

/** A parent run that already ended normally, so the doctor requires every span to be closed. */
async function doneParentRun(): Promise<string> {
	const parent = await temp.tempDb.seedParentRun();
	await updateAgentRunStatus(temp.tempDb.db, parent.runId, "done", { endedAt: new Date().toISOString() });
	return parent.runId;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error("expected a rejection");
		},
		(error: unknown) => error,
	);
}

function gateEnd(spanId: string) {
	return spanEvents(temp.tempDb.db, spanId).find((e) => e.type === "gate_end");
}

describe("kernel.gate", () => {
	test("gate verdict table", async () => {
		const { containerId } = temp.tempDb;
		const as = { pass: true, fail: false, abstain: { result: "abstain" } } as const;
		const table: Array<[Array<keyof typeof as>, "pass" | "fail" | "abstain"]> = [
			[["pass"], "pass"],
			[["fail"], "fail"],
			[["abstain"], "abstain"],
			[["pass", "pass"], "pass"],
			[["pass", "fail"], "fail"],
			[["pass", "abstain"], "abstain"],
			[["abstain", "fail"], "fail"],
			[["fail", "abstain", "pass"], "fail"],
		];
		for (const [results, expected] of table) {
			const checks = results.map((r, i) => stepCheck(`c${i}`, () => as[r]));
			const result = await temp.kernel.gate("table", { containerId }, checks);
			expect({ results, verdict: result.verdict }).toEqual({ results, verdict: expected });
			expect(result.aborted).toBe(false);
			expect(result.checks.map((c) => c.result)).toEqual(results);
			const end = gateEnd(result.spanId)!;
			expect(end.eventData.verdict).toBe(expected);
			expect((end.eventData.checks as GateCheckRecord[]).map((c) => c.result)).toEqual(results);
		}
	});

	test("a pre-aborted gate abstains and runs no check", async () => {
		const parentRunId = await doneParentRun();
		const controller = new AbortController();
		controller.abort();
		let callbacks = 0;
		const result = await temp.kernel.gate("pre-aborted", { parentRunId, signal: controller.signal }, [
			stepCheck("a", () => {
				callbacks++;
				return true;
			}),
			{ kind: "decide", name: "judge", state: { text: "cast" }, questions: { cast_ok: boolQuestion() } },
		]);
		expect(result).toMatchObject({ verdict: "abstain", aborted: true });
		expect(result.checks.map((c) => c.result)).toEqual(["skipped", "skipped"]);
		expect(callbacks).toBe(0);
		expect(engine.calls).toBe(0);
		expect(eventsOfType(temp.tempDb.db, "step_start")).toEqual([]);
		expect(eventsOfType(temp.tempDb.db, "call_start")).toEqual([]);
		expect(gateEnd(result.spanId)?.eventData).toMatchObject({ verdict: "abstain", aborted: true });
		await expectDoctorOk(temp.tempDb.db);
	});

	test("cancellation after a passing check abstains, never passes", async () => {
		const { containerId } = temp.tempDb;
		const controller = new AbortController();
		let secondRan = false;
		const result = await temp.kernel.gate("cancelled", { containerId, signal: controller.signal }, [
			stepCheck("first", () => {
				controller.abort();
				return true;
			}),
			stepCheck("second", () => {
				secondRan = true;
				return true;
			}),
		]);
		expect(result.verdict).toBe("abstain");
		expect(result.aborted).toBe(true);
		expect(result.checks.map((c) => c.result)).toEqual(["pass", "skipped"]);
		expect(secondRan).toBe(false);

		// Even when every check ran and passed, a fired signal never yields pass.
		const late = new AbortController();
		const allRan = await temp.kernel.gate("cancelled-late", { containerId, signal: late.signal }, [
			stepCheck("only", () => {
				late.abort();
				return true;
			}),
		]);
		expect(allRan).toMatchObject({ verdict: "abstain", aborted: true });
		expect(gateEnd(allRan.spanId)?.eventData).toMatchObject({ verdict: "abstain", aborted: true });
	});

	test("gate checks carry gate_span_id and parentEventId of gate_start", async () => {
		const parentRunId = await doneParentRun();
		const result = await temp.kernel.gate("nesting", { parentRunId }, [
			{ kind: "step", name: "objdiff", attributes: { unit: "fn_1" }, run: () => ({ result: "pass", value: 97.4 }) },
			{ kind: "decide", name: "judge", state: { text: "cast" }, questions: { cast_ok: boolQuestion() } },
		]);
		expect(result.verdict).toBe("pass");
		const gateEvents = spanEvents(temp.tempDb.db, result.spanId);
		expect(gateEvents.map((e) => e.type)).toEqual(["gate_start", "gate_end"]);
		const [start, end] = gateEvents;
		expect(start!.eventId).toBe(kernelNodeEventId(`span:${result.spanId}`, 0, "gate_start"));
		for (const e of gateEvents) {
			expect(e).toMatchObject({ runId: parentRunId, piSessionId: null, parentEventId: null });
			expect(e.eventData).toMatchObject({ gate_name: "nesting", run_id: parentRunId });
		}
		expect(start!.eventData.checks).toEqual([
			{ name: "objdiff", kind: "step" },
			{ name: "judge", kind: "decide" },
		]);

		// The decide check is a decision node of its own run, stamped with the gate span.
		const decisionRunId = result.checks[1]!.questions![0]!.runId;
		const decisionEvents = eventsOfType(temp.tempDb.db, "call_start")
			.concat(eventsOfType(temp.tempDb.db, "decision_made"), eventsOfType(temp.tempDb.db, "call_end"))
			.filter((e) => e.runId === decisionRunId);
		expect(decisionEvents.map((e) => e.type).sort()).toEqual(["call_end", "call_start", "decision_made"]);
		for (const e of decisionEvents) expect(e.eventData.gate_span_id).toBe(result.spanId);
		expect(decisionEvents.find((e) => e.type === "call_start")?.eventData.parent_run_id).toBe(parentRunId);

		const record = (end!.eventData.checks as GateCheckRecord[])[0]!;
		expect(record).toMatchObject({ name: "objdiff", kind: "step", result: "pass", value: 97.4 });
		const stepEvents = spanEvents(temp.tempDb.db, record.step_span_id!);
		expect(stepEvents.map((e) => e.type)).toEqual(["step_start", "step_end"]);
		for (const e of stepEvents) {
			expect(e).toMatchObject({ runId: parentRunId, piSessionId: null, parentEventId: start!.eventId });
			expect(e.eventData.gate_span_id).toBe(result.spanId);
		}
		expect(stepEvents[0]!.eventData.attributes).toEqual({ unit: "fn_1" });
		expect(stepEvents[1]!.eventData).toMatchObject({ status: "ok", check_result: "pass", check_value: 97.4 });
		// Events sort inside the gate: gate_start < step pair < decision pair < gate_end.
		const decisionStart = decisionEvents.find((e) => e.type === "call_start")!;
		const decisionEnd = decisionEvents.find((e) => e.type === "call_end")!;
		const order = [start!, ...stepEvents, decisionStart, decisionEnd, end!].map((e) => Date.parse(e.timestamp));
		for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
		await expectDoctorOk(temp.tempDb.db);
	});

	test("stopOn fail marks the rest skipped; the verdict is fail", async () => {
		const { containerId } = temp.tempDb;
		let thirdRan = false;
		const result = await temp.kernel.gate("stop", { containerId, stopOn: "fail" }, [
			stepCheck("one", () => true),
			stepCheck("two", () => ({ result: "fail", reason: "objdiff below 100%" })),
			stepCheck("three", () => {
				thirdRan = true;
				return true;
			}),
		]);
		expect(result.verdict).toBe("fail");
		expect(result.aborted).toBe(false);
		expect(result.checks).toEqual([
			{ name: "one", kind: "step", result: "pass" },
			{ name: "two", kind: "step", result: "fail", reason: "objdiff below 100%" },
			{ name: "three", kind: "step", result: "skipped" },
		]);
		expect(thirdRan).toBe(false);
		const records = gateEnd(result.spanId)!.eventData.checks as GateCheckRecord[];
		expect(records[2]).toEqual({ name: "three", kind: "step", result: "skipped" });
	});

	test("a thrown step check fails the gate and records the error", async () => {
		const { containerId } = temp.tempDb;
		let laterRan = false;
		const result = await temp.kernel.gate("thrown", { containerId }, [
			stepCheck("crashes", () => {
				throw new Error("objdiff crashed");
			}),
			stepCheck("later", () => {
				laterRan = true;
				return true;
			}),
		]);
		expect(result.verdict).toBe("fail");
		expect(result.checks).toEqual([
			{ name: "crashes", kind: "step", result: "fail", error: "objdiff crashed" },
			{ name: "later", kind: "step", result: "pass" },
		]);
		expect(laterRan).toBe(true);
		const record = (gateEnd(result.spanId)!.eventData.checks as GateCheckRecord[])[0]!;
		expect(record).toMatchObject({ result: "fail", error: "objdiff crashed" });
		const stepEnd = spanEvents(temp.tempDb.db, record.step_span_id!).find((e) => e.type === "step_end");
		expect(stepEnd?.eventData).toMatchObject({ status: "error", error_message: "objdiff crashed", check_result: "fail" });
	});

	test("gate_start write failure rejects before any check runs", async () => {
		const { db, containerId } = temp.tempDb;
		failInsertsOf(db, "gate_start");
		let callbacks = 0;
		const error = await expectNodeError(
			temp.kernel.gate("unwritable", { containerId }, [
				stepCheck("a", () => {
					callbacks++;
					return true;
				}),
				{ kind: "decide", name: "judge", state: { text: "cast" }, questions: { cast_ok: boolQuestion() } },
			]),
			"row-write-failed",
		);
		expect(error.cause).toBeDefined();
		expect(callbacks).toBe(0);
		expect(engine.calls).toBe(0);
		expect(countRows(db, "trace_events")).toBe(0);
		expect(logs.find((l) => l.message === "gate start write failed")?.data).toMatchObject({ gate: "unwritable" });
	});

	test("gate_end write failure rejects with row-write-failed", async () => {
		const { db } = temp.tempDb;
		const parentRunId = await doneParentRun();
		failInsertsOf(db, "gate_end");
		const error = await expectNodeError(
			temp.kernel.gate("unclosed", { parentRunId }, [stepCheck("a", () => true), stepCheck("b", () => true)]),
			"row-write-failed",
		);
		// The computed result travels with the error; the caller never gets an unpersisted pass.
		expect(error.gateResult).toMatchObject({ gateName: "unclosed", verdict: "pass", aborted: false });
		expect(eventsOfType(db, "gate_end")).toEqual([]);
		// The unpaired gate_start under a done run is what the doctor flags (invariant 10).
		const report = await runTraceDoctor(db);
		const [gateStart] = eventsOfType(db, "gate_start");
		expect(report.violations.find((v) => v.invariant === 10)?.sampleIds).toEqual([gateStart!.eventId]);
	});

	test("requestId gives deterministic span and event ids", async () => {
		const { db, containerId, kernelId } = temp.tempDb;
		let callbacks = 0;
		const gate = () =>
			temp.kernel.gate("idempotent", { containerId, requestId: "gate-1" }, [
				stepCheck("a", () => {
					callbacks++;
					return true;
				}),
				stepCheck("b", () => {
					callbacks++;
					return { result: "pass", value: "ok" };
				}),
			]);
		const first = await gate();
		const rows = countRows(db, "trace_events");
		expect(rows).toBe(6); // gate pair + two step pairs
		const second = await gate();
		expect(first.spanId).toBe(kernelRequestId(kernelId, "span", "gate-1"));
		expect(second.spanId).toBe(first.spanId);
		expect(countRows(db, "trace_events")).toBe(rows);
		// The checks still run on every call; only the events dedupe.
		expect(callbacks).toBe(4);
	});
});

describe("kernel.gate validation", () => {
	test("gate decide check rejects a choice question", async () => {
		const { db, containerId } = temp.tempDb;
		let stepRan = false;
		const checks = [
			stepCheck("first", () => {
				stepRan = true;
				return true;
			}),
			{
				kind: "decide",
				name: "judge",
				state: { text: "x" },
				questions: {
					pick: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
				},
			},
		] as unknown as GateCheckSpec[];
		const rejected = await rejectionOf(temp.kernel.gate("typed", { containerId }, checks));
		expect(rejected).toBeInstanceOf(KernelDecideValidationError);
		expect((rejected as KernelDecideValidationError).issues).toEqual([
			'check "judge" question "pick": gate decide checks take bool questions only',
		]);
		expect(stepRan).toBe(false);
		expect(countRows(db, "trace_events")).toBe(0);
	});

	test("invalid decide-check questions are rejected before gate_start", async () => {
		const { db, containerId } = temp.tempDb;
		const rejected = await rejectionOf(
			temp.kernel.gate("invalid", { containerId }, [
				stepCheck("first", () => true),
				{
					kind: "decide",
					name: "judge",
					state: { text: "cast" },
					questions: {
						empty: boolQuestion({ instructions: "" }),
						// Inverted against the default failAt 0.15 once merged (§4.3 effective thresholds).
						inverted: boolQuestion({ passAt: 0.1 }),
					},
				},
			]),
		);
		expect(rejected).toBeInstanceOf(KernelDecideValidationError);
		const issues = (rejected as KernelDecideValidationError).issues;
		expect(issues.some((i) => i.includes("empty"))).toBe(true);
		expect(issues.some((i) => i.includes("inverted"))).toBe(true);
		for (const issue of issues) expect(issue.startsWith('check "judge"')).toBe(true);
		expect(countRows(db, "trace_events")).toBe(0);
		expect(engine.calls).toBe(0);
	});
});

describe("kernel.gate decide checks", () => {
	test("gate_end lists decision run ids, probabilities and thresholds", async () => {
		const { db } = temp.tempDb;
		const parentRunId = await doneParentRun();
		const result = await temp.kernel.gate("adjudicate", { parentRunId }, [
			{
				kind: "decide",
				name: "judge",
				state: { finding: "type_erasing_cast" },
				questions: { cast_ok: boolQuestion(), locals_ok: boolQuestion({ passAt: 0.6, failAt: 0.4 }) },
			},
		]);
		const [decisionStart] = eventsOfType(db, "call_start");
		const runId = decisionStart!.runId!;
		expect(decisionStart!.eventData).toMatchObject({ node_kind: "decision", gate_span_id: result.spanId });
		expect(result.verdict).toBe("abstain");
		expect(result.checks).toEqual([
			{
				name: "judge",
				kind: "decide",
				result: "abstain",
				questions: [
					{ questionId: "cast_ok", result: "pass", runId, probability: 0.97, thresholdApplied: { passAt: 0.85, failAt: 0.15 } },
					{
						questionId: "locals_ok",
						result: "abstain",
						runId,
						probability: 0.5,
						thresholdApplied: { passAt: 0.6, failAt: 0.4 },
						abstainReason: "low-confidence",
					},
				],
			},
		]);
		expect(gateEnd(result.spanId)!.eventData.checks).toEqual([
			{
				name: "judge",
				kind: "decide",
				result: "abstain",
				questions: [
					{ question_id: "cast_ok", result: "pass", run_id: runId, probability: 0.97, pass_at: 0.85, fail_at: 0.15 },
					{
						question_id: "locals_ok",
						result: "abstain",
						run_id: runId,
						probability: 0.5,
						pass_at: 0.6,
						fail_at: 0.4,
						abstain_reason: "low-confidence",
					},
				],
			},
		]);
		await expectDoctorOk(db);
	});

	test("a gate requestId makes its decide checks replay on a re-run", async () => {
		const { db, kernelId } = temp.tempDb;
		const parentRunId = await doneParentRun();
		const gate = () =>
			temp.kernel.gate("checkpoint", { parentRunId, requestId: "checkpoint-7" }, [
				{ kind: "decide", name: "judge", state: { text: "cast" }, questions: { cast_ok: boolQuestion() } },
				{
					kind: "decide",
					name: "own-key",
					state: { text: "locals" },
					questions: { locals_ok: boolQuestion({ passAt: 0.6, failAt: 0.4 }) },
					requestId: "locals-key",
				},
			]);
		const first = await gate();
		expect(engine.calls).toBe(2);
		const rows = countRows(db, "trace_events");

		const second = await gate();
		expect(engine.calls).toBe(2);
		expect(second.checks).toEqual(first.checks);
		expect(second.verdict).toBe(first.verdict);
		expect(countRows(db, "trace_events")).toBe(rows);

		// Derived key `${gateRequestId}:check:${name}`; a check's own requestId wins.
		const sessions = eventsOfType(db, "call_start").map((e) => e.piSessionId).sort();
		expect(sessions).toEqual(
			[
				kernelRequestId(kernelId, "session", "checkpoint-7:check:judge"),
				kernelRequestId(kernelId, "session", "locals-key"),
			].sort(),
		);
		await expectDoctorOk(db);
	});

	test("decide check rejecting with in-flight-elsewhere closes the gate", async () => {
		const { db, kernelId } = temp.tempDb;
		const parentRunId = await doneParentRun();
		const questions = { cast_ok: boolQuestion() };
		// A second kernel instance on its own handle holds a fresh running attempt for the check's requestId.
		const entered = deferred();
		const release = deferred();
		const holder = createKernel({
			id: kernelId,
			db: temp.tempDb.openHandle().db,
			decide: {
				engine: {
					async classify(request) {
						entered.resolve();
						await release.promise;
						return answered(request, {});
					},
				},
			},
			models: { defaults: { decide: JUDGE_MODEL } },
			logger: { debug() {}, info() {}, warn() {}, error() {} },
		});
		const held = holder.decide("judge", { text: "cast" }, { questions, parentRunId, requestId: "judge-cast-1" });
		let laterRan = false;
		try {
			await entered.promise;
			const rejected = await rejectionOf(
				temp.kernel.gate("guarded", { parentRunId }, [
					stepCheck("first", () => true),
					{ kind: "decide", name: "judge", state: { text: "cast" }, questions, requestId: "judge-cast-1" },
					stepCheck("later", () => {
						laterRan = true;
						return true;
					}),
				]),
			);
			expect(rejected).toBeInstanceOf(KernelGateError);
			const { gateResult, cause } = rejected as KernelGateError;
			expect(cause).toBeInstanceOf(KernelNodeError);
			expect((cause as KernelNodeError).code).toBe("in-flight-elsewhere");
			expect(gateResult.verdict).toBe("abstain");
			expect(gateResult.checks).toEqual([
				{ name: "first", kind: "step", result: "pass" },
				{ name: "judge", kind: "decide", result: "abstain", error: "in-flight-elsewhere" },
				{ name: "later", kind: "step", result: "skipped" },
			]);
			expect(laterRan).toBe(false);
			expect(engine.calls).toBe(0);
			const end = gateEnd(gateResult.spanId)!;
			expect(end.eventData.verdict).toBe("abstain");
			expect((end.eventData.checks as GateCheckRecord[]).map(({ name, result, error }) => ({ name, result, error }))).toEqual([
				{ name: "first", result: "pass", error: undefined },
				{ name: "judge", result: "abstain", error: "in-flight-elsewhere" },
				{ name: "later", result: "skipped", error: undefined },
			]);
		} finally {
			release.resolve();
			await held;
			holder.dispose();
		}
		await expectDoctorOk(db);
	});

	test("decide check failing its completion write closes the gate", async () => {
		const { db } = temp.tempDb;
		const parentRunId = await doneParentRun();
		failInsertsOf(db, "decision_made");
		const rejected = await rejectionOf(
			temp.kernel.gate("unrecorded", { parentRunId }, [
				{ kind: "decide", name: "judge", state: { text: "cast" }, questions: { cast_ok: boolQuestion() } },
				stepCheck("later", () => true),
			]),
		);
		expect(rejected).toBeInstanceOf(KernelGateError);
		const { gateResult, cause } = rejected as KernelGateError;
		expect((cause as KernelNodeError).code).toBe("row-write-failed");
		expect(engine.calls).toBe(1);
		expect(gateResult.checks).toEqual([
			{ name: "judge", kind: "decide", result: "abstain", error: "row-write-failed" },
			{ name: "later", kind: "step", result: "skipped" },
		]);
		expect(gateEnd(gateResult.spanId)!.eventData).toMatchObject({ verdict: "abstain" });

		// The decision run stays running (§4.6); the gate itself is closed, so the doctor is satisfied.
		const [decisionStart] = eventsOfType(db, "call_start");
		expect((await getAgentRun(db, decisionStart!.runId!))?.status).toBe("running");
		await expectDoctorOk(db);
	});
});
