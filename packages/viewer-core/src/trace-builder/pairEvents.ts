/**
 * pairEvents.ts — Pair start/end TraceEvents into duration-bearing PairedEvent records.
 *
 * Handles four pairings driven by different keys:
 *   - tool_call_start/end  → protocol spanId, with a LIFO fallback per
 *     (piSessionId, tool_name) for legacy events that lack a spanId
 *   - agent_run_start/end  → keyed by eventData.run_id
 *   - context_build_*      → keyed by spanId
 *   - ui_ask_requested/answered → keyed by eventData.tool_use_id
 *
 * Unpaired / unknown events flow through as `point` entries preserving input order.
 */

import {
  EventType,
  UI_ASK_ANSWERED,
  UI_ASK_REQUESTED,
  type TraceEvent,
  type ToolCallEndData,
  type ToolCallStartData,
} from "../types";

export type PairedEvent =
  | { kind: "point"; event: TraceEvent }
  | { kind: "pair"; start: TraceEvent; end: TraceEvent };

interface KeyedPairing {
  startType: string;
  endType: string;
  /** Correlation key shared by the start and end event; unkeyed events stay points. */
  keyOf: (event: TraceEvent) => string | undefined;
}

const KEYED_PAIRINGS: KeyedPairing[] = [
  {
    startType: EventType.AGENT_RUN_START,
    endType: EventType.AGENT_RUN_END,
    keyOf: (event) => (event.eventData as { run_id?: string } | null)?.run_id,
  },
  {
    startType: EventType.CONTEXT_BUILD_STARTED,
    endType: EventType.CONTEXT_BUILD_COMPLETED,
    keyOf: (event) => event.spanId ?? undefined,
  },
  {
    startType: UI_ASK_REQUESTED,
    endType: UI_ASK_ANSWERED,
    keyOf: (event) => (event.eventData as { tool_use_id?: string } | null)?.tool_use_id,
  },
];

export function pairEvents(events: TraceEvent[]): PairedEvent[] {
  const result: PairedEvent[] = [];

  // Open starts per keyed pairing: correlation key → index into result.
  const openStarts = KEYED_PAIRINGS.map(() => new Map<string, number>());
  // Tool-call starts: exact spanId matching, LIFO-by-name fallback for legacy rows.
  const toolStartsBySpanId = new Map<string, number>();
  const toolStacks = new Map<string, { name: string; idx: number }[]>();

  const pushPoint = (event: TraceEvent): number => {
    result.push({ kind: "point", event });
    return result.length - 1;
  };

  const upgradeToPair = (startIdx: number, end: TraceEvent) => {
    const startEntry = result[startIdx];
    if (startEntry.kind === "point") {
      result[startIdx] = { kind: "pair", start: startEntry.event, end };
    }
  };

  const matchToolStart = (event: TraceEvent): number => {
    // Prefer spanId for exact matching
    if (event.spanId && toolStartsBySpanId.has(event.spanId)) {
      const idx = toolStartsBySpanId.get(event.spanId)!;
      toolStartsBySpanId.delete(event.spanId);
      return idx;
    }
    // Fallback to LIFO by (piSessionId, tool_name)
    const data = event.eventData as ToolCallEndData | null;
    const stack = toolStacks.get(event.piSessionId ?? "");
    const toolName = data?.tool_name ?? "";
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === toolName) {
          const { idx } = stack[i];
          stack.splice(i, 1);
          return idx;
        }
      }
    }
    return -1;
  };

  for (const event of events) {
    if (event.type === EventType.TOOL_CALL_START) {
      const idx = pushPoint(event);
      if (event.spanId) {
        toolStartsBySpanId.set(event.spanId, idx);
      } else {
        const data = event.eventData as ToolCallStartData | null;
        const piId = event.piSessionId ?? "";
        let stack = toolStacks.get(piId);
        if (!stack) {
          stack = [];
          toolStacks.set(piId, stack);
        }
        stack.push({ name: data?.tool_name ?? "", idx });
      }
      continue;
    }
    if (event.type === EventType.TOOL_CALL_END) {
      const matchedIdx = matchToolStart(event);
      if (matchedIdx >= 0) upgradeToPair(matchedIdx, event);
      else pushPoint(event);
      continue;
    }

    const startPairing = KEYED_PAIRINGS.findIndex((p) => p.startType === event.type);
    if (startPairing >= 0) {
      const idx = pushPoint(event);
      const key = KEYED_PAIRINGS[startPairing].keyOf(event);
      if (key) openStarts[startPairing].set(key, idx);
      continue;
    }

    const endPairing = KEYED_PAIRINGS.findIndex((p) => p.endType === event.type);
    if (endPairing >= 0) {
      const key = KEYED_PAIRINGS[endPairing].keyOf(event);
      const startIdx = key ? openStarts[endPairing].get(key) : undefined;
      if (key && startIdx !== undefined) {
        openStarts[endPairing].delete(key);
        upgradeToPair(startIdx, event);
      } else {
        pushPoint(event);
      }
      continue;
    }

    pushPoint(event);
  }

  return result;
}
