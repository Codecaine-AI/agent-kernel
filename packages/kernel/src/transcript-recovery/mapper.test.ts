import { describe, expect, test } from "bun:test";
import type { TraceEvent } from "@agent-kernel/protocol";
import { EventMapper, type EventMapperOptions } from "./mapper";
import type { PiEvent } from "./types";

const PI_SESSION_UUID = "11111111-2222-3333-4444-555555555555";
const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RUN_ID = "99999999-8888-7777-6666-555555555555";
const T0 = "2026-07-01T10:00:00.000Z";

const BINDING_OPTIONS: EventMapperOptions = {
  sessionBinding: { customType: "agent-kernel:session-binding" },
};

function sessionEvent(): PiEvent {
  return { type: "session", version: 3, id: PI_SESSION_UUID, timestamp: T0, cwd: "/tmp" };
}

function bindingEvent(data: Record<string, unknown>): PiEvent {
  return {
    type: "custom",
    customType: "agent-kernel:session-binding",
    data,
    id: "entry-binding",
    parentId: null,
    timestamp: T0,
  };
}

function lifecycleEvent(id: string, data: Record<string, unknown>): PiEvent {
  return {
    type: "custom",
    customType: "agent-kernel:pi-lifecycle",
    data,
    id,
    parentId: null,
    timestamp: T0,
  };
}

function userMessage(id: string, text: string): PiEvent {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: T0,
    message: { role: "user", content: [{ type: "text", text }], timestamp: 0 },
  };
}

function assistantMessageWithUsage(id: string): PiEvent {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: T0,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Looking at the file." },
        { type: "toolCall", id: "tc-1", name: "read", arguments: '{"path":"a.ts"}' },
      ],
      timestamp: 0,
      model: "gpt-5",
      stopReason: "toolUse",
      usage: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 5,
        totalTokens: 165,
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
      },
    },
  };
}

function mapAll(mapper: EventMapper, events: PiEvent[]): TraceEvent[] {
  const out: TraceEvent[] = [];
  for (const event of events) {
    out.push(...mapper.map(event).traceEvents);
  }
  return out;
}

describe("EventMapper (container-first envelope)", () => {
  test("holds events until the binding marker, then stamps containerId and runId", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);

    expect(mapper.map(sessionEvent()).traceEvents).toEqual([]);
    expect(mapper.map(userMessage("entry-u1", "hello")).traceEvents).toEqual([]);
    expect(mapper.hasPending()).toBe(true);
    expect(mapper.pendingCount()).toBe(2);

    const result = mapper.map(bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID }));
    expect(result.traceEvents).toHaveLength(2);
    for (const evt of result.traceEvents) {
      expect(evt.containerId).toBe(CONTAINER_ID);
      expect(evt.runId).toBe(RUN_ID);
      expect(evt.piSessionUuid).toBe(PI_SESSION_UUID);
      expect(evt.source).toBe("agent");
    }
    expect(result.traceEvents[0]!.type).toBe("agent_session_start");
    expect(result.traceEvents[1]!.type).toBe("user_message");
    expect(mapper.hasPending()).toBe(false);
    expect(result.metadata?.containerBinding?.containerId).toBe(CONTAINER_ID);
    expect(result.metadata?.containerBinding?.runId).toBe(RUN_ID);
  });

  test("binding without runId stamps containerId only", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    const released = mapper.map(bindingEvent({ containerId: CONTAINER_ID })).traceEvents;
    expect(released).toHaveLength(1);
    expect(released[0]!.containerId).toBe(CONTAINER_ID);
    expect(released[0]!.runId).toBeUndefined();
  });

  test("events after binding are stamped directly", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID }));

    const events = mapper.map(userMessage("entry-u2", "follow-up")).traceEvents;
    expect(events).toHaveLength(1);
    expect(events[0]!.containerId).toBe(CONTAINER_ID);
    expect(events[0]!.runId).toBe(RUN_ID);
  });

  test("rejects a non-uuid containerId and keeps events pending", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    const result = mapper.map(bindingEvent({ containerId: "not-a-uuid" }));
    expect(result.traceEvents).toEqual([]);
    expect(mapper.hasContainerBinding()).toBe(false);
    expect(mapper.hasPending()).toBe(true);
  });

  test("binding field names are configurable", () => {
    const mapper = new EventMapper({
      sessionBinding: {
        customType: "agent-kernel:session-binding",
        containerIdField: "cid",
        runIdField: "rid",
      },
    });
    mapper.map(sessionEvent());
    const released = mapper.map(
      bindingEvent({ cid: CONTAINER_ID, rid: RUN_ID }),
    ).traceEvents;
    expect(released).toHaveLength(1);
    expect(released[0]!.containerId).toBe(CONTAINER_ID);
    expect(released[0]!.runId).toBe(RUN_ID);
  });

  test("extracts TurnUsage from assistant message usage onto pi_turn_end", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID }));
    mapper.map(lifecycleEvent("entry-as", { phase: "agent_start" }));
    mapper.map(lifecycleEvent("entry-ts", { phase: "turn_start", turnIndex: 0 }));
    mapper.map(assistantMessageWithUsage("entry-a1"));

    const result = mapper.map(
      lifecycleEvent("entry-te", { phase: "turn_end", turnIndex: 0, stopReason: "toolUse" }),
    );
    expect(result.warnings).toBeUndefined();
    const turnEnd = result.traceEvents[0]!;
    expect(turnEnd.type).toBe("pi_turn_end");
    expect(turnEnd.eventData).toMatchObject({
      turn_number: 0,
      stop_reason: "toolUse",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "gpt-5",
        costEstimate: 0.3,
      },
    });
  });

  test("turn_end without observed usage omits usage and raises a warning", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID }));
    mapper.map(lifecycleEvent("entry-ts", { phase: "turn_start", turnIndex: 0 }));

    const result = mapper.map(lifecycleEvent("entry-te", { phase: "turn_end", turnIndex: 0 }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toContain("without observed assistant usage");
    expect(
      (result.traceEvents[0]!.eventData as { usage?: unknown }).usage,
    ).toBeUndefined();
  });

  test("aggregates per-turn usage onto pi_agent_end", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID }));
    mapper.map(lifecycleEvent("entry-as", { phase: "agent_start" }));
    mapper.map(lifecycleEvent("entry-t0", { phase: "turn_start", turnIndex: 0 }));
    mapper.map(assistantMessageWithUsage("entry-a1"));
    mapper.map(lifecycleEvent("entry-t0e", { phase: "turn_end", turnIndex: 0 }));
    mapper.map(lifecycleEvent("entry-t1", { phase: "turn_start", turnIndex: 1 }));
    mapper.map(assistantMessageWithUsage("entry-a2"));
    mapper.map(lifecycleEvent("entry-t1e", { phase: "turn_end", turnIndex: 1 }));

    const agentEnd = mapper.map(
      lifecycleEvent("entry-ae", { phase: "agent_end", inputTokens: 1, outputTokens: 1 }),
    ).traceEvents[0]!;
    expect(agentEnd.type).toBe("pi_agent_end");
    // Aggregate of the two observed turns beats the marker's last-message counts.
    expect(agentEnd.eventData).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  test("event ids are deterministic across replays of the same JSONL", () => {
    const events: PiEvent[] = [
      sessionEvent(),
      bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID }),
      lifecycleEvent("entry-as", { phase: "agent_start" }),
      userMessage("entry-u1", "hello"),
      assistantMessageWithUsage("entry-a1"),
      lifecycleEvent("entry-te", { phase: "turn_end", turnIndex: 0 }),
    ];

    const first = mapAll(new EventMapper(BINDING_OPTIONS), events);
    const second = mapAll(new EventMapper(BINDING_OPTIONS), events);

    expect(first.length).toBeGreaterThan(0);
    expect(second.map((e) => e.eventId)).toEqual(first.map((e) => e.eventId));
    // ...and unique within one replay.
    expect(new Set(first.map((e) => e.eventId)).size).toBe(first.length);
  });

  test("tool calls and tool results map with tool ids as span ids", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID }));

    const start = mapper.map(assistantMessageWithUsage("entry-a1")).traceEvents;
    const toolStart = start.find((e) => e.type === "tool_call_start")!;
    expect(toolStart.spanId).toBe("tc-1");
    expect(toolStart.eventData).toMatchObject({
      tool_name: "read",
      tool_use_id: "tc-1",
      tool_input: { path: "a.ts" },
    });

    const end = mapper.map({
      type: "message",
      id: "entry-tr1",
      parentId: null,
      timestamp: T0,
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "file contents" }],
        timestamp: 0,
        toolCallId: "tc-1",
        toolName: "read",
      },
    }).traceEvents[0]!;
    expect(end.type).toBe("tool_call_end");
    expect(end.spanId).toBe("tc-1");
    expect(end.eventData).toMatchObject({ tool_output: "file contents" });
    expect(end.eventData).not.toHaveProperty("is_error");
  });

  test("propagates errored tool results to tool_call_end events", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID }));

    const end = mapper.map({
      type: "message",
      id: "entry-tr-error",
      parentId: null,
      timestamp: T0,
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "ERROR · layout failed" }],
        timestamp: 0,
        toolCallId: "tc-error",
        toolName: "layout",
        isError: true,
      },
    }).traceEvents[0]!;

    expect(end.type).toBe("tool_call_end");
    expect(end.eventData).toMatchObject({
      tool_output: "ERROR · layout failed",
      is_error: true,
    });
  });
});
