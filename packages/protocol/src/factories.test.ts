import { describe, expect, test } from "bun:test";

import {
  createAgentRunEndEvent,
  createAppEvent,
  createAgentRunStartEvent,
  createAgentSessionStartEvent,
  createCallEndEvent,
  createCallStartEvent,
  createDecisionMadeEvent,
  createGateEndEvent,
  createGateStartEvent,
  createPiRequestSnapshotEvent,
  createPiTurnEndEvent,
  createPiTurnStartEvent,
  createStepEndEvent,
  createStepStartEvent,
  createToolCallEndEvent,
  createToolCallStartEvent,
  createUserMessageEvent,
  type TraceEventIds,
} from "./factories";
import type { TraceEvent } from "./envelope";
import {
  EventType,
  TraceLevel,
  type AgentRunEndData,
  type CallEndData,
  type CallStartData,
  type DecisionMadeData,
  type GateEndData,
  type GateStartData,
  type PiRequestSnapshotData,
  type PiTurnEndData,
  type StepEndData,
  type StepStartData,
} from "./types";

const ids: TraceEventIds = {
  containerId: "container-1",
  runId: "run-1",
  userId: "user-1",
  agentId: "agent-1",
  piSessionUuid: "pi-uuid-1",
};

describe("factories envelope identity", () => {
  test("stamps containerId, runId, userId, agentId, piSessionUuid from ids", () => {
    const event = createToolCallStartEvent(ids, "read", "toolu_1", {
      toolInput: { path: "/tmp/x" },
    });
    expect(event.containerId).toBe("container-1");
    expect(event.runId).toBe("run-1");
    expect(event.userId).toBe("user-1");
    expect(event.agentId).toBe("agent-1");
    expect(event.piSessionUuid).toBe("pi-uuid-1");
    expect(event.traceLevel).toBe(TraceLevel.PROCESSING);
  });

  test("only containerId is required; optional ids stay undefined", () => {
    const event = createUserMessageEvent({ containerId: "c" }, "hello", "build");
    expect(event.containerId).toBe("c");
    expect(event.runId).toBeUndefined();
    expect(event.userId).toBeUndefined();
    expect(event.agentId).toBeUndefined();
    expect("piSessionUuid" in event).toBe(false);
    expect(event.traceLevel).toBe(TraceLevel.SUMMARY);
  });

  test("envelope carries no appSessionId key", () => {
    const event = createAgentSessionStartEvent(ids, "coordinator", "gpt-5");
    expect(Object.keys(event)).not.toContain("appSessionId");
  });
});

describe("run lifecycle factories", () => {
  test("run start mirrors runId + containerId into eventData", () => {
    const event = createAgentRunStartEvent(
      { containerId: "c1", runId: "r1" },
      "scout",
      { parentRunId: "r0", parentToolUseId: "toolu_9" },
    );
    expect(event.type).toBe(EventType.AGENT_RUN_START);
    expect(event.runId).toBe("r1");
    const data = event.eventData as Record<string, unknown>;
    expect(data.run_id).toBe("r1");
    expect(data.container_id).toBe("c1");
    expect(data.parent_run_id).toBe("r0");
    expect(data.parent_tool_use_id).toBe("toolu_9");
    expect(event.traceLevel).toBe(TraceLevel.DEBUG);
  });

  test("run end carries usage rollup when provided", () => {
    const event = createAgentRunEndEvent(
      { containerId: "c1", runId: "r1" },
      "scout",
      "ok",
      {
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
          model: "gpt-5",
          costEstimate: 0.01,
        },
      },
    );
    const data = event.eventData as AgentRunEndData;
    expect(data.status).toBe("ok");
    expect(data.usage?.inputTokens).toBe(100);
    expect(data.usage?.model).toBe("gpt-5");
  });
});

describe("pi turn usage", () => {
  test("pi_turn_end carries per-turn usage", () => {
    const event = createPiTurnEndEvent(ids, {
      turnNumber: 3,
      stopReason: "end_turn",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 1,
        model: "gpt-5-mini",
      },
    });
    expect(event.type).toBe(EventType.PI_TURN_END);
    const data = event.eventData as PiTurnEndData;
    expect(data.turn_number).toBe(3);
    expect(data.usage?.cacheWriteTokens).toBe(1);
    expect(event.traceLevel).toBe(TraceLevel.INTERNAL);
  });
});

describe("tool call result errors", () => {
  test("emits is_error only for errored tool results", () => {
    const errored = createToolCallEndEvent(ids, "layout", "toolu_error", {
      isError: true,
    });
    const ordinary = createToolCallEndEvent(ids, "layout", "toolu_ok");

    expect(errored.eventData).toHaveProperty("is_error", true);
    expect(ordinary.eventData).not.toHaveProperty("is_error");
  });
});

describe("event catalog", () => {
  test("ask events are gone from the core catalog", () => {
    expect(Object.values(EventType)).not.toContain("ui_ask_requested");
    expect(Object.values(EventType)).not.toContain("ui_ask_answered");
  });

  test("catalog lists the seven model-node event types", () => {
    // These strings are persisted in trace_events.type and keyed on by the viewer.
    expect({
      CALL_START: EventType.CALL_START,
      CALL_END: EventType.CALL_END,
      DECISION_MADE: EventType.DECISION_MADE,
      STEP_START: EventType.STEP_START,
      STEP_END: EventType.STEP_END,
      GATE_START: EventType.GATE_START,
      GATE_END: EventType.GATE_END,
    }).toEqual({
      CALL_START: "call_start",
      CALL_END: "call_end",
      DECISION_MADE: "decision_made",
      STEP_START: "step_start",
      STEP_END: "step_end",
      GATE_START: "gate_start",
      GATE_END: "gate_end",
    });
  });
});

describe("model-node factories", () => {
  const nodeIds = { containerId: "c1", runId: "node-run-1", piSessionUuid: "node-session-1" };
  const stepIds: TraceEventIds = { containerId: "c1", runId: "parent-run-1" };
  const callStart: CallStartData = {
    run_id: "node-run-1",
    node_kind: "call",
    function_name: "ExtractCheckpointKnowledge",
    engine: "baml",
    transport: "baml-http",
    model: "codex-lb/gpt-5.6-sol",
    prompt_hash: "baml1-abc",
    input_blob_hash: "b1-in",
    trigger: "post-run",
    deadline_at: "2026-10-07T00:02:00.000Z",
  };
  const callEnd: CallEndData = {
    run_id: "node-run-1",
    node_kind: "call",
    function_name: "ExtractCheckpointKnowledge",
    status: "ok",
    attempts: 1,
    duration_ms: 1800,
  };
  const decisionMade: DecisionMadeData = {
    run_id: "node-run-1",
    decision_name: "advisory",
    answers: {
      keep: {
        kind: "bool",
        choice: "true",
        probability: 0.91,
        confidence: 0.91,
        confidenceSource: "native",
        verdict: "pass",
        abstained: false,
        thresholdApplied: { passAt: 0.85, failAt: 0.15 },
      },
    },
    chosen: "true",
    confidence_source: "native",
    abstained: false,
    threshold_applied: { keep: { passAt: 0.85, failAt: 0.15 } },
    engine: "jev",
    provider: "typesafe",
    model: "typesafe/jev-1.13.0",
    requested_model: "typesafe/jev-latest",
  };
  const stepStart: StepStartData = { step_name: "lint" };
  const stepEnd: StepEndData = { step_name: "lint", status: "ok", duration_ms: 4 };
  const gateStart: GateStartData = { gate_name: "accept", checks: [{ name: "lint", kind: "step" }] };
  const gateEnd: GateEndData = {
    gate_name: "accept",
    verdict: "pass",
    checks: [{ name: "lint", kind: "step", result: "pass" }],
    duration_ms: 9,
  };

  const opts = { eventId: "evt-fixed", timestamp: "2026-10-07T00:00:00.001Z", spanId: "span-1" };
  const cases: Array<[string, (o: typeof opts) => TraceEvent, string, unknown]> = [
    [EventType.CALL_START, (o) => createCallStartEvent(nodeIds, callStart, o), "node-run-1", callStart],
    [EventType.CALL_END, (o) => createCallEndEvent(nodeIds, callEnd, o), "node-run-1", callEnd],
    [EventType.DECISION_MADE, (o) => createDecisionMadeEvent(nodeIds, decisionMade, o), "node-run-1", decisionMade],
    [EventType.STEP_START, (o) => createStepStartEvent(stepIds, stepStart, o), "parent-run-1", stepStart],
    [EventType.STEP_END, (o) => createStepEndEvent(stepIds, stepEnd, o), "parent-run-1", stepEnd],
    [EventType.GATE_START, (o) => createGateStartEvent(stepIds, gateStart, o), "parent-run-1", gateStart],
    [EventType.GATE_END, (o) => createGateEndEvent(stepIds, gateEnd, o), "parent-run-1", gateEnd],
  ];

  test("model-node factories stamp level, source, run id, explicit id and timestamp", () => {
    for (const [type, build, runId, data] of cases) {
      const event = build(opts);
      expect({
        type: event.type,
        source: event.source,
        traceLevel: event.traceLevel,
        runId: event.runId,
        eventId: event.eventId,
        timestamp: event.timestamp,
        spanId: event.spanId,
      }).toEqual({
        type,
        source: "kernel",
        traceLevel: TraceLevel.PROCESSING,
        runId,
        eventId: "evt-fixed",
        timestamp: "2026-10-07T00:00:00.001Z",
        spanId: "span-1",
      });
      expect(event.eventData).toMatchObject(data as Record<string, unknown>);
    }
  });

  test("model-node factories mint a fresh id and timestamp when none is given", () => {
    const a = createCallStartEvent(nodeIds, callStart);
    const b = createCallStartEvent(nodeIds, callStart);
    expect(a.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a.eventId).not.toBe(b.eventId);
    expect(Number.isNaN(Date.parse(a.timestamp))).toBe(false);
  });

  test("step and gate payloads duplicate the envelope run id and keep gate linkage", () => {
    const check = createStepStartEvent(
      stepIds,
      { step_name: "lint", gate_span_id: "gate-span-1" },
      { spanId: "step-span-1", parentEventId: "gate-start-evt" },
    );
    expect(check.eventData).toEqual({ step_name: "lint", gate_span_id: "gate-span-1", run_id: "parent-run-1" });
    expect(check.parentEventId).toBe("gate-start-evt");
    expect(check.piSessionUuid).toBeUndefined();

    // An explicit run_id wins; no parent run leaves it absent.
    expect(createGateEndEvent(stepIds, { ...gateEnd, run_id: "other-run" }, { spanId: "g" }).eventData)
      .toHaveProperty("run_id", "other-run");
    expect(createGateStartEvent({ containerId: "c1" }, gateStart, { spanId: "g" }).eventData)
      .not.toHaveProperty("run_id");
  });
});

describe("explicit ids on existing factories", () => {
  test("tool, turn and snapshot factories keep an explicit eventId and timestamp", () => {
    const at = { eventId: "evt-det", timestamp: "2026-10-07T00:00:00.002Z" };
    const snapshot: PiRequestSnapshotData = {
      turn_number: 0,
      system_prompt_blob_hash: null,
      prompt_hash: null,
      message_count: 1,
      message_refs: [],
      total_text_chars: 0,
      total_image_count: 0,
      raw_request_blob_hash: "b1-wire",
      request_kind: "classifier",
    };
    const events = [
      createToolCallStartEvent(ids, "read", "toolu_1", at),
      createToolCallEndEvent(ids, "read", "toolu_1", at),
      createPiTurnStartEvent(ids, at),
      createPiTurnEndEvent(ids, at),
      createPiRequestSnapshotEvent(ids, snapshot, at),
    ];
    expect(events.map((e) => e.type)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_END,
      EventType.PI_TURN_START,
      EventType.PI_TURN_END,
      EventType.PI_REQUEST_SNAPSHOT,
    ]);
    for (const event of events) {
      expect(event.eventId).toBe(at.eventId);
      expect(event.timestamp).toBe(at.timestamp);
    }
  });

  test("pi_turn_end carries model-node response fields only when given", () => {
    const nodeTurn = createPiTurnEndEvent(ids, {
      responseBlobHash: "b1-resp",
      httpStatus: 200,
      durationMs: 1200,
      reasoningTokens: 64,
    });
    expect(nodeTurn.eventData).toMatchObject({
      response_blob_hash: "b1-resp",
      http_status: 200,
      duration_ms: 1200,
      reasoning_tokens: 64,
    });
    expect(Object.keys(createPiTurnEndEvent(ids, { turnNumber: 1 }).eventData).sort()).toEqual([
      "stop_reason",
      "turn_number",
    ]);
  });
});

describe("nested tool call payloads", () => {
  test("tool factories write the nested fields of the payload", () => {
    const start = createToolCallStartEvent(ids, "read", "codemode/1/1", {
      spanId: "codemode/1/1",
      parentToolUseId: "codemode/1",
      nested: true,
      timing: "live",
    });
    expect(start.eventData).toMatchObject({ parent_tool_use_id: "codemode/1", nested: true, timing: "live" });

    const end = createToolCallEndEvent(ids, "read", "codemode/1/1", {
      spanId: "codemode/1/1",
      parentToolUseId: "codemode/1",
      nested: true,
      nestedStatus: "unfinished",
      timing: "approximate",
      durationMs: 15,
      isError: true,
    });
    expect(end.eventData).toMatchObject({
      parent_tool_use_id: "codemode/1",
      nested: true,
      nested_status: "unfinished",
      timing: "approximate",
      duration_ms: 15,
      is_error: true,
    });
  });

  test("top-level tool payloads gain no nested keys", () => {
    const start = createToolCallStartEvent(ids, "read", "toolu_1", { toolInput: { path: "/x" }, nested: false });
    const end = createToolCallEndEvent(ids, "read", "toolu_1", { toolOutput: "ok", durationMs: 3 });
    for (const key of ["parent_tool_use_id", "nested", "nested_status", "timing"]) {
      expect(start.eventData).not.toHaveProperty(key);
      expect(end.eventData).not.toHaveProperty(key);
    }
  });
});

describe("createAppEvent", () => {
  test("builds an app-sourced event with the host payload and identity", () => {
    const event = createAppEvent(
      "app:board-render",
      ids,
      { blob_hash: "b1-abc", n: 3, summary: "moved two stickies" },
      { timestamp: "2026-07-28T00:00:00.000Z" },
    );
    expect(event.type).toBe("app:board-render");
    expect(event.source).toBe("app");
    expect(event.containerId).toBe("container-1");
    expect(event.runId).toBe("run-1");
    expect(event.piSessionUuid).toBe("pi-uuid-1");
    expect(event.timestamp).toBe("2026-07-28T00:00:00.000Z");
    expect(event.traceLevel).toBe(TraceLevel.PROCESSING);
    const data = event.eventData as Record<string, unknown>;
    expect(data.blob_hash).toBe("b1-abc");
    expect(data.n).toBe(3);
  });

  test("honors an explicit trace level and span linkage", () => {
    const event = createAppEvent("app:custom", ids, {}, {
      traceLevel: TraceLevel.DEBUG,
      spanId: "span-1",
      parentEventId: "evt-0",
    });
    expect(event.traceLevel).toBe(TraceLevel.DEBUG);
    expect(event.spanId).toBe("span-1");
    expect(event.parentEventId).toBe("evt-0");
  });

  test("rejects types outside the app: namespace", () => {
    expect(() => createAppEvent("board-render", ids, {})).toThrow(
      'App event type must start with "app:"',
    );
    expect(() => createAppEvent("tool_call_start", ids, {})).toThrow();
  });
});
