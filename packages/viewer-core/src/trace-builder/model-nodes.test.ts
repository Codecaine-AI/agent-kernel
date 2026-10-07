/**
 * model-nodes.test.ts — model-node spans (call / decision / step / gate) and
 * nested tool calls, through buildTraceSpans.
 *
 * Covers (plan §3.7, §4.9):
 *   - call/decision sessions render as node rows under their parent run
 *     (`run:<id>` wrapper, else the parent session's `pi:<id>` span)
 *   - gate checks (steps, decisions) fold under their gate; steps and gates
 *     attach by run_id; unknown parents stay roots
 *   - retry attempts: one node row per placement, attempt rows under it, the
 *     summary taken from the selected attempt
 *   - nested tools nest under their immediate parent tool span, any depth
 *   - sessions without a kind build exactly as before
 */
import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { buildTraceSpans } from "../build-trace-spans";
import {
  EventType,
  type AgentRun,
  type CallEndData,
  type CallStartData,
  type DecisionMadeData,
  type GateCheckRecord,
  type GateEndData,
  type GateStartData,
  type PiAgentSession,
  type StepEndData,
  type StepStartData,
  type ToolCallEndData,
  type ToolCallStartData,
  type TraceEvent,
} from "../types";

import fixture from "./__fixtures__/research-run.json";
import stateDemoFixture from "./__fixtures__/state-demo-run.json";
import { sortByEmissionOrder } from "./eventOrder";
import { selectAttemptIndex } from "./model-nodes";
import { pairEvents } from "./pairEvents";
import { statusFor } from "./spanAttributes";

// ─── Builders ───────────────────────────────────────────────────────────────

const CONTAINER_ID = "c-mn";
const WORKER = "W";
const T0 = Date.parse("2026-10-07T10:00:00.000Z");

function at(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

let seq = 0;

function ev(
  type: string,
  ms: number,
  eventData: object | null,
  envelope: Partial<TraceEvent> = {},
): TraceEvent {
  seq += 1;
  return {
    eventId: `ev-${String(seq).padStart(4, "0")}`,
    containerId: CONTAINER_ID,
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

function workerSession(kind?: PiAgentSession["kind"]): PiAgentSession {
  return {
    id: WORKER,
    containerId: CONTAINER_ID,
    ...(kind !== undefined && { kind }),
    agentName: "worker",
    status: "ended",
    createdAt: at(0),
    endedAt: at(10_000),
  };
}

function workerRun(id: string, startMs: number, endMs: number, trigger = "system"): AgentRun {
  return {
    id,
    piSessionId: WORKER,
    containerId: CONTAINER_ID,
    agentName: "worker",
    trigger,
    status: "done",
    startedAt: at(startMs),
    endedAt: at(endMs),
  };
}

/** One worker turn: the request snapshot and the reply it produced. */
function workerTurn(runId: string, ms: number, turn = 0): TraceEvent[] {
  const envelope = { runId, piSessionId: WORKER };
  return [
    ev(EventType.PI_REQUEST_SNAPSHOT, ms, { turn_number: turn, message_count: 1 }, envelope),
    ev(EventType.ASSISTANT_MESSAGE, ms + 5, { content: "done", block_type: "text" }, envelope),
  ];
}

type DecisionSpec =
  | { probability: number; passAt: number }
  | { abstainReason: "low-confidence" | "engine-error"; probability?: number };

interface NodeRunSpec {
  runId: string;
  parentRunId?: string;
  startMs: number;
  /** Absent: the run is still running (no call_end). */
  endMs?: number;
  endStatus?: CallEndData["status"];
  runStatus?: string;
  gateSpanId?: string;
  error?: CallEndData["error"];
  decision?: DecisionSpec;
  displayLabel?: string;
}

interface Trace {
  sessions: PiAgentSession[];
  runs: AgentRun[];
  events: TraceEvent[];
}

function decisionData(
  runId: string,
  name: string,
  spec: DecisionSpec,
  gateSpanId: string | undefined,
): DecisionMadeData {
  const base = {
    run_id: runId,
    decision_name: name,
    confidence_source: "native" as const,
    engine: "jev" as const,
    provider: "typesafe",
    model: "typesafe/jev-1.13.0",
    requested_model: "typesafe/jev-1.13.0",
    ...(gateSpanId !== undefined && { gate_span_id: gateSpanId }),
  };
  if ("passAt" in spec) {
    const p = spec.probability;
    const verdict = p >= spec.passAt ? ("pass" as const) : ("fail" as const);
    return {
      ...base,
      answers: {
        ok: {
          kind: "bool",
          choice: p >= 0.5 ? "true" : "false",
          probability: p,
          confidence: Math.max(p, 1 - p),
          confidenceSource: "native",
          verdict,
          abstained: false,
          thresholdApplied: { passAt: spec.passAt },
        },
      },
      chosen: verdict,
      abstained: false,
      threshold_applied: { ok: { passAt: spec.passAt } },
    };
  }
  return {
    ...base,
    answers: {
      ok: {
        kind: "bool",
        ...(spec.probability !== undefined && { probability: spec.probability }),
        confidenceSource: "native",
        abstained: true,
        abstainReason: spec.abstainReason,
        thresholdApplied: {},
      },
    },
    chosen: "abstain",
    abstained: true,
    abstain_reason: spec.abstainReason,
    threshold_applied: { ok: {} },
    ...(spec.abstainReason === "engine-error" && { error_kind: "http" }),
  };
}

function runStatusFor(spec: NodeRunSpec): string {
  if (spec.runStatus) return spec.runStatus;
  if (spec.endMs === undefined) return "running";
  if (spec.endStatus === "aborted") return "aborted";
  return spec.endStatus === "error" ? "error" : "done";
}

/** A call/decision session: per run call_start, one turn, decision_made, call_end. */
function nodeSession(
  kind: "call" | "decision",
  sessionId: string,
  name: string,
  specs: NodeRunSpec[],
): Trace {
  const session: PiAgentSession = {
    id: sessionId,
    containerId: CONTAINER_ID,
    kind,
    agentName: name,
    status: "ended",
    createdAt: at(specs[0].startMs),
  };
  const runs: AgentRun[] = [];
  const events: TraceEvent[] = [];
  specs.forEach((spec, i) => {
    const trigger = kind === "decision" ? "judge" : "post-run";
    runs.push({
      id: spec.runId,
      piSessionId: sessionId,
      containerId: CONTAINER_ID,
      parentRunId: spec.parentRunId ?? null,
      agentName: name,
      trigger,
      status: runStatusFor(spec),
      startedAt: at(spec.startMs),
      endedAt: spec.endMs === undefined ? null : at(spec.endMs),
    });
    const envelope = { runId: spec.runId, piSessionId: sessionId };
    const start: CallStartData = {
      run_id: spec.runId,
      node_kind: kind,
      function_name: name,
      engine: kind === "decision" ? "jev" : "baml",
      ...(kind === "call" && { transport: "baml-http" as const }),
      model: kind === "decision" ? "typesafe/jev-1.13.0" : "openai/gpt-5.4-mini",
      prompt_hash: kind === "decision" ? "dq1-abc" : "baml1-abc",
      input_blob_hash: `in-${spec.runId}`,
      trigger,
      ...(spec.parentRunId !== undefined && { parent_run_id: spec.parentRunId }),
      request_id: `req-${sessionId}`,
      attempt: i + 1,
      deadline_at: at(spec.startMs + 12_000),
      ...(spec.gateSpanId !== undefined && { gate_span_id: spec.gateSpanId }),
      ...(spec.displayLabel !== undefined && { display_label: spec.displayLabel }),
    };
    events.push(ev(EventType.CALL_START, spec.startMs, start, envelope));
    events.push(ev(EventType.PI_TURN_START, spec.startMs + 1, { turn_number: 0 }, envelope));
    events.push(
      ev(EventType.PI_REQUEST_SNAPSHOT, spec.startMs + 1, { turn_number: 0, message_count: 1 }, envelope),
    );
    if (spec.endMs === undefined) return;
    events.push(ev(EventType.PI_TURN_END, spec.endMs - 2, { turn_number: 0 }, envelope));
    if (kind === "decision" && spec.decision) {
      events.push(
        ev(
          EventType.DECISION_MADE,
          spec.endMs - 1,
          decisionData(spec.runId, name, spec.decision, spec.gateSpanId),
          envelope,
        ),
      );
    }
    const endStatus = spec.endStatus ?? "ok";
    const end: CallEndData = {
      run_id: spec.runId,
      node_kind: kind,
      function_name: name,
      status: endStatus,
      ...(endStatus === "ok" && { output_blob_hash: `out-${spec.runId}` }),
      ...(spec.error !== undefined && { error: spec.error }),
      usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0, model: start.model },
      attempts: 1,
      duration_ms: spec.endMs - spec.startMs,
      resolved_model: start.model,
      ...(spec.gateSpanId !== undefined && { gate_span_id: spec.gateSpanId }),
    };
    events.push(ev(EventType.CALL_END, spec.endMs, end, envelope));
  });
  return { sessions: [session], runs, events };
}

function step(
  spanId: string,
  name: string,
  startMs: number,
  endMs: number,
  opts: { runId?: string; gateSpanId?: string; parentEventId?: string; checkResult?: "pass" | "fail" | "abstain" } = {},
): TraceEvent[] {
  const envelope = {
    runId: opts.runId ?? null,
    spanId,
    ...(opts.parentEventId !== undefined && { parentEventId: opts.parentEventId }),
  };
  const startData: StepStartData = {
    step_name: name,
    ...(opts.runId !== undefined && { run_id: opts.runId }),
    ...(opts.gateSpanId !== undefined && { gate_span_id: opts.gateSpanId }),
  };
  const endData: StepEndData = {
    step_name: name,
    ...(opts.runId !== undefined && { run_id: opts.runId }),
    status: "ok",
    duration_ms: endMs - startMs,
    ...(opts.checkResult !== undefined && { check_result: opts.checkResult }),
    ...(opts.gateSpanId !== undefined && { gate_span_id: opts.gateSpanId }),
  };
  return [
    ev(EventType.STEP_START, startMs, startData, envelope),
    ev(EventType.STEP_END, endMs, endData, envelope),
  ];
}

function gate(
  spanId: string,
  name: string,
  startMs: number,
  endMs: number,
  runId: string | undefined,
  verdict: GateEndData["verdict"],
  checks: GateCheckRecord[],
): TraceEvent[] {
  const envelope = { runId: runId ?? null, spanId };
  const startData: GateStartData = {
    gate_name: name,
    ...(runId !== undefined && { run_id: runId }),
    checks: checks.map((check) => ({ name: check.name, kind: check.kind })),
  };
  const endData: GateEndData = {
    gate_name: name,
    ...(runId !== undefined && { run_id: runId }),
    verdict,
    checks,
    duration_ms: endMs - startMs,
  };
  return [
    ev(EventType.GATE_START, startMs, startData, envelope),
    ev(EventType.GATE_END, endMs, endData, envelope),
  ];
}

function merge(...parts: Trace[]): Trace {
  return {
    sessions: parts.flatMap((part) => part.sessions),
    runs: parts.flatMap((part) => part.runs),
    events: parts.flatMap((part) => part.events),
  };
}

function worker(runs: AgentRun[], events: TraceEvent[]): Trace {
  return { sessions: [workerSession()], runs, events };
}

function build(trace: Trace): TraceSpan[] {
  return buildTraceSpans(trace.events, trace.sessions, trace.runs);
}

// ─── Assertion helpers ──────────────────────────────────────────────────────

function findSpan(spans: TraceSpan[], id: string): TraceSpan | undefined {
  for (const span of spans) {
    if (span.id === id) return span;
    const inner = findSpan(span.children ?? [], id);
    if (inner) return inner;
  }
  return undefined;
}

function mustFind(spans: TraceSpan[], id: string): TraceSpan {
  const span = findSpan(spans, id);
  if (!span) throw new Error(`span ${id} not found`);
  return span;
}

/** The span holding `id` as a direct child; null when `id` is a root. */
function parentIdOf(spans: TraceSpan[], id: string, parent: TraceSpan | null = null): string | null | undefined {
  for (const span of spans) {
    if (span.id === id) return parent?.id ?? null;
    const inner = parentIdOf(span.children ?? [], id, span);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

function attr(span: TraceSpan, key: string): string | boolean | undefined {
  const value = span.attributes?.find((a) => a.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue;
}

function childEventTypes(span: TraceSpan): (string | boolean | undefined)[] {
  return (span.children ?? []).map((child) => attr(child, "event_type"));
}

function eventIdOf(events: TraceEvent[], type: string, runId?: string): string {
  const found = events.find((e) => e.type === type && (runId === undefined || e.runId === runId));
  if (!found) throw new Error(`no ${type} event`);
  return found.eventId;
}

// ─── Node placement ─────────────────────────────────────────────────────────

describe("model-node sessions (buildTraceSpans)", () => {
  it("a call session renders as one call_container under the parent agent span (single-run session)", () => {
    const call = nodeSession("call", "K", "ExtractCheckpointKnowledge", [
      { runId: "R2", parentRunId: "R1", startMs: 500, endMs: 700, displayLabel: "ExtractCheckpointKnowledge (R1)" },
    ]);
    const trace = merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), call);
    const spans = build(trace);

    expect(spans.map((s) => s.id)).toEqual([`pi:${WORKER}`]);
    expect(parentIdOf(spans, "pi:K")).toBe(`pi:${WORKER}`);

    const node = mustFind(spans, "pi:K");
    expect(node.title).toBe("ExtractCheckpointKnowledge (R1)");
    expect(node.type).toBe("llm_call");
    expect(node.status).toBe("success");
    expect(node.startTime.toISOString()).toBe(at(500));
    expect(node.endTime.toISOString()).toBe(at(700));
    expect(attr(node, "event_type")).toBe("call_container");
    expect(attr(node, "node_kind")).toBe("call");
    expect(attr(node, "function_name")).toBe("ExtractCheckpointKnowledge");
    expect(attr(node, "engine")).toBe("baml");
    expect(attr(node, "transport")).toBe("baml-http");
    expect(attr(node, "run_id")).toBe("R2");
    expect(attr(node, "parent_run_id")).toBe("R1");
    expect(attr(node, "trigger")).toBe("post-run");
    expect(attr(node, "output_blob_hash")).toBe("out-R2");
    expect(attr(node, "duration_ms")).toBe("200");

    // The worker's own turn comes first, then the call by start time.
    const workerSpan = mustFind(spans, `pi:${WORKER}`);
    expect(childEventTypes(workerSpan)).toEqual([EventType.PI_REQUEST_SNAPSHOT, "call_container"]);
  });

  it("…under run:<id> when the parent session has two runs", () => {
    const call = nodeSession("call", "K", "ExtractConfirmedCheckpointKnowledge", [
      { runId: "R6", parentRunId: "R5", startMs: 2500, endMs: 2600 },
    ]);
    const trace = merge(
      worker(
        [workerRun("R1", 0, 1000), workerRun("R5", 2000, 3000, "steer")],
        [...workerTurn("R1", 10), ...workerTurn("R5", 2010)],
      ),
      call,
    );
    const spans = build(trace);

    expect(parentIdOf(spans, "pi:K")).toBe("run:R5");
    expect(childEventTypes(mustFind(spans, "run:R5"))).toEqual([
      EventType.PI_REQUEST_SNAPSHOT,
      "call_container",
    ]);
    expect(childEventTypes(mustFind(spans, "run:R1"))).toEqual([EventType.PI_REQUEST_SNAPSHOT]);
  });

  it("a decision inside a gate folds under the gate span", () => {
    const gateEvents = gate("G", "llm-review-advisories", 100, 400, "R1", "pass", [
      { name: "justification:A1", kind: "step", result: "pass", step_span_id: "S" },
      {
        name: "JudgeAdvisory:A1",
        kind: "decide",
        result: "pass",
        questions: [{ question_id: "ok", result: "pass", run_id: "R3", probability: 0.91, pass_at: 0.85 }],
      },
    ]);
    const stepEvents = step("S", "justification:A1", 110, 120, {
      runId: "R1",
      gateSpanId: "G",
      parentEventId: gateEvents[0].eventId,
      checkResult: "pass",
    });
    const decision = nodeSession("decision", "D", "JudgeAdvisory", [
      {
        runId: "R3",
        parentRunId: "R1",
        startMs: 130,
        endMs: 300,
        gateSpanId: "G",
        decision: { probability: 0.91, passAt: 0.85 },
        displayLabel: "JudgeAdvisory:A1",
      },
    ]);
    const trace = merge(
      worker([workerRun("R1", 0, 1000)], [...workerTurn("R1", 10), ...gateEvents, ...stepEvents]),
      decision,
    );
    const spans = build(trace);

    const gateSpanId = gateEvents[0].eventId;
    const gateSpan = mustFind(spans, gateSpanId);
    expect(parentIdOf(spans, gateSpanId)).toBe(`pi:${WORKER}`);
    expect(gateSpan.title).toBe("llm-review-advisories");
    expect(gateSpan.type).toBe("guardrail");
    expect(gateSpan.status).toBe("success");
    expect(attr(gateSpan, "span_id")).toBe("G");
    expect(attr(gateSpan, "run_id")).toBe("R1");
    expect(attr(gateSpan, "verdict")).toBe("pass");
    expect(gateSpan.children?.map((c) => c.id)).toEqual([stepEvents[0].eventId, "pi:D"]);

    const stepSpan = mustFind(spans, stepEvents[0].eventId);
    expect(stepSpan.type).toBe("chain_operation");
    expect(attr(stepSpan, "check_result")).toBe("pass");

    const node = mustFind(spans, "pi:D");
    expect(attr(node, "event_type")).toBe("decision_container");
    expect(attr(node, "gate_span_id")).toBe("G");
    expect(attr(node, "chosen")).toBe("pass");
    expect(attr(node, "abstained")).toBe(false);
    expect(attr(node, "confidence_source")).toBe("native");
    expect(attr(node, "model")).toBe("typesafe/jev-1.13.0");
    const output = JSON.parse(node.output ?? "null") as DecisionMadeData;
    expect(output.answers.ok.probability).toBe(0.91);
    expect(output.answers.ok.verdict).toBe("pass");
  });

  it("steps attach by run_id; a run-less step stays root", () => {
    const scoped = step("S1", "validate", 200, 260, { runId: "R1" });
    const runless = step("S2", "stop", 300, 310);
    const spans = build(
      worker([workerRun("R1", 0, 1000)], [...workerTurn("R1", 10), ...scoped, ...runless]),
    );

    expect(parentIdOf(spans, scoped[0].eventId)).toBe(`pi:${WORKER}`);
    expect(parentIdOf(spans, runless[0].eventId)).toBeNull();
    const scopedSpan = mustFind(spans, scoped[0].eventId);
    expect(scopedSpan.title).toBe("validate");
    expect(scopedSpan.status).toBe("success");
    expect(scopedSpan.duration).toBe(60);
  });

  it("an unknown parentRunId leaves the node at the root", () => {
    const call = nodeSession("call", "K", "Orphaned", [
      { runId: "R9", parentRunId: "missing-run", startMs: 500, endMs: 600 },
    ]);
    const spans = build(merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), call));

    expect(spans.map((s) => s.id)).toEqual([`pi:${WORKER}`, "pi:K"]);
  });

  it("single-run sessions render exactly as before attempts existed", () => {
    const call = nodeSession("call", "K", "ExtractCheckpointKnowledge", [
      { runId: "R2", parentRunId: "R1", startMs: 500, endMs: 700 },
    ]);
    const spans = build(merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), call));
    const node = mustFind(spans, "pi:K");

    // Lifecycle events are absorbed; only the run's turn spans remain, and no attempt rows.
    expect(childEventTypes(node)).toEqual([
      EventType.PI_TURN_START,
      EventType.PI_REQUEST_SNAPSHOT,
      EventType.PI_TURN_END,
    ]);
    expect(attr(node, "attempt_count")).toBeUndefined();
    expect(attr(node, "selected_attempt")).toBeUndefined();
    expect(findSpan(spans, "attempt:R2")).toBeUndefined();
  });

  it("a failed call shows its error, and an abstained decision is a warning", () => {
    const failed = nodeSession("call", "F", "ExtractCheckpointKnowledge", [
      {
        runId: "RF",
        parentRunId: "R1",
        startMs: 200,
        endMs: 260,
        endStatus: "error",
        error: { kind: "parse", message: "ExtractCheckpointKnowledge failed: parse" },
      },
    ]);
    const abstained = nodeSession("decision", "A", "JudgeAdvisory", [
      {
        runId: "RA",
        parentRunId: "R1",
        startMs: 300,
        endMs: 360,
        decision: { abstainReason: "low-confidence", probability: 0.52 },
      },
    ]);
    const spans = build(
      merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), failed, abstained),
    );

    const failedNode = mustFind(spans, "pi:F");
    expect(failedNode.status).toBe("error");
    expect(attr(failedNode, "status")).toBe("error");
    expect(attr(failedNode, "error_kind")).toBe("parse");

    const abstainedNode = mustFind(spans, "pi:A");
    expect(abstainedNode.status).toBe("warning");
    expect(attr(abstainedNode, "abstained")).toBe(true);
    expect(attr(abstainedNode, "abstain_reason")).toBe("low-confidence");
  });
});

// ─── Retry attempts ─────────────────────────────────────────────────────────

describe("model-node retry attempts (buildTraceSpans)", () => {
  it("failed → successful decision renders one node row with two attempt rows; the summary shows attempt 2's verdict and the gate keeps both attempts", () => {
    const gateEvents = gate("G", "llm-review-advisories", 100, 900, "R1", "pass", [
      {
        name: "JudgeAdvisory:A2",
        kind: "decide",
        result: "pass",
        questions: [{ question_id: "ok", result: "pass", run_id: "A2", probability: 0.88, pass_at: 0.85 }],
      },
    ]);
    const decision = nodeSession("decision", "D2", "JudgeAdvisory", [
      {
        runId: "A1",
        parentRunId: "R1",
        startMs: 200,
        endMs: 300,
        endStatus: "error",
        gateSpanId: "G",
        error: { kind: "http", message: "JudgeAdvisory failed: http", http_status: 503 },
        decision: { abstainReason: "engine-error" },
        displayLabel: "JudgeAdvisory:A2",
      },
      {
        runId: "A2",
        parentRunId: "R1",
        startMs: 400,
        endMs: 600,
        gateSpanId: "G",
        decision: { probability: 0.88, passAt: 0.85 },
        displayLabel: "JudgeAdvisory:A2",
      },
    ]);
    const trace = merge(
      worker([workerRun("R1", 0, 1000)], [...workerTurn("R1", 10), ...gateEvents]),
      decision,
    );
    const spans = build(trace);

    const gateSpanId = gateEvents[0].eventId;
    expect(mustFind(spans, gateSpanId).children?.map((c) => c.id)).toEqual(["pi:D2"]);

    const node = mustFind(spans, "pi:D2");
    expect(node.title).toBe("JudgeAdvisory:A2");
    expect(node.children?.map((c) => c.id)).toEqual(["attempt:A1", "attempt:A2"]);
    expect(node.status).toBe("success");
    expect(attr(node, "event_type")).toBe("decision_container");
    expect(attr(node, "run_id")).toBe("A2");
    expect(attr(node, "attempt_count")).toBe("2");
    expect(attr(node, "selected_attempt")).toBe("2");
    expect(attr(node, "chosen")).toBe("pass");
    expect(node.startTime.toISOString()).toBe(at(200));
    expect(node.endTime.toISOString()).toBe(at(600));
    const summary = JSON.parse(node.output ?? "null") as DecisionMadeData;
    expect(summary.run_id).toBe("A2");
    expect(summary.answers.ok.verdict).toBe("pass");

    const [first, second] = node.children ?? [];
    expect(first.title).toBe("attempt 1");
    expect(first.status).toBe("error");
    expect(attr(first, "event_type")).toBe("decision_attempt");
    expect(attr(first, "run_id")).toBe("A1");
    expect(attr(first, "abstain_reason")).toBe("engine-error");
    expect(attr(first, "error_kind")).toBe("http");
    expect(attr(first, "attempt_number")).toBe("1");
    expect(attr(first, "gate_span_id")).toBe("G");
    expect(second.title).toBe("attempt 2");
    expect(second.status).toBe("success");
    expect(attr(second, "run_id")).toBe("A2");
    expect(attr(second, "attempt_count")).toBe("2");

    // Each attempt holds only its own run's turns.
    const snapshotA1 = eventIdOf(trace.events, EventType.PI_REQUEST_SNAPSHOT, "A1");
    const snapshotA2 = eventIdOf(trace.events, EventType.PI_REQUEST_SNAPSHOT, "A2");
    expect(parentIdOf(spans, snapshotA1)).toBe("attempt:A1");
    expect(parentIdOf(spans, snapshotA2)).toBe("attempt:A2");
  });

  it("stale → recovered call renders the aborted (abandoned) attempt and the done attempt; summary from the done attempt", () => {
    const call = nodeSession("call", "K2", "ExtractConfirmedCheckpointKnowledge", [
      {
        runId: "A1",
        parentRunId: "R5",
        startMs: 2100,
        endMs: 2400,
        endStatus: "aborted",
        error: { kind: "abandoned", message: "run was still running past its operation deadline; recovered" },
      },
      { runId: "A2", parentRunId: "R5", startMs: 2400, endMs: 2700 },
    ]);
    const trace = merge(
      worker(
        [workerRun("R1", 0, 1000), workerRun("R5", 2000, 3000, "steer")],
        [...workerTurn("R1", 10), ...workerTurn("R5", 2010)],
      ),
      call,
    );
    const spans = build(trace);

    expect(parentIdOf(spans, "pi:K2")).toBe("run:R5");
    const node = mustFind(spans, "pi:K2");
    expect(node.children?.map((c) => c.id)).toEqual(["attempt:A1", "attempt:A2"]);
    expect(node.status).toBe("success");
    expect(attr(node, "run_id")).toBe("A2");
    expect(attr(node, "output_blob_hash")).toBe("out-A2");
    expect(attr(node, "selected_attempt")).toBe("2");

    const abandoned = mustFind(spans, "attempt:A1");
    expect(abandoned.status).toBe("warning");
    expect(attr(abandoned, "event_type")).toBe("call_attempt");
    expect(attr(abandoned, "status")).toBe("aborted");
    expect(attr(abandoned, "error_kind")).toBe("abandoned");
    expect(mustFind(spans, "attempt:A2").status).toBe("success");
  });

  it("a session whose attempts have different parent runs renders one node row under each parent", () => {
    const call = nodeSession("call", "K3", "ExtractCheckpointKnowledge", [
      { runId: "A1", parentRunId: "R1", startMs: 500, endMs: 600, endStatus: "error", error: { kind: "parse", message: "x failed: parse" } },
      { runId: "A2", parentRunId: "R5", startMs: 2500, endMs: 2600 },
    ]);
    const trace = merge(
      worker(
        [workerRun("R1", 0, 1000), workerRun("R5", 2000, 3000, "steer")],
        [...workerTurn("R1", 10), ...workerTurn("R5", 2010)],
      ),
      call,
    );
    const spans = build(trace);

    expect(findSpan(spans, "pi:K3")).toBeUndefined();
    expect(parentIdOf(spans, "run:A1")).toBe("run:R1");
    expect(parentIdOf(spans, "run:A2")).toBe("run:R5");

    const underR1 = mustFind(spans, "run:A1");
    expect(attr(underR1, "event_type")).toBe("call_container");
    expect(attr(underR1, "run_id")).toBe("A1");
    expect(attr(underR1, "parent_run_id")).toBe("R1");
    expect(underR1.status).toBe("error");
    expect(attr(underR1, "attempt_count")).toBeUndefined();

    const underR5 = mustFind(spans, "run:A2");
    expect(attr(underR5, "run_id")).toBe("A2");
    expect(underR5.status).toBe("success");
    expect(childEventTypes(underR5)).not.toContain("call_attempt");
  });

  it("summary falls back to the latest attempt when none is done; a running latest attempt shows pending", () => {
    const decision = nodeSession("decision", "D3", "ContinueOrStop", [
      {
        runId: "A1",
        parentRunId: "R1",
        startMs: 200,
        endMs: 260,
        endStatus: "error",
        error: { kind: "http", message: "ContinueOrStop failed: http" },
        decision: { abstainReason: "engine-error" },
      },
      { runId: "A2", parentRunId: "R1", startMs: 300 },
    ]);
    const spans = build(merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), decision));
    const node = mustFind(spans, "pi:D3");

    expect(node.status).toBe("pending");
    expect(attr(node, "run_id")).toBe("A2");
    expect(attr(node, "selected_attempt")).toBe("2");
    expect(mustFind(spans, "attempt:A2").status).toBe("pending");
  });

  it("spans owned by a retried node run attach to that attempt's own row, across placements", () => {
    // K: attempts A1, A2 under R1 (one row, two attempt rows) and B1 under R5.
    const retried = nodeSession("decision", "K", "JudgeAdvisory", [
      {
        runId: "A1",
        parentRunId: "R1",
        startMs: 200,
        endMs: 300,
        endStatus: "error",
        error: { kind: "http", message: "JudgeAdvisory failed: http" },
        decision: { abstainReason: "engine-error" },
      },
      { runId: "A2", parentRunId: "R1", startMs: 400, endMs: 800, decision: { probability: 0.9, passAt: 0.85 } },
      { runId: "B1", parentRunId: "R5", startMs: 2100, endMs: 2600, decision: { probability: 0.9, passAt: 0.85 } },
    ]);
    // Children owned by K's runs: a call under the second attempt, a step
    // under the first, and a gate under the R5 placement's run.
    const childOfA2 = nodeSession("call", "C", "ExtractCheckpointKnowledge", [
      { runId: "C1", parentRunId: "A2", startMs: 500, endMs: 600 },
    ]);
    const stepOfA1 = step("S", "validate", 250, 260, { runId: "A1" });
    const gateOfB1 = gate("G", "review", 2200, 2300, "B1", "pass", []);
    const trace = merge(
      worker(
        [workerRun("R1", 0, 1000), workerRun("R5", 2000, 3000, "steer")],
        [...workerTurn("R1", 10), ...workerTurn("R5", 2010), ...stepOfA1, ...gateOfB1],
      ),
      retried,
      childOfA2,
    );
    const spans = build(trace);

    expect(parentIdOf(spans, "run:A1")).toBe("run:R1");
    expect(mustFind(spans, "run:A1").children?.map((c) => c.id)).toEqual(["attempt:A1", "attempt:A2"]);
    expect(parentIdOf(spans, "run:B1")).toBe("run:R5");

    expect(parentIdOf(spans, "pi:C")).toBe("attempt:A2");
    expect(parentIdOf(spans, stepOfA1[0].eventId)).toBe("attempt:A1");
    expect(parentIdOf(spans, gateOfB1[0].eventId)).toBe("run:B1");
    expect(spans.map((s) => s.id)).toEqual([`pi:${WORKER}`]);
  });

  it("a child of the selected attempt lands on the attempt row, not the summary row", () => {
    const retried = nodeSession("call", "K", "ExtractConfirmedCheckpointKnowledge", [
      { runId: "A1", parentRunId: "R1", startMs: 200, endMs: 300, endStatus: "error", error: { kind: "parse", message: "x failed: parse" } },
      { runId: "A2", parentRunId: "R1", startMs: 400, endMs: 800 },
    ]);
    const childOfA2 = nodeSession("call", "C", "SummarizeWorkerRun", [
      { runId: "C1", parentRunId: "A2", startMs: 500, endMs: 600 },
    ]);
    const spans = build(
      merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), retried, childOfA2),
    );

    expect(attr(mustFind(spans, "pi:K"), "run_id")).toBe("A2");
    expect(parentIdOf(spans, "pi:C")).toBe("attempt:A2");
  });

  it("selectAttemptIndex: latest done run, else the latest run", () => {
    const runs = (...statuses: string[]) =>
      statuses.map((status) => ({ run: { status } as AgentRun }));
    expect(selectAttemptIndex(runs("error", "done"))).toBe(1);
    expect(selectAttemptIndex(runs("done", "error"))).toBe(0);
    expect(selectAttemptIndex(runs("done", "aborted", "done", "error"))).toBe(2);
    expect(selectAttemptIndex(runs("error", "aborted"))).toBe(1);
    expect(selectAttemptIndex(runs("aborted", "running"))).toBe(1);
  });
});

// ─── Nested tool calls ──────────────────────────────────────────────────────

describe("nested tool calls (buildTraceSpans)", () => {
  type ToolTiming = "live" | "approximate";

  function toolStart(ms: number, id: string, name: string, parent?: string, timing?: ToolTiming): TraceEvent {
    const data: ToolCallStartData = {
      tool_use_id: id,
      tool_name: name,
      tool_input: { raw: {} },
      ...(parent !== undefined && { parent_tool_use_id: parent, nested: true as const }),
      ...(timing !== undefined && { timing }),
    };
    return ev(EventType.TOOL_CALL_START, ms, data, { runId: "R1", piSessionId: WORKER, spanId: id });
  }

  function toolEnd(
    ms: number,
    id: string,
    name: string,
    parent?: string,
    timing?: ToolTiming,
    nestedStatus?: ToolCallEndData["nested_status"],
  ): TraceEvent {
    const data: ToolCallEndData = {
      tool_use_id: id,
      tool_name: name,
      tool_output: `${name} output`,
      ...(parent !== undefined && {
        parent_tool_use_id: parent,
        nested: true as const,
        nested_status: nestedStatus ?? "ok",
      }),
      ...(timing !== undefined && { timing }),
    };
    return ev(EventType.TOOL_CALL_END, ms, data, { runId: "R1", piSessionId: WORKER, spanId: id });
  }

  function turnWith(toolEvents: TraceEvent[]): Trace {
    const envelope = { runId: "R1", piSessionId: WORKER };
    return worker(
      [workerRun("R1", 0, 1000)],
      [
        ev(EventType.PI_REQUEST_SNAPSHOT, 10, { turn_number: 0, message_count: 1 }, envelope),
        ...toolEvents,
        ev(EventType.ASSISTANT_MESSAGE, 200, { content: "done", block_type: "text" }, envelope),
      ],
    );
  }

  /** [title, children] of the turn's tool subtree, for compact assertions. */
  function toolTree(spans: TraceSpan[]): unknown[] {
    return spans
      .filter((span) => span.type === "tool_execution")
      .map((span) => [span.title, toolTree(span.children ?? [])]);
  }

  function turnSpan(spans: TraceSpan[], events: TraceEvent[]): TraceSpan {
    return mustFind(spans, eventIdOf(events, EventType.PI_REQUEST_SNAPSHOT));
  }

  it("nested tools nest under codemode", () => {
    const trace = turnWith([
      toolStart(20, "c", "codemode"),
      toolStart(30, "c/1", "read", "c", "live"),
      toolEnd(40, "c/1", "read", "c", "live"),
      toolStart(50, "c/2", "bash", "c", "live"),
      toolEnd(60, "c/2", "bash", "c", "live", "unfinished"),
      toolEnd(100, "c", "codemode"),
    ]);
    const spans = build(trace);
    const turn = turnSpan(spans, trace.events);

    expect(toolTree(turn.children ?? [])).toEqual([["codemode", [["read", []], ["bash", []]]]]);
    const bashStart = trace.events.find(
      (e) => e.type === EventType.TOOL_CALL_START && e.spanId === "c/2",
    );
    const bash = mustFind(spans, bashStart?.eventId ?? "");
    expect(attr(bash, "parent_tool_use_id")).toBe("c");
    expect(attr(bash, "nested_status")).toBe("unfinished");
  });

  it("three-level chain codemode → wrapper → read nests three deep for live, backfill and mixed events", () => {
    const expected = [["codemode", [["wrapper", [["read", []]]]]]];

    // Live: starts as they happen, ends in completion order.
    const live = turnWith([
      toolStart(20, "c", "codemode"),
      toolStart(30, "c/1", "wrapper", "c", "live"),
      toolStart(40, "c/1/1", "read", "c/1", "live"),
      toolEnd(50, "c/1/1", "read", "c/1", "live"),
      toolEnd(60, "c/1", "wrapper", "c", "live"),
      toolEnd(100, "c", "codemode"),
    ]);
    // Backfill only: rows rebuilt from the parent's nestedCalls at its result
    // time (ends at 100, starts = end − duration), deepest record first.
    const backfill = turnWith([
      toolStart(20, "c", "codemode"),
      toolEnd(100, "c", "codemode"),
      toolStart(90, "c/1/1", "read", "c/1", "approximate"),
      toolEnd(100, "c/1/1", "read", "c/1", "approximate"),
      toolStart(30, "c/1", "wrapper", "c", "approximate"),
      toolEnd(100, "c/1", "wrapper", "c", "approximate"),
    ]);
    // Live starts with approximate ends.
    const mixed = turnWith([
      toolStart(20, "c", "codemode"),
      toolStart(30, "c/1", "wrapper", "c", "live"),
      toolStart(40, "c/1/1", "read", "c/1", "live"),
      toolEnd(100, "c", "codemode"),
      toolEnd(100, "c/1/1", "read", "c/1", "approximate"),
      toolEnd(100, "c/1", "wrapper", "c", "approximate"),
    ]);

    for (const trace of [live, backfill, mixed]) {
      const spans = build(trace);
      const turn = turnSpan(spans, trace.events);
      expect(toolTree(turn.children ?? [])).toEqual(expected);
      const read = (turn.children ?? [])
        .flatMap((codemode) => codemode.children ?? [])
        .flatMap((wrapper) => wrapper.children ?? [])[0];
      expect(attr(read, "parent_tool_use_id")).toBe("c/1");
      expect(attr(read, "tool_use_id")).toBe("c/1/1");
    }
  });

  it("a nested tool whose parent is missing stays where it was", () => {
    const trace = turnWith([
      toolStart(20, "c", "codemode"),
      toolEnd(30, "c", "codemode"),
      toolStart(40, "x/1", "read", "x", "approximate"),
      toolEnd(50, "x/1", "read", "x", "approximate"),
    ]);
    const spans = build(trace);
    const turn = turnSpan(spans, trace.events);

    expect(toolTree(turn.children ?? [])).toEqual([
      ["codemode", []],
      ["read", []],
    ]);
  });
});

// ─── Ordering, pairing, specs ───────────────────────────────────────────────

describe("model-node events: order, pairing, status", () => {
  it("same-millisecond node events order by rank", () => {
    const envelope = { runId: "R3", piSessionId: "D" };
    const ordered = [
      ev(EventType.GATE_START, 0, { gate_name: "g", checks: [] }, { spanId: "G" }),
      ev(EventType.STEP_START, 0, { step_name: "s" }, { spanId: "S" }),
      ev(EventType.CALL_START, 0, { run_id: "R3" }, envelope),
      ev(EventType.PI_TURN_START, 0, { turn_number: 0 }, envelope),
      ev(EventType.PI_REQUEST_SNAPSHOT, 0, { turn_number: 0, message_count: 1 }, envelope),
      ev(EventType.PI_TURN_END, 0, { turn_number: 0 }, envelope),
      ev(EventType.DECISION_MADE, 0, { run_id: "R3", decision_name: "d" }, envelope),
      ev(EventType.CALL_END, 0, { run_id: "R3", status: "ok" }, envelope),
      ev(EventType.STEP_END, 0, { step_name: "s", status: "ok" }, { spanId: "S" }),
      ev(EventType.GATE_END, 0, { gate_name: "g", verdict: "pass", checks: [] }, { spanId: "G" }),
    ];
    // Reverse the ids so an id tie-break would invert the order.
    const shuffled = ordered
      .map((event, i) => ({ ...event, eventId: `z-${String(ordered.length - i).padStart(2, "0")}` }))
      .reverse();
    expect(sortByEmissionOrder(shuffled).map((e) => e.type)).toEqual(ordered.map((e) => e.type));

    // A decision whose events share one millisecond still absorbs its pair.
    const decision = nodeSession("decision", "D", "JudgeAdvisory", [
      { runId: "R3", parentRunId: "R1", startMs: 300, endMs: 300, decision: { probability: 0.9, passAt: 0.85 } },
    ]);
    for (const event of decision.events) event.timestamp = at(300);
    const spans = build(merge(worker([workerRun("R1", 0, 1000)], workerTurn("R1", 10)), decision));
    const node = mustFind(spans, "pi:D");
    expect(node.status).toBe("success");
    expect(attr(node, "chosen")).toBe("pass");
    expect(childEventTypes(node)).toEqual([
      EventType.PI_TURN_START,
      EventType.PI_REQUEST_SNAPSHOT,
      EventType.PI_TURN_END,
    ]);
  });

  it("pairs call_start/call_end by run_id and step/gate events by span id", () => {
    const events = [
      ev(EventType.CALL_START, 0, { run_id: "A" }),
      ev(EventType.CALL_START, 1, { run_id: "B" }),
      ev(EventType.STEP_START, 2, { step_name: "s1" }, { spanId: "S1" }),
      ev(EventType.STEP_START, 3, { step_name: "s2" }, { spanId: "S2" }),
      ev(EventType.CALL_END, 4, { run_id: "B", status: "ok" }),
      ev(EventType.STEP_END, 5, { step_name: "s1", status: "ok" }, { spanId: "S1" }),
      ev(EventType.CALL_END, 6, { run_id: "A", status: "ok" }),
      ev(EventType.STEP_END, 7, { step_name: "s2", status: "ok" }, { spanId: "S2" }),
      ev(EventType.GATE_START, 8, { gate_name: "g", checks: [] }, { spanId: "G" }),
      ev(EventType.GATE_END, 9, { gate_name: "g", verdict: "pass", checks: [] }, { spanId: "G" }),
      ev(EventType.CALL_END, 10, { run_id: "unknown", status: "ok" }),
    ];
    const paired = pairEvents(events).map((p) =>
      p.kind === "pair" ? [p.start.eventId, p.end.eventId] : p.event.eventId,
    );
    const id = (i: number) => events[i].eventId;
    expect(paired).toEqual([
      [id(0), id(6)],
      [id(1), id(4)],
      [id(2), id(5)],
      [id(3), id(7)],
      [id(8), id(9)],
      id(10),
    ]);
  });

  it("span status: call_end status, step check results, gate verdicts, abstained decisions", () => {
    const pairStatus = (startType: string, endType: string, endData: object) =>
      statusFor({ kind: "pair", start: ev(startType, 0, {}), end: ev(endType, 1, endData) });

    expect(pairStatus(EventType.CALL_START, EventType.CALL_END, { status: "ok" })).toBe("success");
    expect(pairStatus(EventType.CALL_START, EventType.CALL_END, { status: "error" })).toBe("error");
    expect(pairStatus(EventType.CALL_START, EventType.CALL_END, { status: "aborted" })).toBe("warning");

    expect(pairStatus(EventType.STEP_START, EventType.STEP_END, { status: "ok" })).toBe("success");
    expect(pairStatus(EventType.STEP_START, EventType.STEP_END, { status: "ok", check_result: "pass" })).toBe("success");
    expect(pairStatus(EventType.STEP_START, EventType.STEP_END, { status: "ok", check_result: "fail" })).toBe("error");
    expect(pairStatus(EventType.STEP_START, EventType.STEP_END, { status: "ok", check_result: "abstain" })).toBe("warning");
    expect(pairStatus(EventType.STEP_START, EventType.STEP_END, { status: "error" })).toBe("error");

    expect(pairStatus(EventType.GATE_START, EventType.GATE_END, { verdict: "pass" })).toBe("success");
    expect(pairStatus(EventType.GATE_START, EventType.GATE_END, { verdict: "fail" })).toBe("error");
    expect(pairStatus(EventType.GATE_START, EventType.GATE_END, { verdict: "abstain" })).toBe("warning");

    const decision = (abstained: boolean) =>
      statusFor({ kind: "point", event: ev(EventType.DECISION_MADE, 0, { abstained }) });
    expect(decision(false)).toBe("success");
    expect(decision(true)).toBe("warning");
  });
});

// ─── Unchanged paths ────────────────────────────────────────────────────────

describe("sessions without kind (buildTraceSpans)", () => {
  /** Agent spans serialize their input session into `raw`; drop the kind added to the input. */
  function withoutSessionKind(spans: TraceSpan[]): TraceSpan[] {
    return spans.map((span) => {
      let raw = span.raw;
      if (span.id.startsWith("pi:")) {
        const { kind: _kind, ...session } = JSON.parse(span.raw) as Record<string, unknown>;
        raw = JSON.stringify(session);
      }
      return { ...span, raw, children: span.children && withoutSessionKind(span.children) };
    });
  }

  it("sessions without kind build exactly as before", () => {
    const cases = [
      {
        events: fixture.events as TraceEvent[],
        sessions: fixture.pi_sessions as PiAgentSession[],
        runs: fixture.agent_runs as AgentRun[],
      },
      {
        events: stateDemoFixture.events as TraceEvent[],
        sessions: stateDemoFixture.pi_sessions as PiAgentSession[],
        runs: stateDemoFixture.agent_runs as AgentRun[],
      },
    ];
    for (const { events, sessions, runs } of cases) {
      expect(sessions.every((session) => session.kind === undefined)).toBe(true);
      const baseline = buildTraceSpans(events, sessions, runs);
      for (const kind of ["pi", null] as const) {
        const withKind = sessions.map((session) => ({ ...session, kind }));
        const built = buildTraceSpans(events, withKind, runs);
        expect(withoutSessionKind(built)).toEqual(withoutSessionKind(baseline));
        // Same tree shape and ids before any normalization.
        expect(JSON.stringify(built, ["id", "children"])).toBe(
          JSON.stringify(baseline, ["id", "children"]),
        );
      }
    }
  });
});
