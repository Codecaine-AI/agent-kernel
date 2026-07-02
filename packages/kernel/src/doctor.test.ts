import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
	createAgentRun,
	ensureKernelObservabilitySchema,
	insertTraceEventsBatch,
	openKernelDatabase,
	upsertContainer,
	upsertPiAgentSession,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import type { TraceEvent } from "@agent-kernel/protocol";

import { formatDoctorReport, runTraceDoctor } from "./doctor";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kernel-doctor-"));
	handle = openKernelDatabase({ path: join(dir, "trace.db") });
	await ensureKernelObservabilitySchema(handle.db);
	// Violation fixtures intentionally break referential integrity.
	handle.db.run(sql`PRAGMA foreign_keys = OFF`);
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = "2026-07-01T00:00:00.000Z";

function event(overrides: Partial<TraceEvent> & { eventId: string }): TraceEvent {
	return {
		containerId: "container-1",
		type: "user_message",
		source: "kernel",
		traceLevel: 0,
		eventData: {},
		timestamp: NOW,
		...overrides,
	} as TraceEvent;
}

async function insertHealthyBaseline() {
	const db = handle.db;
	await upsertContainer(db, {
		id: "container-1",
		kernelId: "demo",
		kind: "session",
		appKey: ["req-1"],
		createdAt: NOW,
	});
	await upsertPiAgentSession(db, {
		id: "session-1",
		containerId: "container-1",
		agentName: "coordinator",
		status: "ended",
		createdAt: NOW,
	});
	await upsertPiAgentSession(db, {
		id: "session-2",
		containerId: "container-1",
		agentName: "scout",
		status: "ended",
		createdAt: NOW,
		parentSessionId: "session-1",
		parentToolUseId: "toolu_1",
	});
	await createAgentRun(db, {
		id: "run-1",
		piSessionId: "session-1",
		containerId: "container-1",
		agentName: "coordinator",
		trigger: "operator",
		status: "done",
		startedAt: NOW,
		endedAt: NOW,
	});
	await createAgentRun(db, {
		id: "run-2",
		piSessionId: "session-2",
		containerId: "container-1",
		agentName: "scout",
		trigger: "parent-tool",
		parentRunId: "run-1",
		parentToolUseId: "toolu_1",
		status: "done",
		startedAt: NOW,
		endedAt: NOW,
	});
	await insertTraceEventsBatch(db, [
		event({ eventId: "evt-user", runId: "run-1", piSessionUuid: "session-1" }),
		event({
			eventId: "evt-tool-start",
			type: "tool_call_start",
			runId: "run-1",
			eventData: { tool_use_id: "toolu_1", tool_name: "spawn" },
		}),
		event({
			eventId: "evt-tool-end",
			type: "tool_call_end",
			runId: "run-1",
			eventData: { tool_use_id: "toolu_1", tool_name: "spawn" },
		}),
		event({
			eventId: "evt-assistant",
			type: "assistant_message",
			runId: "run-1",
		}),
	]);
}

function violationInvariants(report: Awaited<ReturnType<typeof runTraceDoctor>>) {
	return report.violations.map((v) => v.invariant);
}

describe("runTraceDoctor", () => {
	test("healthy fixture has zero violations", async () => {
		await insertHealthyBaseline();
		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.counts).toEqual({
			containers: 1,
			piAgentSessions: 2,
			agentRuns: 2,
			traceEvents: 4,
		});
		expect(report.skipped).toEqual([
			expect.objectContaining({ invariant: 8 }),
		]);
		expect(formatDoctorReport(report)).toContain("OK");
	});

	test("1: flags events whose container does not exist", async () => {
		await insertHealthyBaseline();
		await insertTraceEventsBatch(handle.db, [
			event({ eventId: "evt-orphan", containerId: "nope" }),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([1]);
		expect(report.violations[0].sampleIds).toEqual(["evt-orphan"]);
		expect(report.ok).toBe(false);
	});

	test("2: flags runs with dangling container or session linkage", async () => {
		await insertHealthyBaseline();
		await createAgentRun(handle.db, {
			id: "run-bad-container",
			piSessionId: "session-1",
			containerId: "nope",
			agentName: "x",
			trigger: "operator",
			status: "done",
			startedAt: NOW,
		});
		await createAgentRun(handle.db, {
			id: "run-bad-session",
			piSessionId: "nope",
			containerId: "container-1",
			agentName: "x",
			trigger: "operator",
			status: "done",
			startedAt: NOW,
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([2]);
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"run-bad-container",
			"run-bad-session",
		]);
	});

	test("3: flags child sessions with unresolved parent or missing tool linkage", async () => {
		await insertHealthyBaseline();
		await upsertPiAgentSession(handle.db, {
			id: "session-orphan-parent",
			containerId: "container-1",
			agentName: "x",
			status: "ended",
			createdAt: NOW,
			parentSessionId: "nope",
			parentToolUseId: "toolu_x",
		});
		await upsertPiAgentSession(handle.db, {
			id: "session-no-tool-use",
			containerId: "container-1",
			agentName: "x",
			status: "ended",
			createdAt: NOW,
			parentSessionId: "session-1",
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([3]);
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"session-no-tool-use",
			"session-orphan-parent",
		]);
	});

	test("4: flags non-terminal runs whose session is no longer active", async () => {
		await insertHealthyBaseline();
		// session-1 is "ended"; a still-running run there violates.
		await createAgentRun(handle.db, {
			id: "run-stuck",
			piSessionId: "session-1",
			containerId: "container-1",
			agentName: "x",
			trigger: "operator",
			status: "running",
			startedAt: NOW,
		});
		// A running run on an active session is fine.
		await upsertPiAgentSession(handle.db, {
			id: "session-live",
			containerId: "container-1",
			agentName: "y",
			status: "active",
			createdAt: NOW,
		});
		await createAgentRun(handle.db, {
			id: "run-live",
			piSessionId: "session-live",
			containerId: "container-1",
			agentName: "y",
			trigger: "operator",
			status: "running",
			startedAt: NOW,
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([4]);
		expect(report.violations[0].sampleIds).toEqual(["run-stuck"]);
	});

	test("5: flags unmatched tool_call_start on a normally-finished run", async () => {
		await insertHealthyBaseline();
		await insertTraceEventsBatch(handle.db, [
			event({
				eventId: "evt-unmatched",
				type: "tool_call_start",
				runId: "run-1",
				eventData: { tool_use_id: "toolu_unmatched", tool_name: "bash" },
			}),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([5]);
		expect(report.violations[0].sampleIds).toEqual(["evt-unmatched"]);
	});

	test("5: excuses unmatched tool_call_start when the run ended abnormally", async () => {
		await insertHealthyBaseline();
		await createAgentRun(handle.db, {
			id: "run-crashed",
			piSessionId: "session-1",
			containerId: "container-1",
			agentName: "x",
			trigger: "operator",
			status: "error",
			startedAt: NOW,
			endedAt: NOW,
		});
		await insertTraceEventsBatch(handle.db, [
			event({
				eventId: "evt-crash-tool",
				type: "tool_call_start",
				runId: "run-crashed",
				eventData: { tool_use_id: "toolu_crash", tool_name: "bash" },
			}),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
	});

	test("6: flags container parent cycles", async () => {
		await insertHealthyBaseline();
		await upsertContainer(handle.db, {
			id: "cycle-a",
			kernelId: "demo",
			kind: "worker",
			appKey: ["a"],
			createdAt: NOW,
			parentContainerId: "cycle-b",
		});
		await upsertContainer(handle.db, {
			id: "cycle-b",
			kernelId: "demo",
			kind: "worker",
			appKey: ["b"],
			createdAt: NOW,
			parentContainerId: "cycle-a",
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([6]);
		expect(report.violations[0].name).toBe("container-tree-acyclic");
		expect(report.violations[0].sampleIds.sort()).toEqual(["cycle-a", "cycle-b"]);
	});

	test("6: flags containers with an empty kind", async () => {
		await insertHealthyBaseline();
		await upsertContainer(handle.db, {
			id: "kindless",
			kernelId: "demo",
			kind: "",
			appKey: ["k"],
			createdAt: NOW,
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([6]);
		expect(report.violations[0].name).toBe("container-kind-present");
		expect(report.violations[0].sampleIds).toEqual(["kindless"]);
	});

	test("7: flags events whose run_id does not resolve", async () => {
		await insertHealthyBaseline();
		await insertTraceEventsBatch(handle.db, [
			event({ eventId: "evt-ghost-run", runId: "nope" }),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([7]);
		expect(report.violations[0].sampleIds).toEqual(["evt-ghost-run"]);
	});

	test("formatDoctorReport renders violations readably", async () => {
		await insertHealthyBaseline();
		await insertTraceEventsBatch(handle.db, [
			event({ eventId: "evt-orphan", containerId: "nope" }),
		]);
		const report = await runTraceDoctor(handle.db);
		const text = formatDoctorReport(report, "/tmp/trace.db");
		expect(text).toContain("FAIL");
		expect(text).toContain("[invariant 1]");
		expect(text).toContain("evt-orphan");
	});
});
