import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
	abandonNodeRun,
	claimAndStartNode,
	createAgentRun,
	ensureKernelObservabilitySchema,
	getAgentRun,
	incrementContainerUsage,
	incrementSessionUsage,
	insertTraceEventsBatch,
	listTraceEventsForRun,
	openKernelDatabase,
	updateRunUsage,
	upsertContainer,
	upsertPiAgentSession,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import {
	createCallStartEvent,
	kernelNodeEventId,
	type TraceEvent,
} from "@agent-kernel/protocol";

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

/** What a node run carries, in order; "turn" is a pi_turn_end. */
type NodeEventKind = "call_start" | "turn" | "decision_made" | "call_end";

const NODE_EVENT_TYPE: Record<NodeEventKind, string> = {
	call_start: "call_start",
	turn: "pi_turn_end",
	decision_made: "decision_made",
	call_end: "call_end",
};

/**
 * One model-node session + run describing run-1. The run's inbound_event_id
 * is its call_start (`<runId>-start`) unless overridden.
 */
async function insertNodeRun(opts: {
	kind: "call" | "decision";
	runId: string;
	status: "running" | "done" | "error" | "aborted";
	events: NodeEventKind[];
	inboundEventId?: string | null;
}) {
	const db = handle.db;
	const sessionId = `${opts.runId}-session`;
	const agentName = opts.kind === "call" ? "ExtractCheckpointKnowledge" : "lint-judge";
	const running = opts.status === "running";
	await upsertPiAgentSession(db, {
		id: sessionId,
		containerId: "container-1",
		agentName,
		kind: opts.kind,
		status: running ? "active" : "ended",
		createdAt: NOW,
	});
	await createAgentRun(db, {
		id: opts.runId,
		piSessionId: sessionId,
		containerId: "container-1",
		agentName,
		trigger: opts.kind === "call" ? "post-run" : "judge",
		parentRunId: "run-1",
		inboundEventId:
			opts.inboundEventId === undefined ? `${opts.runId}-start` : opts.inboundEventId,
		status: opts.status,
		startedAt: NOW,
		...(running ? {} : { endedAt: NOW }),
	});
	await insertTraceEventsBatch(
		db,
		opts.events.map((kind, i) =>
			event({
				eventId: kind === "call_start" ? `${opts.runId}-start` : `${opts.runId}-${i}-${kind}`,
				type: NODE_EVENT_TYPE[kind],
				runId: opts.runId,
				piSessionUuid: sessionId,
				traceLevel: 1,
				eventData: { run_id: opts.runId },
			}),
		),
	);
}

/** One step span; `end: false` leaves it unpaired. */
function stepEvents(spanId: string, runId: string | undefined, end = true): TraceEvent[] {
	return [
		event({
			eventId: `${spanId}-start`,
			type: "step_start",
			runId,
			spanId,
			traceLevel: 1,
			eventData: { step_name: "apply-lints", run_id: runId },
		}),
		...(end
			? [
					event({
						eventId: `${spanId}-end`,
						type: "step_end",
						runId,
						spanId,
						traceLevel: 1,
						eventData: { step_name: "apply-lints", run_id: runId, status: "ok" },
					}),
				]
			: []),
	];
}

/** A done call, a done decision, and a gate holding a step, all under run-1. */
async function insertHealthyNodes() {
	await insertNodeRun({
		kind: "call",
		runId: "node-call",
		status: "done",
		events: ["call_start", "turn", "call_end"],
	});
	await insertNodeRun({
		kind: "decision",
		runId: "node-decision",
		status: "done",
		events: ["call_start", "turn", "decision_made", "call_end"],
	});
	await insertTraceEventsBatch(handle.db, [
		event({
			eventId: "gate-1-start",
			type: "gate_start",
			runId: "run-1",
			spanId: "gate-1",
			traceLevel: 1,
			eventData: { gate_name: "accept", run_id: "run-1", checks: [] },
		}),
		...stepEvents("step-1", "run-1"),
		event({
			eventId: "gate-1-end",
			type: "gate_end",
			runId: "run-1",
			spanId: "gate-1",
			traceLevel: 1,
			eventData: { gate_name: "accept", run_id: "run-1", verdict: "pass", checks: [] },
		}),
	]);
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
		expect(report.skipped).toEqual([]);
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

	test("8: passes when run sums match session and container rollups", async () => {
		await insertHealthyBaseline();
		await updateRunUsage(handle.db, "run-1", {
			inputTokens: 100,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 2,
			costEstimate: 0.01,
		});
		await incrementSessionUsage(handle.db, "session-1", {
			inputTokens: 100,
			outputTokens: 20,
		});
		await incrementContainerUsage(handle.db, "container-1", {
			inputTokens: 100,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 2,
			costEstimate: 0.01,
		});
		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);
	});

	test("8: flags session and container rollup drift", async () => {
		await insertHealthyBaseline();
		// Runs carry usage but nothing was folded into the rollups.
		await updateRunUsage(handle.db, "run-1", {
			inputTokens: 100,
			outputTokens: 20,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([8, 8]);
		expect(report.violations.map((v) => v.name).sort()).toEqual([
			"container-usage-rollup",
			"session-usage-rollup",
		]);
		expect(report.violations.find((v) => v.name === "session-usage-rollup")?.sampleIds).toEqual([
			"session-1",
		]);
		expect(
			report.violations.find((v) => v.name === "container-usage-rollup")?.sampleIds,
		).toEqual(["container-1"]);
	});

	test("8: tolerates pre-Phase-2 rows with zero usage everywhere", async () => {
		await insertHealthyBaseline();
		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
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

describe("runTraceDoctor model nodes", () => {
	test("healthy model-node fixture has zero violations", async () => {
		await insertHealthyBaseline();
		await insertHealthyNodes();
		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);
	});

	test("invariant 3 ignores call and decision sessions", async () => {
		await insertHealthyBaseline();
		// Child-shaped node sessions (unresolved parent, no tool linkage) would
		// trip invariant 3 as Pi sessions; as node sessions only 9 reports them.
		await upsertPiAgentSession(handle.db, {
			id: "call-session-with-parent",
			containerId: "container-1",
			agentName: "ExtractCheckpointKnowledge",
			kind: "call",
			status: "ended",
			createdAt: NOW,
			parentSessionId: "nope",
		});
		await upsertPiAgentSession(handle.db, {
			id: "decision-session-with-parent",
			containerId: "container-1",
			agentName: "lint-judge",
			kind: "decision",
			status: "ended",
			createdAt: NOW,
			parentSessionId: "session-1",
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([9]);
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"call-session-with-parent",
			"decision-session-with-parent",
		]);
	});

	test("invariant 9 flags a call run with a tool_call_start", async () => {
		await insertHealthyBaseline();
		await insertHealthyNodes();
		// Paired, so invariant 5 stays quiet: only the node shape is wrong.
		await insertTraceEventsBatch(handle.db, [
			event({
				eventId: "evt-node-tool-start",
				type: "tool_call_start",
				runId: "node-call",
				eventData: { tool_use_id: "toolu_node", tool_name: "read" },
			}),
			event({
				eventId: "evt-node-tool-end",
				type: "tool_call_end",
				runId: "node-call",
				eventData: { tool_use_id: "toolu_node", tool_name: "read" },
			}),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([9]);
		expect(report.violations[0].name).toBe("model-node-shape");
		expect(report.violations[0].sampleIds).toEqual(["node-call"]);
	});

	test("invariant 9 flags a done decision run without a turn", async () => {
		await insertHealthyBaseline();
		await insertNodeRun({
			kind: "decision",
			runId: "decision-no-turn",
			status: "done",
			events: ["call_start", "decision_made", "call_end"],
		});
		// An errored decision legitimately has no turn (e.g. too-large, no request).
		await insertNodeRun({
			kind: "decision",
			runId: "decision-error-no-turn",
			status: "error",
			events: ["call_start", "call_end"],
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([9]);
		expect(report.violations[0].sampleIds).toEqual(["decision-no-turn"]);
	});

	test("invariant 10 flags an unpaired call_start on a terminal run", async () => {
		await insertHealthyBaseline();
		await insertNodeRun({
			kind: "call",
			runId: "call-errored-unpaired",
			status: "error",
			events: ["call_start", "turn"],
		});
		// Still running: the end is not due yet.
		await insertNodeRun({
			kind: "call",
			runId: "call-running",
			status: "running",
			events: ["call_start"],
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([10]);
		expect(report.violations[0].name).toBe("node-span-pairing");
		expect(report.violations[0].sampleIds).toEqual(["call-errored-unpaired-start"]);
	});

	test("invariant 10 flags an unpaired step_start", async () => {
		await insertHealthyBaseline();
		await createAgentRun(handle.db, {
			id: "run-crashed",
			piSessionId: "session-1",
			containerId: "container-1",
			agentName: "coordinator",
			trigger: "operator",
			status: "error",
			startedAt: NOW,
			endedAt: NOW,
		});
		await insertTraceEventsBatch(handle.db, [
			// Unpaired on a run that finished normally, and with no run at all.
			...stepEvents("step-unpaired", "run-1", false),
			...stepEvents("step-runless", undefined, false),
			// Unpaired on an abnormally ended run: excused.
			...stepEvents("step-on-crashed-run", "run-crashed", false),
		]);
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([10]);
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"step-runless-start",
			"step-unpaired-start",
		]);
	});

	test("invariant 11 flags a done decision without decision_made", async () => {
		await insertHealthyBaseline();
		await insertNodeRun({
			kind: "decision",
			runId: "decision-missing",
			status: "done",
			events: ["call_start", "turn", "call_end"],
		});
		await insertNodeRun({
			kind: "decision",
			runId: "decision-twice",
			status: "done",
			events: ["call_start", "turn", "decision_made", "decision_made", "call_end"],
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([11]);
		expect(report.violations[0].name).toBe("decision-made");
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"decision-missing",
			"decision-twice",
		]);
	});

	test("invariant 12 flags a broken inbound link", async () => {
		await insertHealthyBaseline();
		await insertHealthyNodes();
		await insertNodeRun({
			kind: "call",
			runId: "call-inbound-missing",
			status: "done",
			events: ["call_start", "turn", "call_end"],
			inboundEventId: null,
		});
		// Points at another run's call_start.
		await insertNodeRun({
			kind: "call",
			runId: "call-inbound-foreign",
			status: "done",
			events: ["call_start", "turn", "call_end"],
			inboundEventId: "node-call-start",
		});
		// Points at an event that is not a call_start.
		await insertNodeRun({
			kind: "decision",
			runId: "decision-inbound-turn",
			status: "done",
			events: ["call_start", "turn", "decision_made", "call_end"],
			inboundEventId: "decision-inbound-turn-1-turn",
		});
		const report = await runTraceDoctor(handle.db);
		expect(violationInvariants(report)).toEqual([12]);
		expect(report.violations[0].name).toBe("node-inbound-linkage");
		expect(report.violations[0].sampleIds.sort()).toEqual([
			"call-inbound-foreign",
			"call-inbound-missing",
			"decision-inbound-turn",
		]);
	});

	test("crash after start, recover with abandonNodeRun, doctor ok", async () => {
		await insertHealthyBaseline();
		const runId = "node-crashed";
		const sessionId = "node-crashed-session";
		const startedAt = "2026-07-01T00:00:01.000Z";
		const deadlineAt = "2026-07-01T00:00:13.000Z";
		const startEvent = createCallStartEvent(
			{ containerId: "container-1", runId, piSessionUuid: sessionId },
			{
				run_id: runId,
				node_kind: "decision",
				function_name: "lint-judge",
				engine: "jev",
				model: "typesafe/jev-1.13.0",
				prompt_hash: "dq1-test",
				input_blob_hash: "b1-test",
				trigger: "judge",
				parent_run_id: "run-1",
				deadline_at: deadlineAt,
			},
			{ eventId: kernelNodeEventId(runId, 0, "call_start"), timestamp: startedAt },
		);
		const claim = await claimAndStartNode(handle.db, {
			kind: "decision",
			sessionId,
			runId,
			containerId: "container-1",
			agentName: "lint-judge",
			model: "typesafe/jev-1.13.0",
			promptHash: "dq1-test",
			parentRunId: "run-1",
			trigger: "judge",
			startedAt,
			startEvent,
			startBlobs: [],
			staleAfterMs: 600_000,
			nowMs: Date.parse(startedAt),
			deadlineAt,
		});
		expect(claim.kind).toBe("claimed");

		// The process dies here: no engine result, no completion. A running
		// run on an active session is a legal in-flight state.
		const inFlight = await runTraceDoctor(handle.db);
		expect(inFlight.violations).toEqual([]);

		await abandonNodeRun(handle.db, {
			runId,
			sessionId,
			containerId: "container-1",
			at: "2026-07-01T00:01:30.000Z",
		});

		const run = await getAgentRun(handle.db, runId);
		expect(run?.status).toBe("aborted");
		const types = (await listTraceEventsForRun(handle.db, runId)).map((e) => e.type);
		expect(types).toEqual(["call_start", "call_end"]);

		const report = await runTraceDoctor(handle.db);
		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);
	});

	test("reads a database that predates the kind column", async () => {
		await insertHealthyBaseline();
		handle.db.run(sql`ALTER TABLE pi_agent_sessions DROP COLUMN kind`);
		// A fresh handle: the kind probe caches per handle.
		const old = openKernelDatabase({ path: join(dir, "trace.db") });
		try {
			const report = await runTraceDoctor(old.db);
			expect(report.violations).toEqual([]);
			expect(report.counts.piAgentSessions).toBe(2);
		} finally {
			old.close();
		}
	});
});
