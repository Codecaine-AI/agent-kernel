/**
 * model-node-trace — a small offline trace with every model-node kind, built
 * through viewer-core's real buildTraceSpans so the viewer-ui tests read the
 * attributes exactly as the tree receives them. No trace DB, no network.
 *
 *   worker W, run R1
 *     ├─ gate G (llm-review-advisories) on R1: pass
 *     │    ├─ step S (justification:A1, check pass)
 *     │    ├─ decision D  JudgeAdvisory:A1   bool p 0.91, pass ≥ 0.85
 *     │    └─ decision RD JudgeAdvisory:A2   attempt 1 engine-error, attempt 2 p 0.88
 *     ├─ call K  ExtractCheckpointKnowledge (R1)   ok
 *     ├─ call F  ExtractCheckpointKnowledge (failed)   error · parse
 *     ├─ call KR ExtractConfirmedCheckpointKnowledge   attempt 1 aborted (abandoned), attempt 2 ok
 *     ├─ decision C  ContinueOrStop   choice 0.21 / 0.71 / 0.08, floor 0.50
 *     ├─ decision A  JudgeAdvisory:A3   abstain · low-confidence, p 0.52
 *     └─ step V  validate   { objdiff: 100, exact: true }
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import {
	buildTraceSpans,
	EventType,
	type AgentRun,
	type CallEndData,
	type CallStartData,
	type Decision,
	type DecisionMadeData,
	type GateCheckRecord,
	type PiAgentSession,
	type TraceEvent,
} from "@agent-kernel/viewer-core";

const CONTAINER = "c-ui";
const T0 = Date.parse("2026-10-07T10:00:00.000Z");

function at(ms: number): string {
	return new Date(T0 + ms).toISOString();
}

let seq = 0;

function ev(type: string, ms: number, eventData: object, envelope: Partial<TraceEvent> = {}): TraceEvent {
	seq += 1;
	return {
		eventId: `ev-${String(seq).padStart(4, "0")}`,
		containerId: CONTAINER,
		runId: null,
		piSessionId: null,
		type: type as TraceEvent["type"],
		source: "kernel" as TraceEvent["source"],
		traceLevel: 1,
		eventData: eventData as TraceEvent["eventData"],
		timestamp: at(ms),
		...envelope,
	};
}

interface Trace {
	sessions: PiAgentSession[];
	runs: AgentRun[];
	events: TraceEvent[];
}

const trace: Trace = { sessions: [], runs: [], events: [] };

trace.sessions.push({
	id: "W",
	containerId: CONTAINER,
	agentName: "worker",
	status: "ended",
	createdAt: at(0),
	endedAt: at(60_000),
});
trace.runs.push({
	id: "R1",
	piSessionId: "W",
	containerId: CONTAINER,
	agentName: "worker",
	trigger: "system",
	status: "done",
	startedAt: at(0),
	endedAt: at(60_000),
});
trace.events.push(
	ev(EventType.PI_REQUEST_SNAPSHOT, 10, { turn_number: 0, message_count: 1 }, { runId: "R1", piSessionId: "W" }),
);

interface NodeRun {
	runId: string;
	startMs: number;
	endMs: number;
	status?: CallEndData["status"];
	runStatus?: string;
	error?: CallEndData["error"];
	output?: boolean;
	gateSpanId?: string;
	decision?: Omit<DecisionMadeData, "run_id" | "decision_name" | "engine" | "provider" | "model" | "requested_model" | "confidence_source"> & {
		confidence_source?: DecisionMadeData["confidence_source"];
	};
}

function nodeSession(kind: "call" | "decision", sessionId: string, name: string, label: string, runs: NodeRun[]): void {
	trace.sessions.push({
		id: sessionId,
		containerId: CONTAINER,
		kind,
		agentName: name,
		status: "ended",
		createdAt: at(runs[0]!.startMs),
	});
	runs.forEach((run, index) => {
		const status = run.status ?? "ok";
		trace.runs.push({
			id: run.runId,
			piSessionId: sessionId,
			containerId: CONTAINER,
			parentRunId: "R1",
			agentName: name,
			trigger: kind === "decision" ? "judge" : "post-run",
			status: run.runStatus ?? (status === "ok" ? "done" : status),
			startedAt: at(run.startMs),
			endedAt: at(run.endMs),
		});
		const envelope = { runId: run.runId, piSessionId: sessionId };
		const model = kind === "decision" ? "typesafe/jev-1.13.0" : "openai/gpt-5.4-mini";
		const start: CallStartData = {
			run_id: run.runId,
			node_kind: kind,
			function_name: name,
			engine: kind === "decision" ? "jev" : "baml",
			...(kind === "call" && { transport: "baml-http" as const }),
			model,
			prompt_hash: kind === "decision" ? "dq1-7f3a" : "baml1-2c9e",
			input_blob_hash: `b1-in-${run.runId}`,
			trigger: kind === "decision" ? "judge" : "post-run",
			parent_run_id: "R1",
			request_id: `req-${sessionId}`,
			attempt: index + 1,
			deadline_at: at(run.startMs + 12_000),
			display_label: label,
			...(run.gateSpanId !== undefined && { gate_span_id: run.gateSpanId }),
		};
		trace.events.push(ev(EventType.CALL_START, run.startMs, start, envelope));
		trace.events.push(
			ev(EventType.PI_REQUEST_SNAPSHOT, run.startMs + 1, { turn_number: 0, message_count: 1 }, envelope),
		);
		if (run.decision) {
			const made: DecisionMadeData = {
				run_id: run.runId,
				decision_name: name,
				engine: "jev",
				provider: "typesafe",
				api: "typesafe-system-one",
				model,
				requested_model: model,
				confidence_source: "native",
				...run.decision,
				...(run.gateSpanId !== undefined && { gate_span_id: run.gateSpanId }),
			};
			trace.events.push(ev(EventType.DECISION_MADE, run.endMs - 1, made, envelope));
		}
		const end: CallEndData = {
			run_id: run.runId,
			node_kind: kind,
			function_name: name,
			status,
			...((run.output ?? status === "ok") && { output_blob_hash: `b1-out-${run.runId}` }),
			...(run.error !== undefined && { error: run.error }),
			usage: {
				inputTokens: 1204,
				outputTokens: 88,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costEstimate: 0.0012,
				model,
			},
			attempts: 1,
			duration_ms: run.endMs - run.startMs,
			resolved_model: model,
			...(run.gateSpanId !== undefined && { gate_span_id: run.gateSpanId }),
		};
		trace.events.push(ev(EventType.CALL_END, run.endMs, end, envelope));
	});
}

function boolAnswer(p: number, passAt: number, failAt: number): Decision {
	const verdict = p >= passAt ? "pass" : p <= failAt ? "fail" : undefined;
	return {
		kind: "bool",
		choice: p >= 0.5 ? "true" : "false",
		probability: p,
		confidence: Math.max(p, 1 - p),
		confidenceSource: "native",
		...(verdict !== undefined && { verdict }),
		abstained: verdict === undefined,
		...(verdict === undefined && { abstainReason: "low-confidence" as const }),
		thresholdApplied: { passAt, failAt },
	};
}

// The gate on R1 and the checks folded under it.
const GATE = "G";
const gateChecks: GateCheckRecord[] = [
	{ name: "justification:A1", kind: "step", result: "pass", value: true, step_span_id: "S" },
	{
		name: "judge:A1",
		kind: "decide",
		result: "pass",
		questions: [{ question_id: "ok", result: "pass", run_id: "RD1", probability: 0.91, pass_at: 0.85, fail_at: 0.15 }],
	},
];
trace.events.push(
	ev(
		EventType.GATE_START,
		100,
		{ gate_name: "llm-review-advisories", run_id: "R1", checks: gateChecks.map(({ name, kind }) => ({ name, kind })) },
		{ runId: "R1", spanId: GATE },
	),
	ev(
		EventType.STEP_START,
		110,
		{ step_name: "justification:A1", run_id: "R1", gate_span_id: GATE, attributes: { advisory: "A1" } },
		{ runId: "R1", spanId: "S" },
	),
	ev(
		EventType.STEP_END,
		140,
		{
			step_name: "justification:A1",
			run_id: "R1",
			status: "ok",
			duration_ms: 30,
			check_result: "pass",
			check_value: true,
			gate_span_id: GATE,
			output_summary: { justified: true },
		},
		{ runId: "R1", spanId: "S" },
	),
);
nodeSession("decision", "D", "JudgeAdvisory", "JudgeAdvisory:A1", [
	{
		runId: "RD1",
		startMs: 150,
		endMs: 260,
		gateSpanId: GATE,
		decision: {
			answers: { ok: boolAnswer(0.91, 0.85, 0.15) },
			chosen: "true",
			abstained: false,
			threshold_applied: { ok: { passAt: 0.85, failAt: 0.15 } },
		},
	},
]);
nodeSession("decision", "RD", "JudgeAdvisory", "JudgeAdvisory:A2", [
	{
		runId: "RD2a",
		startMs: 300,
		endMs: 420,
		status: "error",
		runStatus: "error",
		error: { kind: "http", message: "upstream 503", http_status: 503 },
		gateSpanId: GATE,
		decision: {
			answers: {
				ok: {
					kind: "bool",
					confidenceSource: "none",
					abstained: true,
					abstainReason: "engine-error",
					thresholdApplied: {},
				},
			},
			chosen: "abstain",
			confidence_source: "none",
			abstained: true,
			abstain_reason: "engine-error",
			threshold_applied: { ok: {} },
			error_kind: "http",
		},
	},
	{
		runId: "RD2b",
		startMs: 430,
		endMs: 540,
		gateSpanId: GATE,
		decision: {
			answers: { ok: boolAnswer(0.88, 0.85, 0.15) },
			chosen: "true",
			abstained: false,
			threshold_applied: { ok: { passAt: 0.85, failAt: 0.15 } },
		},
	},
]);
trace.events.push(
	ev(
		EventType.GATE_END,
		560,
		{ gate_name: "llm-review-advisories", run_id: "R1", verdict: "pass", checks: gateChecks, duration_ms: 460 },
		{ runId: "R1", spanId: GATE },
	),
);

nodeSession("call", "K", "ExtractCheckpointKnowledge", "ExtractCheckpointKnowledge (R1)", [
	{ runId: "RK", startMs: 1_000, endMs: 2_800 },
]);
nodeSession("call", "F", "ExtractCheckpointKnowledge", "ExtractCheckpointKnowledge (failed)", [
	{
		runId: "RF",
		startMs: 3_000,
		endMs: 3_900,
		status: "error",
		runStatus: "error",
		output: true,
		error: { kind: "parse", message: "expected object at $.advisories" },
	},
]);
nodeSession("call", "KR", "ExtractConfirmedCheckpointKnowledge", "ExtractConfirmedCheckpointKnowledge", [
	{
		runId: "RKa",
		startMs: 3_920,
		endMs: 3_950,
		status: "aborted",
		runStatus: "aborted",
		error: { kind: "abandoned", message: "stale claim recovered" },
	},
	{ runId: "RKb", startMs: 3_960, endMs: 3_990 },
]);
nodeSession("decision", "C", "ContinueOrStop", "ContinueOrStop", [
	{
		runId: "RC",
		startMs: 4_000,
		endMs: 4_110,
		decision: {
			answers: {
				next: {
					kind: "choice",
					choice: "continue",
					distribution: { stop: 0.21, continue: 0.71, escalate: 0.08 },
					confidence: 0.64,
					confidenceSource: "native",
					abstained: false,
					thresholdApplied: { minTop: 0.5 },
				},
			},
			chosen: "continue",
			abstained: false,
			threshold_applied: { next: { minTop: 0.5 } },
		},
	},
]);
nodeSession("decision", "A", "JudgeAdvisory", "JudgeAdvisory:A3", [
	{
		runId: "RA",
		startMs: 5_000,
		endMs: 5_100,
		decision: {
			answers: { ok: boolAnswer(0.52, 0.85, 0.15) },
			chosen: "abstain",
			abstained: true,
			abstain_reason: "low-confidence",
			threshold_applied: { ok: { passAt: 0.85, failAt: 0.15 } },
		},
	},
]);
trace.events.push(
	ev(
		EventType.STEP_START,
		6_000,
		{ step_name: "validate", run_id: "R1", attributes: { target: "fn_8003A1C4" } },
		{ runId: "R1", spanId: "V" },
	),
	ev(
		EventType.STEP_END,
		6_420,
		{
			step_name: "validate",
			run_id: "R1",
			status: "ok",
			duration_ms: 420,
			attributes: { unit: "d_a_player" },
			events: [{ name: "objdiff", at_ms: 400, attributes: { match: 100 } }],
			output_summary: { objdiff: 100, exact: true },
		},
		{ runId: "R1", spanId: "V" },
	),
);

/** The model-node trace as the tree receives it. */
export function modelNodeSpans(): TraceSpan[] {
	return buildTraceSpans(trace.events, trace.sessions, trace.runs);
}

export function findSpan(spans: TraceSpan[], id: string): TraceSpan {
	const found = flatten(spans).find((span) => span.id === id);
	if (!found) throw new Error(`span ${id} not found`);
	return found;
}

export type FixtureRow =
	| "call"
	| "failedCall"
	| "retriedCall"
	| "retriedCallAttempt1"
	| "decision"
	| "choice"
	| "abstain"
	| "retry"
	| "retryAttempt1"
	| "retryAttempt2"
	| "gate"
	| "gateStep"
	| "step";

/** Span ids of the fixture's rows (node rows `pi:<session>`, attempts `attempt:<run>`, steps and gates their start event). */
export function fixtureSpan(name: FixtureRow): TraceSpan {
	const spans = modelNodeSpans();
	const byEventType = (eventType: string, title: string) => {
		const hit = flatten(spans).find(
			(span) =>
				span.title === title &&
				span.attributes?.some((a) => a.key === "event_type" && a.value?.stringValue === eventType),
		);
		if (!hit) throw new Error(`${eventType} ${title} not found`);
		return hit;
	};
	switch (name) {
		case "call":
			return findSpan(spans, "pi:K");
		case "failedCall":
			return findSpan(spans, "pi:F");
		case "retriedCall":
			return findSpan(spans, "pi:KR");
		case "retriedCallAttempt1":
			return findSpan(spans, "attempt:RKa");
		case "decision":
			return findSpan(spans, "pi:D");
		case "choice":
			return findSpan(spans, "pi:C");
		case "abstain":
			return findSpan(spans, "pi:A");
		case "retry":
			return findSpan(spans, "pi:RD");
		case "retryAttempt1":
			return findSpan(spans, "attempt:RD2a");
		case "retryAttempt2":
			return findSpan(spans, "attempt:RD2b");
		case "gate":
			return byEventType("gate_start", "llm-review-advisories");
		case "gateStep":
			return byEventType("step_start", "justification:A1");
		case "step":
			return byEventType("step_start", "validate");
	}
}

function flatten(spans: TraceSpan[]): TraceSpan[] {
	return spans.flatMap((span) => [span, ...flatten(span.children ?? [])]);
}
