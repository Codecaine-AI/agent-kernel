/**
 * buildTraceSpans.ts — Orchestrator that turns raw TraceEvents + PI session +
 * AgentRun rows into a TraceSpan tree for trace-viewer TreeView.
 *
 * Pipeline (each step lives in ./trace-builder/):
 *   pairEvents         → fold start/end pairs into PairedEvent
 *   spanFactories      → PairedEvent → TraceSpan (event rows)
 *   nesting            → group spans under their user_message (per turn)
 *   runBucketing       → drop per-PI spans into agent_runs by timestamp
 *   spanFactories      → toRunSpan / toAgentSpan wrap the buckets
 *   nesting.findToolCallSpanByToolUseId → host sub-agents under spawner's tool_call by parent_tool_use_id
 *   phaseGrouping      → hoist root agent spans under phase containers
 *
 * Debug: set localStorage.TRACE_BUILDER_DEBUG='1' to log stage-by-stage
 * counts (paired events, pi buckets, runs matched vs orphaned, roots, phases).
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType, type AgentRun, type KernelContainerSummary, type TraceEvent } from "./types";
import type { PiAgentSession } from "./types";

import { pairEvents } from "./trace-builder/pairEvents";
import { toAgentSpan, toEventSpan, toRunSpan } from "./trace-builder/spanFactories";
import { bucketSpansByRun, sortRunsByStart } from "./trace-builder/runBucketing";
import {
  findToolCallSpanByToolUseId,
  groupContextInputsByBuild,
  groupProvisioningSpans,
  groupSpansByUserMessage,
} from "./trace-builder/nesting";
import { extractPhaseSpans, groupAgentsByPhase } from "./trace-builder/phaseGrouping";
import { containerSummariesToRanges, extractContainerSpans, groupAgentsByContainer } from "./trace-builder/containerGrouping";

function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("TRACE_BUILDER_DEBUG") === "1";
  } catch {
    return false;
  }
}

function debugLog(label: string, payload: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  console.log(`[trace-builder] ${label}`, payload);
}

export function buildTraceSpans(
  events: TraceEvent[],
  piSessions: PiAgentSession[],
  agentRuns: AgentRun[] = [],
  containers: KernelContainerSummary[] = [],
): TraceSpan[] {
  const nullPiCount = events.reduce(
    (n, e) => n + (e.piSessionId ? 0 : 1),
    0,
  );
  debugLog("inputs", {
    events: events.length,
    piSessions: piSessions.length,
    agentRuns: agentRuns.length,
    containers: containers.length,
    eventsWithNullPi: nullPiCount,
  });

  const paired = pairEvents(events);

  const eventsByPi = new Map<string, TraceSpan[]>();
  const orphanSpans: TraceSpan[] = [];
  const typeById = new Map<string, string>();
  const protocolSpanIdById = new Map<string, string>();
  // Explicit run linkage from the envelope: span id → runId. Preferred over
  // timestamp reconstruction wherever the emitter stamped it.
  const runIdBySpanId = new Map<string, string>();

  for (const p of paired) {
    const sourceEvent = p.kind === "pair" ? p.start : p.event;
    if (
      sourceEvent.type === EventType.PHASE_START ||
      sourceEvent.type === EventType.PHASE_END ||
      sourceEvent.type === EventType.CONTAINER_START ||
      sourceEvent.type === EventType.CONTAINER_END
    ) {
      continue;
    }
    const span = toEventSpan(p);
    typeById.set(span.id, sourceEvent.type);
    if (sourceEvent.spanId) protocolSpanIdById.set(span.id, sourceEvent.spanId);
    if (sourceEvent.runId) runIdBySpanId.set(span.id, sourceEvent.runId);
    if (!sourceEvent.piSessionId) {
      orphanSpans.push(span);
      continue;
    }
    const list = eventsByPi.get(sourceEvent.piSessionId);
    if (list) list.push(span);
    else eventsByPi.set(sourceEvent.piSessionId, [span]);
  }

  for (const list of eventsByPi.values()) {
    list.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  for (const [piId, list] of eventsByPi.entries()) {
    const contextGrouped = groupContextInputsByBuild(list, typeById, protocolSpanIdById);
    const provisioningGrouped = groupProvisioningSpans(
      contextGrouped,
      typeById,
      protocolSpanIdById,
    );
    eventsByPi.set(piId, groupSpansByUserMessage(provisioningGrouped, typeById));
  }

  const runsByPi = new Map<string, AgentRun[]>();
  for (const r of agentRuns) {
    const list = runsByPi.get(r.piSessionId);
    if (list) list.push(r);
    else runsByPi.set(r.piSessionId, [r]);
  }

  const firstRunByPi = new Map<string, AgentRun>();
  for (const [piId, runs] of runsByPi.entries()) {
    const first = sortRunsByStart(runs)[0] ?? null;
    if (first) firstRunByPi.set(piId, first);
  }

  debugLog("bucketing", {
    piBuckets: Array.from(eventsByPi.entries()).map(([piId, spans]) => ({
      piId,
      spans: spans.length,
      runs: runsByPi.get(piId)?.length ?? 0,
    })),
    orphanSpans: orphanSpans.length,
  });

  function wrapChildrenInRuns(piId: string, children: TraceSpan[]): TraceSpan[] {
    const runs = runsByPi.get(piId);
    if (!runs || runs.length === 0) return children;
    // CP3: single-run pi sessions (kickoff path) skip the Run wrapper — distinct sibling agents render at their own level instead of nested under Run #1.
    if (runs.length === 1) {
      debugLog("wrapChildrenInRuns", {
        piId,
        runCount: 1,
        skipped: true,
      });
      return children;
    }
    const { runBuckets, orphans } = bucketSpansByRun(children, runs, runIdBySpanId);
    const sorted = sortRunsByStart(runs);
    const wrapped = sorted.map((r, index) =>
      toRunSpan(r, runBuckets.get(r.id) ?? [], index + 1),
    );
    debugLog("wrapChildrenInRuns", {
      piId,
      runCount: sorted.length,
      skipped: false,
      wrappedSizes: wrapped.map((w) => w.children?.length ?? 0),
      intraPiOrphans: orphans.length,
    });
    return [...wrapped, ...orphans];
  }

  const agentSpansById = new Map<string, TraceSpan>();

  for (const pi of piSessions) {
    const children = wrapChildrenInRuns(pi.id, eventsByPi.get(pi.id) ?? []);
    agentSpansById.set(pi.id, toAgentSpan(pi, children));
  }

  const roots: TraceSpan[] = [];
  for (const pi of piSessions) {
    const span = agentSpansById.get(pi.id);
    if (!span) continue;
    if (pi.parentSessionId && agentSpansById.has(pi.parentSessionId)) {
      const parentSpan = agentSpansById.get(pi.parentSessionId)!;
      // Explicit linkage: the session row carries parent_tool_use_id; the
      // first run's parent_tool_use_id remains as a fallback for older rows.
      const parentToolUseId =
        pi.parentToolUseId ?? firstRunByPi.get(pi.id)?.parentToolUseId ?? null;
      const host = parentToolUseId
        ? (findToolCallSpanByToolUseId(parentSpan, parentToolUseId, typeById) ?? parentSpan)
        : parentSpan;
      host.children = host.children ?? [];
      host.children.push(span);
    } else {
      roots.push(span);
    }
  }

  roots.push(...orphanSpans);
  roots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const phaseMap = extractPhaseSpans(events);
  const containerMap = extractContainerSpans(events);
  for (const [id, range] of containerSummariesToRanges(containers)) {
    if (!containerMap.has(id)) {
      containerMap.set(id, range);
      continue;
    }
    const existing = containerMap.get(id)!;
    containerMap.set(id, {
      ...range,
      start: existing.start,
      end: existing.end ?? range.end,
      phase: existing.phase ?? range.phase,
    });
  }
  let final = phaseMap.size > 0 ? groupAgentsByPhase(roots, phaseMap) : roots;

  if (containerMap.size > 0) {
    if (phaseMap.size > 0) {
      final = final.map((span) => {
        if (!span.id.startsWith("phase:")) return span;
        const phaseName = span.id.replace("phase:", "");
        const phaseContainerMap = new Map(
          [...containerMap].filter(([, r]) => r.phase === phaseName || r.phase === null),
        );
        return { ...span, children: groupAgentsByContainer(span.children ?? [], phaseContainerMap) };
      });
    } else {
      final = groupAgentsByContainer(final, containerMap);
    }
  }

  debugLog("output", {
    phases: phaseMap.size,
    containers: containerMap.size,
    rootsBeforePhases: roots.length,
    finalTopLevel: final.length,
  });

  return final;
}
