import { describe, expect, test } from "bun:test";

import {
  createAgentRunEndEvent,
  createAppEvent,
  createAgentRunStartEvent,
  createAgentSessionStartEvent,
  createPiTurnEndEvent,
  createToolCallEndEvent,
  createToolCallStartEvent,
  createUserMessageEvent,
  type TraceEventIds,
} from "./factories";
import { EventType, TraceLevel, type AgentRunEndData, type PiTurnEndData } from "./types";

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
