import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	getAgentRun,
	getContainer,
	getPiAgentSession,
	listAgentRunsForPiSession,
	incrementContainerUsage,
	openKernelDatabase,
	updateAgentRunInboundEvent,
	updateAgentRunStatus,
	updatePiAgentSessionStatus,
	upsertContainer,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import type { TurnUsage } from "@agent-kernel/protocol";

import { runTraceDoctor } from "../../doctor";
import { setupPiSessionAndRun } from "../session/pi-session-db-init";
import { createRunUsageRecorder } from "./usage-rollup";

const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-07-01T00:00:00.000Z";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kernel-usage-rollup-"));
	handle = openKernelDatabase({ path: join(dir, "trace.db") });
	await ensureKernelObservabilitySchema(handle.db);
	await upsertContainer(handle.db, {
		id: CONTAINER_ID,
		kernelId: "demo",
		kind: "session",
		appKey: ["req-1"],
		createdAt: NOW,
	});
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

function usage(input: number, output: number, cost?: number): TurnUsage {
	return {
		inputTokens: input,
		outputTokens: output,
		cacheReadTokens: input * 2,
		cacheWriteTokens: 1,
		model: "test/model-1",
		...(cost !== undefined ? { costEstimate: cost } : {}),
	};
}

/** Simulate the pipeline's write sequence for one run in the session. */
async function simulateRun(opts: {
	runId: string;
	trigger: "operator" | "resume";
	turns: TurnUsage[];
	inboundEventId?: string;
}): Promise<void> {
	const db = handle.db;
	await setupPiSessionAndRun(db, {
		piSessionUuid: SESSION_ID,
		containerId: CONTAINER_ID,
		runId: opts.runId,
		agentName: "researcher",
		trigger: opts.trigger,
	});
	if (opts.inboundEventId) {
		await updateAgentRunInboundEvent(db, opts.runId, opts.inboundEventId);
	}
	const recorder = createRunUsageRecorder(db, {
		runId: opts.runId,
		piSessionUuid: SESSION_ID,
		containerId: CONTAINER_ID,
	});
	for (const turn of opts.turns) recorder.recordTurn(turn);
	await recorder.finalize();
	const endedAt = new Date().toISOString();
	await updateAgentRunStatus(db, opts.runId, "done", { endedAt });
	await updatePiAgentSessionStatus(db, SESSION_ID, "ended", endedAt);
}

describe("usage rollup across a multi-run session", () => {
	test("two sequential runs reuse the session, roll up usage, and satisfy doctor invariant 8", async () => {
		const db = handle.db;

		// Run 1.
		await simulateRun({
			runId: "run-1",
			trigger: "operator",
			turns: [usage(100, 20, 0.01), usage(150, 30, 0.02)],
			inboundEventId: "evt-inbound-1",
		});
		let session = await getPiAgentSession(db, SESSION_ID);
		expect(session?.status).toBe("ended");

		// Run 2 reuses the session: setup flips it back to active and records
		// a fresh run row with its own trigger.
		await setupPiSessionAndRun(db, {
			piSessionUuid: SESSION_ID,
			containerId: CONTAINER_ID,
			runId: "run-2",
			agentName: "researcher",
			trigger: "resume",
		});
		session = await getPiAgentSession(db, SESSION_ID);
		expect(session?.status).toBe("active");

		const recorder2 = createRunUsageRecorder(db, {
			runId: "run-2",
			piSessionUuid: SESSION_ID,
			containerId: CONTAINER_ID,
		});
		recorder2.recordTurn(usage(200, 40));
		await recorder2.finalize();
		await updateAgentRunStatus(db, "run-2", "done", {
			endedAt: new Date().toISOString(),
		});
		await updatePiAgentSessionStatus(db, SESSION_ID, "ended", new Date().toISOString());

		// Run rows: fresh row per run, trigger recorded, usage incremented.
		const runs = await listAgentRunsForPiSession(db, SESSION_ID);
		expect(runs.map((r) => [r.id, r.trigger, r.status])).toEqual([
			["run-1", "operator", "done"],
			["run-2", "resume", "done"],
		]);
		const run1 = await getAgentRun(db, "run-1");
		expect(run1).toMatchObject({
			usageInputTokens: 250,
			usageOutputTokens: 50,
			usageCacheRead: 500,
			usageCacheWrite: 2,
			inboundEventId: "evt-inbound-1",
		});
		expect(run1?.usageCostEstimate).toBeCloseTo(0.03, 9);
		const run2 = await getAgentRun(db, "run-2");
		expect(run2).toMatchObject({
			usageInputTokens: 200,
			usageOutputTokens: 40,
		});
		// No cost observed for run 2 — the column stays NULL, not 0.
		expect(run2?.usageCostEstimate).toBeNull();

		// Session rollup (input/output) is the sum of both runs.
		session = await getPiAgentSession(db, SESSION_ID);
		expect(session).toMatchObject({
			status: "ended",
			usageInputTokens: 450,
			usageOutputTokens: 90,
		});

		// Container rollup carries the full delta including cost.
		const container = await getContainer(db, CONTAINER_ID);
		expect(container).toMatchObject({
			usageInputTokens: 450,
			usageOutputTokens: 90,
			usageCacheRead: 900,
			usageCacheWrite: 3,
		});
		expect(container?.usageCostEstimate).toBeCloseTo(0.03, 9);

		// Doctor: all invariants green, including usage consistency (#8).
		const report = await runTraceDoctor(db);
		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.skipped).toEqual([]);
	});

	test("finalize is idempotent — a second call does not double the session/container fold", async () => {
		const db = handle.db;
		await setupPiSessionAndRun(db, {
			piSessionUuid: SESSION_ID,
			containerId: CONTAINER_ID,
			runId: "run-1",
			agentName: "researcher",
			trigger: "operator",
		});
		const recorder = createRunUsageRecorder(db, {
			runId: "run-1",
			piSessionUuid: SESSION_ID,
			containerId: CONTAINER_ID,
		});
		recorder.recordTurn(usage(10, 5));
		await recorder.finalize();
		await recorder.finalize();
		recorder.recordTurn(usage(99, 99)); // ignored after finalize

		const session = await getPiAgentSession(db, SESSION_ID);
		expect(session?.usageInputTokens).toBe(10);
		const container = await getContainer(db, CONTAINER_ID);
		expect(container?.usageInputTokens).toBe(10);
	});

	test("doctor invariant 8 reports rollup drift", async () => {
		const db = handle.db;
		await simulateRun({
			runId: "run-1",
			trigger: "operator",
			turns: [usage(100, 20)],
		});
		// Tamper: container rollup drifts from the sum of its runs.
		await incrementContainerUsage(db, CONTAINER_ID, {
			inputTokens: 7,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		const report = await runTraceDoctor(db);
		expect(report.ok).toBe(false);
		expect(report.violations).toEqual([
			expect.objectContaining({
				invariant: 8,
				name: "container-usage-rollup",
				sampleIds: [CONTAINER_ID],
			}),
		]);
	});
});
