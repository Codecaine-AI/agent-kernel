/**
 * spawnerSpans.test.ts — Spawner tool calls (D77) resolve a dispatch-flavored
 * title plus tool_kind/spawns attributes while pairing/status/timing stay
 * identical to ordinary tool calls. Ordinary tool calls must be untouched
 * (the characterization snapshot pins the full non-spawner tree separately).
 */
import { describe, expect, it } from "bun:test";

import { EventType, type TraceEvent } from "../types";

import type { PairedEvent } from "./pairEvents";
import { extractSpanPayload, statusFor, titleFor } from "./spanAttributes";

function attr(payload: ReturnType<typeof extractSpanPayload>, key: string): string | undefined {
  const value = payload.attributes?.find((a) => a.key === key)?.value;
  return value?.stringValue ?? value?.intValue;
}

function startEvent(eventData: Record<string, unknown>): TraceEvent {
  return {
    eventId: "evt-start",
    containerId: "c1",
    type: EventType.TOOL_CALL_START,
    source: "kernel" as TraceEvent["source"],
    traceLevel: 1,
    eventData,
    spanId: "span-1",
    timestamp: "2026-07-02T00:00:00.000Z",
  };
}

function endEvent(eventData: Record<string, unknown>): TraceEvent {
  return {
    eventId: "evt-end",
    containerId: "c1",
    type: EventType.TOOL_CALL_END,
    source: "kernel" as TraceEvent["source"],
    traceLevel: 1,
    eventData,
    spanId: "span-1",
    timestamp: "2026-07-02T00:00:01.000Z",
  };
}

describe("spawner tool spans", () => {
  it("names spawner point calls by their declared agents", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: startEvent({
        tool_use_id: "t1",
        tool_name: "spawn_research_scouts",
        toolKind: "spawner",
        spawns: ["source-scout"],
        tool_input: { topic: "quantum" },
      }),
    };

    expect(titleFor(paired)).toBe("Dispatch: source-scout");
    expect(statusFor(paired)).toBe("pending");

    const payload = extractSpanPayload(paired);
    expect(attr(payload, "tool_kind")).toBe("spawner");
    expect(attr(payload, "spawns")).toBe("source-scout");
    expect(attr(payload, "tool_name")).toBe("spawn_research_scouts");
    expect(payload.input).toBe(JSON.stringify({ topic: "quantum" }));
  });

  it("joins multiple declared agents in the dispatch title and spawns attr", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: startEvent({
        tool_use_id: "t2",
        tool_name: "spawn_scouts",
        toolKind: "spawner",
        spawns: ["scout-a", "scout-b"],
      }),
    };

    expect(titleFor(paired)).toBe("Dispatch: scout-a, scout-b");
    expect(attr(extractSpanPayload(paired), "spawns")).toBe("scout-a,scout-b");
  });

  it("falls back to the tool name when spawns is a wildcard", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: startEvent({
        tool_use_id: "t3",
        tool_name: "dispatch_any",
        toolKind: "spawner",
        spawns: ["*"],
      }),
    };

    expect(titleFor(paired)).toBe("Dispatch: dispatch_any");
    expect(attr(extractSpanPayload(paired), "spawns")).toBe("*");
    expect(attr(extractSpanPayload(paired), "tool_kind")).toBe("spawner");
  });

  it("carries dispatch title/attrs and normal timing through pairing", () => {
    const paired: PairedEvent = {
      kind: "pair",
      start: startEvent({
        tool_use_id: "t4",
        tool_name: "spawn_research_scouts",
        toolKind: "spawner",
        spawns: ["source-scout"],
        tool_input: { topic: "birds" },
      }),
      end: endEvent({
        tool_use_id: "t4",
        tool_name: "spawn_research_scouts",
        toolKind: "spawner",
        spawns: ["source-scout"],
        tool_output: "dispatched",
        duration_ms: 1000,
      }),
    };

    expect(titleFor(paired)).toBe("Dispatch: source-scout");
    expect(statusFor(paired)).toBe("success");

    const payload = extractSpanPayload(paired);
    expect(attr(payload, "tool_kind")).toBe("spawner");
    expect(attr(payload, "spawns")).toBe("source-scout");
    expect(attr(payload, "duration_ms")).toBe("1000");
    expect(payload.input).toBe(JSON.stringify({ topic: "birds" }));
    expect(payload.output).toBe("dispatched");
  });

  it("reads toolKind off the END event when the start is missing", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: endEvent({
        tool_use_id: "t5",
        tool_name: "spawn_scouts",
        toolKind: "spawner",
        spawns: ["scout-a"],
        tool_output: "ok",
      }),
    };

    expect(titleFor(paired)).toBe("Dispatch: scout-a");
    expect(attr(extractSpanPayload(paired), "tool_kind")).toBe("spawner");
  });
});

describe("ordinary tool spans are unchanged by the spawner path", () => {
  it("keeps the tool name as title and adds no spawner attributes (point)", () => {
    const paired: PairedEvent = {
      kind: "point",
      event: startEvent({
        tool_use_id: "t6",
        tool_name: "Read",
        tool_input: { path: "/x" },
      }),
    };

    expect(titleFor(paired)).toBe("Read");
    const payload = extractSpanPayload(paired);
    expect(attr(payload, "tool_kind")).toBeUndefined();
    expect(attr(payload, "spawns")).toBeUndefined();
    expect(attr(payload, "tool_name")).toBe("Read");
  });

  it("keeps the tool name as title and adds no spawner attributes (pair)", () => {
    const paired: PairedEvent = {
      kind: "pair",
      start: startEvent({ tool_use_id: "t7", tool_name: "Bash", tool_input: { command: "ls" } }),
      end: endEvent({ tool_use_id: "t7", tool_name: "Bash", tool_output: "a b", duration_ms: 5 }),
    };

    expect(titleFor(paired)).toBe("Bash");
    const payload = extractSpanPayload(paired);
    expect(attr(payload, "tool_kind")).toBeUndefined();
    expect(attr(payload, "spawns")).toBeUndefined();
    expect(attr(payload, "duration_ms")).toBe("5");
  });
});
