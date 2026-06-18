/**
 * pairEvents.ts — Pair start/end TraceEvents into duration-bearing PairedEvent records.
 *
 * Handles four pairings driven by different keys:
 *   - tool_call_start/end  → LIFO per (piSessionId, tool_name) so nested tools pair correctly
 *   - agent_run_start/end  → keyed by eventData.run_id
 *   - context_build_*      → keyed by spanId
 *   - ui_ask_requested/answered → keyed by eventData.tool_use_id
 *
 * Unpaired / unknown events flow through as `point` entries preserving input order.
 */

import {
  EventType,
  type TraceEvent,
  type AgentRunEndData,
  type ToolCallEndData,
  type ToolCallStartData,
  type UIAskAnsweredData,
  type UIAskRequestedData,
} from "../types";

export type PairedEvent =
  | { kind: "point"; event: TraceEvent }
  | { kind: "pair"; start: TraceEvent; end: TraceEvent };

export function pairEvents(events: TraceEvent[]): PairedEvent[] {
  const result: PairedEvent[] = [];
  const toolStartsBySpanId = new Map<string, number>();
  const toolStacks = new Map<string, { name: string; idx: number }[]>();
  const runStarts = new Map<string, number>();
  const contextBuildStarts = new Map<string, number>();
  const uiAskStarts = new Map<string, number>();

  const upgradeToPair = (startIdx: number, end: TraceEvent) => {
    const startEntry = result[startIdx];
    if (startEntry.kind === "point") {
      result[startIdx] = { kind: "pair", start: startEntry.event, end };
    }
  };

  for (const event of events) {
    if (event.type === EventType.TOOL_CALL_START) {
      const data = event.eventData as ToolCallStartData | null;
      const idx = result.length;
      result.push({ kind: "point", event });

      // Prefer spanId for exact matching
      if (event.spanId) {
        toolStartsBySpanId.set(event.spanId, idx);
      } else {
        // Fallback to LIFO by (piSessionId, tool_name) for legacy events
        const piId = event.piSessionId ?? "";
        let stack = toolStacks.get(piId);
        if (!stack) {
          stack = [];
          toolStacks.set(piId, stack);
        }
        stack.push({ name: data?.tool_name ?? "", idx });
      }
    } else if (event.type === EventType.TOOL_CALL_END) {
      const data = event.eventData as ToolCallEndData | null;
      let matchedIdx = -1;

      // Prefer spanId for exact matching
      if (event.spanId && toolStartsBySpanId.has(event.spanId)) {
        matchedIdx = toolStartsBySpanId.get(event.spanId)!;
        toolStartsBySpanId.delete(event.spanId);
      } else {
        // Fallback to LIFO by (piSessionId, tool_name)
        const piId = event.piSessionId ?? "";
        const stack = toolStacks.get(piId);
        const toolName = data?.tool_name ?? "";
        if (stack) {
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === toolName) {
              matchedIdx = stack[i].idx;
              stack.splice(i, 1);
              break;
            }
          }
        }
      }

      if (matchedIdx >= 0) upgradeToPair(matchedIdx, event);
      else result.push({ kind: "point", event });
    } else if (event.type === EventType.AGENT_RUN_START) {
      const data = event.eventData as { run_id?: string } | null;
      const idx = result.length;
      result.push({ kind: "point", event });
      if (data?.run_id) runStarts.set(data.run_id, idx);
    } else if (event.type === EventType.AGENT_RUN_END) {
      const data = event.eventData as AgentRunEndData | null;
      const startIdx = data?.run_id ? runStarts.get(data.run_id) : undefined;
      if (startIdx !== undefined && data?.run_id) {
        runStarts.delete(data.run_id);
        upgradeToPair(startIdx, event);
      } else {
        result.push({ kind: "point", event });
      }
    } else if (event.type === EventType.CONTEXT_BUILD_STARTED) {
      const idx = result.length;
      result.push({ kind: "point", event });
      if (event.spanId) contextBuildStarts.set(event.spanId, idx);
    } else if (event.type === EventType.CONTEXT_BUILD_COMPLETED) {
      const startIdx = event.spanId
        ? contextBuildStarts.get(event.spanId)
        : undefined;
      if (startIdx !== undefined && event.spanId) {
        contextBuildStarts.delete(event.spanId);
        upgradeToPair(startIdx, event);
      } else {
        result.push({ kind: "point", event });
      }
    } else if (event.type === EventType.UI_ASK_REQUESTED) {
      const data = event.eventData as UIAskRequestedData | null;
      const idx = result.length;
      result.push({ kind: "point", event });
      if (data?.tool_use_id) uiAskStarts.set(data.tool_use_id, idx);
    } else if (event.type === EventType.UI_ASK_ANSWERED) {
      const data = event.eventData as UIAskAnsweredData | null;
      const startIdx = data?.tool_use_id
        ? uiAskStarts.get(data.tool_use_id)
        : undefined;
      if (startIdx !== undefined && data?.tool_use_id) {
        uiAskStarts.delete(data.tool_use_id);
        upgradeToPair(startIdx, event);
      } else {
        result.push({ kind: "point", event });
      }
    } else {
      result.push({ kind: "point", event });
    }
  }

  return result;
}
