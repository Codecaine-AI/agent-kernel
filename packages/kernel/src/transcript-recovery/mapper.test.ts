import { describe, expect, test } from "bun:test";
import { nestedToolEventId, piEntryEventId } from "@agent-kernel/protocol";
import type { TraceEvent } from "@agent-kernel/protocol";
import { EventMapper, type EventMapperOptions } from "./mapper";
import type { PiEvent, PiNestedToolCallRecord } from "./types";

const PI_SESSION_UUID = "11111111-2222-3333-4444-555555555555";
const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const HIERARCHICAL_CONTAINER_ID = `melee:${CONTAINER_ID}:session:run:example`;
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

  test("rejects a hierarchical containerId by default and keeps events pending", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    const result = mapper.map(
      bindingEvent({ containerId: HIERARCHICAL_CONTAINER_ID }),
    );
    expect(result.traceEvents).toEqual([]);
    expect(mapper.hasContainerBinding()).toBe(false);
    expect(mapper.hasPending()).toBe(true);
  });

  test("accepts a hierarchical containerId when configured", () => {
    const mapper = new EventMapper({
      ...BINDING_OPTIONS,
      acceptContainerId: (id) => id.startsWith("melee:"),
    });
    mapper.map(sessionEvent());

    const result = mapper.map(
      bindingEvent({ containerId: HIERARCHICAL_CONTAINER_ID, runId: RUN_ID }),
    );

    expect(result.traceEvents).toHaveLength(1);
    expect(result.traceEvents[0]!.containerId).toBe(HIERARCHICAL_CONTAINER_ID);
    expect(mapper.getContainerId()).toBe(HIERARCHICAL_CONTAINER_ID);
    expect(mapper.hasPending()).toBe(false);
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

/** A codemode tool result whose script made the given nested calls. */
function codemodeResult(
  entryId: string,
  calls: PiNestedToolCallRecord[],
  timestamp = T0,
): PiEvent {
  return {
    type: "message",
    id: entryId,
    parentId: null,
    timestamp,
    message: {
      role: "toolResult",
      content: [{ type: "text", text: "script done" }],
      timestamp: 0,
      toolCallId: "c",
      toolName: "codemode",
      nestedCalls: { calls, complete: calls.every((c) => c.status !== "unfinished") },
    },
  };
}

function nestedEvents(events: TraceEvent[]): TraceEvent[] {
  return events.filter((e) => (e.eventData as { nested?: boolean }).nested === true);
}

describe("EventMapper (nested tool calls)", () => {
  function boundMapper(): EventMapper {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    mapper.map(bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID }));
    return mapper;
  }

  test("nestedCalls become approximate nested spans that keep their nested ids", () => {
    const T_END = "2026-07-01T10:00:05.000Z";
    const events = boundMapper().map(
      codemodeResult(
        "entry-tr",
        [
          { id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 40 },
          {
            id: "c/1/1",
            name: "bash",
            argumentsBytes: 9000,
            status: "error",
            durationMs: 3,
            error: "blocked by guard",
          },
        ],
        T_END,
      ),
    ).traceEvents;

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_end",
      "tool_call_start",
      "tool_call_end",
      "tool_call_start",
      "tool_call_end",
    ]);
    // The parent's own end keeps its entry-derived id: existing ids are unchanged.
    expect(events[0]!.eventId).toBe(
      piEntryEventId(PI_SESSION_UUID, "entry-tr", 0, "tool_call_end"),
    );

    const [readStart, readEnd, bashStart, bashEnd] = nestedEvents(events);
    for (const [evt, id] of [
      [readStart, "c/1"],
      [readEnd, "c/1"],
      [bashStart, "c/1/1"],
      [bashEnd, "c/1/1"],
    ] as const) {
      expect(evt!.eventId).toBe(nestedToolEventId(PI_SESSION_UUID, id, String(evt!.type)));
      expect(evt!.spanId).toBe(id);
      expect(evt!.source).toBe("agent");
      expect(evt!.containerId).toBe(CONTAINER_ID);
      expect(evt!.runId).toBe(RUN_ID);
      expect(evt!.piSessionUuid).toBe(PI_SESSION_UUID);
      expect(evt!.parentEventId).toBeUndefined();
    }

    // Immediate parent = the id minus its final /<n>.
    expect(readStart!.eventData).toMatchObject({
      tool_use_id: "c/1",
      tool_name: "read",
      tool_input: { raw: { path: "a.ts" } },
      parent_tool_use_id: "c",
      nested: true,
      timing: "approximate",
    });
    expect(readEnd!.eventData).toMatchObject({
      parent_tool_use_id: "c",
      nested: true,
      nested_status: "ok",
      duration_ms: 40,
      timing: "approximate",
    });
    expect(readEnd!.eventData).not.toHaveProperty("is_error");
    // End at the tool result's entry time, start durationMs earlier.
    expect(readEnd!.timestamp).toBe(T_END);
    expect(readStart!.timestamp).toBe("2026-07-01T10:00:04.960Z");

    expect(bashStart!.eventData).toMatchObject({
      parent_tool_use_id: "c/1",
      tool_input: { omitted_bytes: 9000 },
    });
    expect(bashEnd!.eventData).toMatchObject({
      parent_tool_use_id: "c/1",
      nested_status: "error",
      is_error: true,
      tool_output: "blocked by guard",
    });
  });

  test("missing durationMs never yields an invalid timestamp", () => {
    const events = nestedEvents(
      boundMapper().map(
        codemodeResult("entry-tr", [
          { id: "c/1", name: "read", status: "unfinished" },
          // A malformed duration reads as missing.
          { id: "c/2", name: "ls", status: "ok", durationMs: -5 },
        ]),
      ).traceEvents,
    );

    expect(events).toHaveLength(4);
    for (const evt of events) {
      expect(evt.timestamp).toBe(T0);
      expect(Number.isNaN(Date.parse(evt.timestamp))).toBe(false);
      expect((evt.eventData as { duration_ms?: number }).duration_ms).toBeUndefined();
    }
  });

  test("unfinished nested record ends with nested_status unfinished", () => {
    const [, end] = nestedEvents(
      boundMapper().map(
        codemodeResult("entry-tr", [{ id: "c/1", name: "read", status: "unfinished" }]),
      ).traceEvents,
    );
    expect(end!.type).toBe("tool_call_end");
    expect(end!.eventData).toMatchObject({
      tool_use_id: "c/1",
      nested_status: "unfinished",
      is_error: true,
      timing: "approximate",
    });
    expect((end!.eventData as { tool_output?: string }).tool_output).toBeUndefined();
  });

  test("nested events held before the binding keep their ids when released", () => {
    const mapper = new EventMapper(BINDING_OPTIONS);
    mapper.map(sessionEvent());
    expect(
      mapper.map(codemodeResult("entry-tr", [{ id: "c/1", name: "read", status: "ok" }]))
        .traceEvents,
    ).toEqual([]);

    const released = nestedEvents(
      mapper.map(bindingEvent({ containerId: CONTAINER_ID, runId: RUN_ID })).traceEvents,
    );
    expect(released.map((e) => e.eventId)).toEqual([
      nestedToolEventId(PI_SESSION_UUID, "c/1", "tool_call_start"),
      nestedToolEventId(PI_SESSION_UUID, "c/1", "tool_call_end"),
    ]);
    for (const evt of released) {
      expect(evt.containerId).toBe(CONTAINER_ID);
      expect(evt.runId).toBe(RUN_ID);
    }
  });

  test("records without an id are skipped; a tool result without nestedCalls is unchanged", () => {
    const mapper = boundMapper();
    const withJunk = mapper.map({
      type: "message",
      id: "entry-tr",
      parentId: null,
      timestamp: T0,
      message: {
        role: "toolResult",
        content: [],
        timestamp: 0,
        toolCallId: "c",
        toolName: "codemode",
        nestedCalls: {
          calls: [{ name: "read", status: "ok" } as unknown as PiNestedToolCallRecord],
          complete: false,
        },
      },
    }).traceEvents;
    expect(withJunk.map((e) => e.type)).toEqual(["tool_call_end"]);

    const plain = mapper.map({
      type: "message",
      id: "entry-tr2",
      parentId: null,
      timestamp: T0,
      message: { role: "toolResult", content: [], timestamp: 0, toolCallId: "t", toolName: "read" },
    }).traceEvents;
    expect(plain.map((e) => e.type)).toEqual(["tool_call_end"]);
  });

  test("a system transcript entry maps to no event", () => {
    const events = boundMapper().map({
      type: "message",
      id: "entry-sys",
      parentId: null,
      timestamp: T0,
      message: {
        role: "system",
        content: [{ type: "text", text: "You are a careful agent." }],
        timestamp: 0,
      },
    }).traceEvents;
    expect(events).toEqual([]);
  });
});
