import { describe, expect, it } from "bun:test";

import {
  EventType,
  type ContextBuildCompletedData,
  type ContextBuildStartedData,
  type PiTurnEndData,
  type TraceEvent,
} from "../types";

import type { PairedEvent } from "./pairEvents";
import {
  categoryFor,
  extractSpanPayload,
  statusFor,
  titleFor,
} from "./spanAttributes";

function event(
  type: string,
  eventData: TraceEvent["eventData"],
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    eventId: `evt-${type}`,
    containerId: "container-1",
    runId: "run-1",
    piSessionId: "pi-1",
    type,
    source: "kernel",
    traceLevel: 1,
    eventData,
    timestamp: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function valueFor(paired: PairedEvent, key: string): string | boolean | undefined {
  const value = extractSpanPayload(paired).attributes?.find(
    (attribute) => attribute.key === key,
  )?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue;
}

function contextPair(inputs: unknown): PairedEvent {
  const startData: ContextBuildStartedData = {
    agent_name: "researcher",
    declared_inputs: [{ kind: "capabilities", ref: "capabilities" }],
  };
  return {
    kind: "pair",
    start: event(EventType.CONTEXT_BUILD_STARTED, startData, {
      spanId: "context-1",
    }),
    end: event(
      EventType.CONTEXT_BUILD_COMPLETED,
      { inputs, rendered_context: "rendered", total_bytes: 14828 },
      { eventId: "evt-context-end", spanId: "context-1" },
    ),
  };
}

function contextPoint(inputs?: unknown): PairedEvent {
  return {
    kind: "point",
    event: event(EventType.CONTEXT_BUILD_COMPLETED, {
      inputs,
      rendered_context: "rendered",
      total_bytes: 14828,
    }),
  };
}

const resolvedInputs: ContextBuildCompletedData["inputs"] = [
  {
    loader_kind: "capabilities",
    input_ref: "capabilities",
    status: "ok",
    bytes: 11635,
  },
  {
    loader_kind: "style-guide",
    input_ref: "style-guide",
    status: "ok",
    bytes: 3193,
  },
];

describe("context build resolved_inputs", () => {
  it("preserves non-empty resolved inputs on a paired context build", () => {
    const paired = contextPair(resolvedInputs);

    expect(valueFor(paired, "inputs_count")).toBe("2");
    expect(valueFor(paired, "resolved_inputs")).toBe(
      JSON.stringify(resolvedInputs),
    );
  });

  it("preserves non-empty resolved inputs on an unpaired completion point", () => {
    const paired = contextPoint(resolvedInputs);

    expect(valueFor(paired, "inputs_count")).toBe("2");
    expect(valueFor(paired, "resolved_inputs")).toBe(
      JSON.stringify(resolvedInputs),
    );
  });

  it("omits resolved_inputs for empty or absent inputs", () => {
    expect(valueFor(contextPair([]), "resolved_inputs")).toBeUndefined();
    expect(valueFor(contextPoint(), "resolved_inputs")).toBeUndefined();
  });

  it("omits resolved_inputs for malformed non-array inputs", () => {
    expect(
      valueFor(contextPair({ unexpected: true }), "resolved_inputs"),
    ).toBeUndefined();
    expect(valueFor(contextPoint("not-an-array"), "resolved_inputs")).toBeUndefined();
  });
});

describe("pi turn point attributes", () => {
  it("extracts all pi_turn_end usage attributes without changing its category", () => {
    const data: PiTurnEndData = {
      turn_number: 1,
      stop_reason: "toolUse",
      usage: {
        inputTokens: 19576,
        outputTokens: 86,
        cacheReadTokens: 6656,
        cacheWriteTokens: 0,
        model: "gpt-5.6-sol",
        costEstimate: 0,
      },
    };
    const paired: PairedEvent = {
      kind: "point",
      event: event(EventType.PI_TURN_END, data),
    };

    expect(categoryFor(EventType.PI_TURN_END)).toBe("event");
    expect(titleFor(paired)).toBe("pi_turn_end");
    expect(valueFor(paired, "turn_number")).toBe("1");
    expect(valueFor(paired, "stop_reason")).toBe("toolUse");
    expect(valueFor(paired, "input_tokens")).toBe("19576");
    expect(valueFor(paired, "output_tokens")).toBe("86");
    expect(valueFor(paired, "cache_read_tokens")).toBe("6656");
    expect(valueFor(paired, "cache_write_tokens")).toBe("0");
    expect(valueFor(paired, "model")).toBe("gpt-5.6-sol");
    expect(valueFor(paired, "cost_estimate")).toBe("0");
  });

  it("titles pi_turn_start by turn number and omits absent optional data", () => {
    const present: PairedEvent = {
      kind: "point",
      event: event(EventType.PI_TURN_START, { turn_number: 0 }),
    };
    const absent: PairedEvent = {
      kind: "point",
      event: event(EventType.PI_TURN_START, {}),
    };

    expect(categoryFor(EventType.PI_TURN_START)).toBe("event");
    expect(titleFor(present)).toBe("turn 0 start");
    expect(valueFor(present, "turn_number")).toBe("0");
    expect(titleFor(absent)).toBe("pi_turn_start");
    expect(valueFor(absent, "turn_number")).toBeUndefined();
  });

  it("omits absent pi_turn_end attributes", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: event(EventType.PI_TURN_END, {}),
    };

    for (const key of [
      "turn_number",
      "stop_reason",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "model",
      "cost_estimate",
    ]) {
      expect(valueFor(paired, key)).toBeUndefined();
    }
  });
});

describe("tool result error state", () => {
  it("marks an errored unpaired tool result and preserves the flag as an attribute", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: event(EventType.TOOL_CALL_END, {
        tool_name: "layout",
        tool_use_id: "tool-1",
        tool_output: "ERROR · invalid layout",
        is_error: true,
      }),
    };

    expect(statusFor(paired)).toBe("error");
    expect(valueFor(paired, "is_error")).toBe(true);
  });

  it("marks a paired errored tool result from the end event", () => {
    const paired: PairedEvent = {
      kind: "pair",
      start: event(
        EventType.TOOL_CALL_START,
        {
          tool_name: "layout",
          tool_use_id: "tool-2",
          tool_input: { operation: "align" },
        },
        { eventId: "evt-tool-start", spanId: "tool-span-2" },
      ),
      end: event(
        EventType.TOOL_CALL_END,
        {
          tool_name: "layout",
          tool_use_id: "tool-2",
          tool_output: "ERROR · invalid layout",
          is_error: true,
        },
        { eventId: "evt-tool-end", spanId: "tool-span-2" },
      ),
    };

    expect(statusFor(paired)).toBe("error");
    expect(valueFor(paired, "is_error")).toBe(true);
  });

  it("keeps ordinary tool results successful and omits the error attribute", () => {
    const point: PairedEvent = {
      kind: "point",
      event: event(EventType.TOOL_CALL_END, {
        tool_name: "layout",
        tool_use_id: "tool-3",
        tool_output: "APPLIED · layout",
      }),
    };
    const paired: PairedEvent = {
      kind: "pair",
      start: event(
        EventType.TOOL_CALL_START,
        {
          tool_name: "layout",
          tool_use_id: "tool-4",
          tool_input: { operation: "align" },
        },
        { eventId: "evt-tool-start-ok", spanId: "tool-span-4" },
      ),
      end: event(
        EventType.TOOL_CALL_END,
        {
          tool_name: "layout",
          tool_use_id: "tool-4",
          tool_output: "APPLIED · layout",
        },
        { eventId: "evt-tool-end-ok", spanId: "tool-span-4" },
      ),
    };

    expect(statusFor(point)).toBe("success");
    expect(valueFor(point, "is_error")).toBeUndefined();
    expect(statusFor(paired)).toBe("success");
    expect(valueFor(paired, "is_error")).toBeUndefined();
  });
});
