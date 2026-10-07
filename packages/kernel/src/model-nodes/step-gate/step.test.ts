/**
 * `kernel.step` (plan §3.6, §4.4, §4.6) through a real kernel over a temp
 * database: the span pair on the parent run, rethrow with status error, span
 * attributes/events/summary on step_end, and writes that never fail a step.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { updateAgentRunStatus } from "@agent-kernel/db";
import { kernelNodeEventId, kernelRequestId } from "@agent-kernel/protocol";

import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import {
	capturingLogger,
	countRows,
	expectDoctorOk,
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

let temp: TempKernel;
let logs: LogEntry[];
beforeEach(async () => {
	const captured = capturingLogger();
	logs = captured.entries;
	temp = await createTempKernel({ logger: captured.logger });
});
afterEach(() => {
	temp.cleanup();
});

describe("kernel.step", () => {
	test("step emits a span pair with run id and no pi session", async () => {
		const { db } = temp.tempDb;
		const parent = await temp.tempDb.seedParentRun();
		const before = { sessions: countRows(db, "pi_agent_sessions"), runs: countRows(db, "agent_runs") };
		let spanId = "";

		const value = await temp.kernel.step(
			"objdiff",
			{ parentRunId: parent.runId, attributes: { unit: "fn_8003A1C4" } },
			async (span) => {
				spanId = span.spanId;
				return 97.4;
			},
		);

		expect(value).toBe(97.4);
		const events = spanEvents(db, spanId);
		expect(events.map((e) => e.type)).toEqual(["step_start", "step_end"]);
		for (const e of events) {
			expect(e.runId).toBe(parent.runId);
			expect(e.piSessionId).toBeNull();
			expect(e.parentEventId).toBeNull();
			expect(e.eventData.run_id).toBe(parent.runId);
			expect(e.eventData.step_name).toBe("objdiff");
		}
		const [start, end] = events;
		expect(start!.eventId).toBe(kernelNodeEventId(`span:${spanId}`, 0, "step_start"));
		expect(start!.eventData.attributes).toEqual({ unit: "fn_8003A1C4" });
		expect(end!.eventId).toBe(kernelNodeEventId(`span:${spanId}`, 0, "step_end"));
		expect(end!.eventData.status).toBe("ok");
		expect(end!.eventData.duration_ms).toBe(Date.parse(end!.timestamp) - Date.parse(start!.timestamp));
		expect(end!.eventData.check_result).toBeUndefined();
		// A step writes no session or run rows.
		expect({ sessions: countRows(db, "pi_agent_sessions"), runs: countRows(db, "agent_runs") }).toEqual(before);

		// Paired by span id: the doctor is satisfied once the parent run ends normally.
		await updateAgentRunStatus(db, parent.runId, "done", { endedAt: new Date().toISOString() });
		await expectDoctorOk(db);
	});

	test("step rethrows and records status error", async () => {
		const { db, containerId } = temp.tempDb;
		const failure = new Error("objdiff crashed");
		let thrownSpan = "";
		const rejected = await temp.kernel
			.step("objdiff", { containerId }, (span) => {
				thrownSpan = span.spanId;
				throw failure;
			})
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		expect(rejected).toBe(failure);
		const thrownEnd = spanEvents(db, thrownSpan).find((e) => e.type === "step_end");
		expect(thrownEnd?.eventData).toMatchObject({ status: "error", error_message: "objdiff crashed" });
		expect(thrownEnd?.runId).toBeNull();

		// A step that resolves but marks its span as failed still returns its value.
		let markedSpan = "";
		const value = await temp.kernel.step("lint", { containerId }, (span) => {
			markedSpan = span.spanId;
			span.setStatus("error", "3 advisories");
			return "partial";
		});
		expect(value).toBe("partial");
		const markedEnd = spanEvents(db, markedSpan).find((e) => e.type === "step_end");
		expect(markedEnd?.eventData).toMatchObject({ status: "error", error_message: "3 advisories" });
	});

	test("setAttributes and addEvent land on step_end; summary capped at 4 KB", async () => {
		const { db, containerId } = temp.tempDb;
		let spanId = "";
		await temp.kernel.step(
			"build",
			{ containerId, summarize: (r: { score: number }) => ({ score: r.score }) },
			(span) => {
				spanId = span.spanId;
				span.setAttributes({ score: 97.4, gates: "4/5" });
				span.setAttributes({ gates: "5/5", cached: true });
				for (let i = 0; i < 25; i++) span.addEvent(`tick-${i}`, { i });
				return { score: 97.4 };
			},
		);
		const end = spanEvents(db, spanId).find((e) => e.type === "step_end")!;
		expect(end.eventData.attributes).toEqual({ score: 97.4, gates: "5/5", cached: true });
		const events = end.eventData.events as Array<{ name: string; at_ms: number; attributes?: unknown }>;
		expect(events).toHaveLength(20);
		expect(events.map((e) => e.name)).toEqual(Array.from({ length: 20 }, (_, i) => `tick-${i}`));
		expect(events[3]).toMatchObject({ attributes: { i: 3 } });
		for (const e of events) expect(e.at_ms).toBeGreaterThanOrEqual(0);
		expect(end.eventData.output_summary).toEqual({ score: 97.4 });

		// Over 4 KB of JSON: replaced by a marker with the byte count.
		let bigSpan = "";
		await temp.kernel.step("dump", { containerId, summarize: (r: string) => r }, (span) => {
			bigSpan = span.spanId;
			return "x".repeat(5_000);
		});
		const bigEnd = spanEvents(db, bigSpan).find((e) => e.type === "step_end")!;
		expect(bigEnd.eventData.output_summary).toEqual({ truncated: true, bytes: 5_002 });
	});

	test("step write failures are logged by id and never fail the step", async () => {
		const { db, containerId } = temp.tempDb;
		failInsertsOf(db, "step_start");
		failInsertsOf(db, "step_end");
		let ran = false;
		let spanId = "";
		const value = await temp.kernel.step("compile", { containerId }, (span) => {
			ran = true;
			spanId = span.spanId;
			return "ok";
		});
		expect(ran).toBe(true);
		expect(value).toBe("ok");
		expect(spanEvents(db, spanId)).toEqual([]);
		const writeErrors = logs.filter((l) => l.level === "error");
		expect(writeErrors.map((l) => l.message)).toEqual(["step start write failed", "step end write failed"]);
		for (const l of writeErrors) expect(l.data).toMatchObject({ spanId, step: "compile" });
	});

	test("requestId gives a deterministic span id; a re-run inserts no new rows", async () => {
		const { db, containerId, kernelId } = temp.tempDb;
		const spans: string[] = [];
		const run = () =>
			temp.kernel.step("compile", { containerId, requestId: "compile-1" }, (span) => {
				spans.push(span.spanId);
			});
		await run();
		const after = countRows(db, "trace_events");
		await run();
		expect(spans).toEqual([kernelRequestId(kernelId, "span", "compile-1"), kernelRequestId(kernelId, "span", "compile-1")]);
		expect(countRows(db, "trace_events")).toBe(after);
	});
});
