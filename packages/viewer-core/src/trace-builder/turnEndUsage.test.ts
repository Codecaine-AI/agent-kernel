import { describe, expect, it } from "bun:test";

import type {
  TraceSpan,
  TraceSpanAttribute,
} from "@evilmartians/agent-prism-types";

import { EventType, type PiTurnEndData, type TraceEvent } from "../types";

import { foldTurnEndUsageOntoTurns } from "./nesting";
import { toEventSpan } from "./spanFactories";

function eventSpan(
  eventId: string,
  type: string,
  eventData: TraceEvent["eventData"],
): TraceSpan {
  const event: TraceEvent = {
    eventId,
    containerId: "container-1",
    runId: null,
    piSessionId: "pi-1",
    type,
    source: "kernel",
    traceLevel: 2,
    eventData,
    timestamp: "2026-07-27T00:00:00.000Z",
  };
  return toEventSpan({ kind: "point", event });
}

function turn(eventId: string, turnNumber: number): TraceSpan {
  return eventSpan(eventId, EventType.PI_REQUEST_SNAPSHOT, {
    turn_number: turnNumber,
    system_prompt_blob_hash: null,
    prompt_hash: null,
    message_count: 0,
    message_refs: [],
    total_text_chars: 0,
    total_image_count: 0,
  });
}

function turnEnd(
  eventId: string,
  turnNumber: number,
  usage: PiTurnEndData["usage"] = {
    inputTokens: 19576,
    outputTokens: 86,
    cacheReadTokens: 6656,
    cacheWriteTokens: 0,
    model: "gpt-5.6-sol",
    costEstimate: 0,
  },
): TraceSpan {
  return eventSpan(eventId, EventType.PI_TURN_END, {
    turn_number: turnNumber,
    stop_reason: "toolUse",
    usage,
  });
}

function attr(span: TraceSpan, key: string): string | boolean | undefined {
  const value = span.attributes?.find((attribute) => attribute.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue;
}

function indexes(spans: TraceSpan[]): Map<string, string> {
  return new Map(
    spans.map((span) => [
      span.id,
      span.title.startsWith("Turn ")
        ? EventType.PI_REQUEST_SNAPSHOT
        : EventType.PI_TURN_END,
    ]),
  );
}

describe("foldTurnEndUsageOntoTurns", () => {
  it("copies usage to the same turn and run without mutating or consuming source spans", () => {
    const sourceTurn = turn("turn-1", 1);
    const existingModel: TraceSpanAttribute = {
      key: "model",
      value: { stringValue: "existing-model" },
    };
    sourceTurn.attributes = [...(sourceTurn.attributes ?? []), existingModel];
    const sourceEnd = turnEnd("end-1", 1);
    const spans = [sourceTurn, sourceEnd];
    const runIds = new Map([
      [sourceTurn.id, "run-1"],
      [sourceEnd.id, "run-1"],
    ]);

    const result = foldTurnEndUsageOntoTurns(spans, indexes(spans), runIds);

    expect(result).toHaveLength(2);
    expect(result[0]).not.toBe(sourceTurn);
    expect(result[1]).toBe(sourceEnd);
    expect(attr(result[0], "input_tokens")).toBe("19576");
    expect(attr(result[0], "output_tokens")).toBe("86");
    expect(attr(result[0], "cache_read_tokens")).toBe("6656");
    expect(attr(result[0], "cache_write_tokens")).toBe("0");
    expect(attr(result[0], "cost_estimate")).toBe("0");
    expect(attr(result[0], "model")).toBe("existing-model");
    expect(
      result[0].attributes?.filter((attribute) => attribute.key === "model"),
    ).toHaveLength(1);
    expect(attr(sourceTurn, "input_tokens")).toBeUndefined();
    expect(attr(sourceEnd, "input_tokens")).toBe("19576");
  });

  it("uses runId to disambiguate repeated turn numbers in one PI session", () => {
    const run1Turn = turn("turn-run-1", 0);
    const run2Turn = turn("turn-run-2", 0);
    const run2End = turnEnd("end-run-2", 0, {
      inputTokens: 222,
      outputTokens: 22,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      model: "model-2",
    });
    const run1End = turnEnd("end-run-1", 0, {
      inputTokens: 111,
      outputTokens: 11,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      model: "model-1",
    });
    const spans = [run1Turn, run2Turn, run2End, run1End];
    const runIds = new Map([
      [run1Turn.id, "run-1"],
      [run1End.id, "run-1"],
      [run2Turn.id, "run-2"],
      [run2End.id, "run-2"],
    ]);

    const result = foldTurnEndUsageOntoTurns(spans, indexes(spans), runIds);

    expect(attr(result[0], "input_tokens")).toBe("111");
    expect(attr(result[0], "model")).toBe("model-1");
    expect(attr(result[1], "input_tokens")).toBe("222");
    expect(attr(result[1], "model")).toBe("model-2");
  });

  it("does nothing when turn numbers differ or both present runIds conflict", () => {
    const differentTurn = turn("turn-different", 2);
    const differentEnd = turnEnd("end-different", 3);
    const wrongRunTurn = turn("turn-wrong-run", 4);
    const wrongRunEnd = turnEnd("end-wrong-run", 4);
    const spans = [differentTurn, differentEnd, wrongRunTurn, wrongRunEnd];
    const runIds = new Map([
      [differentTurn.id, "run-1"],
      [differentEnd.id, "run-1"],
      [wrongRunTurn.id, "run-1"],
      [wrongRunEnd.id, "run-2"],
    ]);

    const result = foldTurnEndUsageOntoTurns(spans, indexes(spans), runIds);

    expect(result).toEqual(spans);
    expect(attr(result[0], "input_tokens")).toBeUndefined();
    expect(attr(result[2], "input_tokens")).toBeUndefined();
  });

  it("matches by PI bucket and turn when either runId is absent, and is idempotent", () => {
    const sourceTurn = turn("turn-legacy", 5);
    const sourceEnd = turnEnd("end-legacy", 5);
    const spans = [sourceTurn, sourceEnd];
    const typeById = indexes(spans);
    const once = foldTurnEndUsageOntoTurns(
      spans,
      typeById,
      new Map([[sourceEnd.id, "run-1"]]),
    );
    const twice = foldTurnEndUsageOntoTurns(
      once,
      typeById,
      new Map([[sourceEnd.id, "run-1"]]),
    );

    expect(attr(once[0], "input_tokens")).toBe("19576");
    expect(twice).toEqual(once);
    expect(
      twice[0].attributes?.filter((attribute) => attribute.key === "input_tokens"),
    ).toHaveLength(1);
  });
});
