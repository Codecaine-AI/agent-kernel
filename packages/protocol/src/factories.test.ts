import { describe, expect, test } from "bun:test";

import {
  createAgentRunEndEvent,
  createAgentRunStartEvent,
  createAgentSessionStartEvent,
  createPiTurnEndEvent,
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

describe("event catalog", () => {
  test("ask events are gone from the core catalog", () => {
    expect(Object.values(EventType)).not.toContain("ui_ask_requested");
    expect(Object.values(EventType)).not.toContain("ui_ask_answered");
  });
});
