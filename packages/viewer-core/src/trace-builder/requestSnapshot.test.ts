/**
 * requestSnapshot.test.ts — pi_request_snapshot registry entry: turn-numbered
 * title, llm_call category, summary attrs (plus the envelope run_id the
 * detail renderer needs to fetch /runs/:id/turns/:n/context), and the
 * message_refs table riding along as input JSON.
 */
import { describe, expect, it } from "bun:test";

import { EventType, type PiRequestSnapshotData, type TraceEvent } from "../types";

import type { PairedEvent } from "./pairEvents";
import { categoryFor, extractSpanPayload, statusFor, titleFor } from "./spanAttributes";

function attr(payload: ReturnType<typeof extractSpanPayload>, key: string): string | undefined {
  const value = payload.attributes?.find((a) => a.key === key)?.value;
  return value?.stringValue ?? value?.intValue;
}

const snapshotData: PiRequestSnapshotData = {
  turn_number: 3,
  system_prompt_blob_hash: "b1-sys",
  prompt_hash: "pk1-abc",
  message_count: 2,
  message_refs: [
    { blob_hash: "b1-m0", role: "user", index: 0, text_chars: 120, image_count: 1, tool_call_count: 0 },
    { blob_hash: "b1-m1", role: "assistant", index: 1, text_chars: 340, image_count: 0, tool_call_count: 2 },
  ],
  total_text_chars: 460,
  total_image_count: 1,
};

function snapshotEvent(): TraceEvent {
  return {
    eventId: "evt-snap",
    containerId: "c1",
    runId: "run-42",
    type: EventType.PI_REQUEST_SNAPSHOT,
    source: "kernel" as TraceEvent["source"],
    traceLevel: 2,
    eventData: snapshotData,
    timestamp: "2026-07-22T00:00:00.000Z",
  };
}

describe("pi_request_snapshot spans", () => {
  const paired: PairedEvent = { kind: "point", event: snapshotEvent() };

  it("titles by turn number and categorizes as llm_call", () => {
    expect(titleFor(paired)).toBe("Turn 3");
    expect(categoryFor(EventType.PI_REQUEST_SNAPSHOT)).toBe("llm_call");
    expect(statusFor(paired)).toBe("success");
  });

  it("exposes summary attrs including the envelope run_id", () => {
    const payload = extractSpanPayload(paired);
    expect(attr(payload, "run_id")).toBe("run-42");
    expect(attr(payload, "turn_number")).toBe("3");
    expect(attr(payload, "prompt_hash")).toBe("pk1-abc");
    expect(attr(payload, "message_count")).toBe("2");
    expect(attr(payload, "total_text_chars")).toBe("460");
    expect(attr(payload, "total_image_count")).toBe("1");
    expect(attr(payload, "trace_level")).toBe("2");
  });

  it("carries the message refs as input JSON for the renderer table", () => {
    const payload = extractSpanPayload(paired);
    expect(payload.input).toBe(JSON.stringify(snapshotData.message_refs));
  });

  it("omits the tool-roster attrs when the snapshot did not capture one", () => {
    // Every snapshot written before tool capture existed looks like this. No
    // attribute at all — the TOOLS tab must not read absence as "zero tools".
    const payload = extractSpanPayload(paired);
    expect(payload.attributes?.some((a) => a.key === "tools_blob_hash")).toBe(false);
    expect(payload.attributes?.some((a) => a.key === "tool_count")).toBe(false);
  });

  it("exposes the tool-roster attrs when the snapshot captured one", () => {
    const withTools: PairedEvent = {
      kind: "point",
      event: {
        ...snapshotEvent(),
        eventData: {
          ...snapshotData,
          tools_blob_hash: "b1-tools",
          tool_count: 3,
        } satisfies PiRequestSnapshotData,
      },
    };
    const payload = extractSpanPayload(withTools);
    expect(attr(payload, "tools_blob_hash")).toBe("b1-tools");
    expect(attr(payload, "tool_count")).toBe("3");
  });

  it("keeps tool_count 0 — a captured empty roster is not the same as no capture", () => {
    const emptyRoster: PairedEvent = {
      kind: "point",
      event: {
        ...snapshotEvent(),
        eventData: {
          ...snapshotData,
          tools_blob_hash: "b1-empty",
          tool_count: 0,
        } satisfies PiRequestSnapshotData,
      },
    };
    const payload = extractSpanPayload(emptyRoster);
    expect(attr(payload, "tool_count")).toBe("0");
  });

  it("omits tools_blob_hash when the snapshot carries an explicit null", () => {
    const nulled: PairedEvent = {
      kind: "point",
      event: {
        ...snapshotEvent(),
        eventData: {
          ...snapshotData,
          tools_blob_hash: null,
        } satisfies PiRequestSnapshotData,
      },
    };
    const payload = extractSpanPayload(nulled);
    expect(payload.attributes?.some((a) => a.key === "tools_blob_hash")).toBe(false);
  });

  it("does not stamp run_id on other event types", () => {
    const other: PairedEvent = {
      kind: "point",
      event: { ...snapshotEvent(), type: EventType.USER_MESSAGE, eventData: { content: "hi" } },
    };
    expect(attr(extractSpanPayload(other), "run_id")).toBeUndefined();
  });
});
