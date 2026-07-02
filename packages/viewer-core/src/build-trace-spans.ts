/**
 * buildTraceSpans.ts — Orchestrator that turns raw TraceEvents + PI session +
 * AgentRun rows into a TraceSpan tree for trace-viewer TreeView.
 *
 * Pipeline (each stage lives in ./trace-builder/):
 *   pairEvents         → fold start/end pairs into PairedEvent
 *   toEventSpans       → PairedEvent → TraceSpan, bucketed per PI session
 *   nestPiSpans        → context inputs → provisioning → per-turn grouping
 *   wrapSpansInRuns    → drop each PI bucket's spans into agent_run wrappers
 *   buildAgentForest   → PI spans hosted under their spawner's tool_call
 *   collectContainerRanges → container events + summaries → ContainerRange map
 *   groupRoots         → hoist roots under phase and/or container spans
 *
 * Debug: set localStorage.TRACE_BUILDER_DEBUG='1' to log stage-by-stage
 * counts (paired events, pi buckets, runs matched vs orphaned, roots, phases).
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType, type AgentRun, type KernelContainerSummary, type TraceEvent } from "./types";
import type { PiAgentSession } from "./types";

import { pairEvents, type PairedEvent } from "./trace-builder/pairEvents";
import { toAgentSpan, toEventSpan, toRunSpan } from "./trace-builder/spanFactories";
import { bucketSpansByRun, sortRunsByStart } from "./trace-builder/runBucketing";
import {
  findToolCallSpanByToolUseId,
  groupContextInputsByBuild,
  groupProvisioningSpans,
  groupSpansByUserMessage,
} from "./trace-builder/nesting";
import { extractPhaseSpans, groupAgentsByPhase, type PhaseRange } from "./trace-builder/phaseGrouping";
import {
  containerSummariesToRanges,
  extractContainerSpans,
  groupAgentsByContainer,
  type ContainerRange,
} from "./trace-builder/containerGrouping";

/** Rendered as phase/container grouping spans, never as event spans. */
const STRUCTURAL_EVENT_TYPES = new Set<string>([
  EventType.PHASE_START,
  EventType.PHASE_END,
  EventType.CONTAINER_START,
  EventType.CONTAINER_END,
]);

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

/**
 * Side tables the nesting/bucketing stages need about each event span,
 * keyed by span id (nesting stages receive bare TraceSpans).
 */
interface EventSpanIndex {
  /** span id → source event type. */
  typeById: Map<string, string>;
  /** span id → protocol spanId (spawn/run lifecycle correlation). */
  protocolSpanIdById: Map<string, string>;
  /** span id → envelope runId; explicit run linkage stamped at emit time,
   * preferred over timestamp reconstruction wherever the emitter set it. */
  runIdBySpanId: Map<string, string>;
}

interface EventSpanBuckets {
  /** Event spans per PI session, sorted by startTime. */
  spansByPi: Map<string, TraceSpan[]>;
  /** Event spans with no piSessionId (app-level seed events). */
  orphanSpans: TraceSpan[];
  index: EventSpanIndex;
}

/** Stage: PairedEvent → TraceSpan, bucketed by piSessionId (structural events skipped). */
function toEventSpans(paired: PairedEvent[]): EventSpanBuckets {
  const spansByPi = new Map<string, TraceSpan[]>();
  const orphanSpans: TraceSpan[] = [];
  const index: EventSpanIndex = {
    typeById: new Map(),
    protocolSpanIdById: new Map(),
    runIdBySpanId: new Map(),
  };

  for (const p of paired) {
    const sourceEvent = p.kind === "pair" ? p.start : p.event;
    if (STRUCTURAL_EVENT_TYPES.has(sourceEvent.type)) continue;

    const span = toEventSpan(p);
    index.typeById.set(span.id, sourceEvent.type);
    if (sourceEvent.spanId) index.protocolSpanIdById.set(span.id, sourceEvent.spanId);
    if (sourceEvent.runId) index.runIdBySpanId.set(span.id, sourceEvent.runId);

    if (!sourceEvent.piSessionId) {
      orphanSpans.push(span);
      continue;
    }
    const list = spansByPi.get(sourceEvent.piSessionId);
    if (list) list.push(span);
    else spansByPi.set(sourceEvent.piSessionId, [span]);
  }

  for (const list of spansByPi.values()) {
    list.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  return { spansByPi, orphanSpans, index };
}

/** Stage: nest each PI bucket — context inputs under their build, provisioning wrapper, one block per user turn. */
function nestPiSpans(spansByPi: Map<string, TraceSpan[]>, index: EventSpanIndex): void {
  for (const [piId, list] of spansByPi.entries()) {
    const contextGrouped = groupContextInputsByBuild(list, index.typeById, index.protocolSpanIdById);
    const provisioningGrouped = groupProvisioningSpans(
      contextGrouped,
      index.typeById,
      index.protocolSpanIdById,
    );
    spansByPi.set(piId, groupSpansByUserMessage(provisioningGrouped, index.typeById));
  }
}

/** Stage: wrap one PI session's spans into Run #n containers (skipped for single-run sessions). */
function wrapSpansInRuns(
  piId: string,
  children: TraceSpan[],
  runsByPi: Map<string, AgentRun[]>,
  runIdBySpanId: Map<string, string>,
): TraceSpan[] {
  const runs = runsByPi.get(piId);
  if (!runs || runs.length === 0) return children;
  // CP3: single-run pi sessions (kickoff path) skip the Run wrapper — distinct sibling agents render at their own level instead of nested under Run #1.
  if (runs.length === 1) {
    debugLog("wrapSpansInRuns", { piId, runCount: 1, skipped: true });
    return children;
  }
  const { runBuckets, orphans } = bucketSpansByRun(children, runs, runIdBySpanId);
  const sorted = sortRunsByStart(runs);
  const wrapped = sorted.map((r, index) =>
    toRunSpan(r, runBuckets.get(r.id) ?? [], index + 1),
  );
  debugLog("wrapSpansInRuns", {
    piId,
    runCount: sorted.length,
    skipped: false,
    wrappedSizes: wrapped.map((w) => w.children?.length ?? 0),
    intraPiOrphans: orphans.length,
  });
  return [...wrapped, ...orphans];
}

/**
 * Stage: PI sessions → agent spans; sub-agents nest under their spawner's
 * tool_call span (parentSessionId + parentToolUseId), the rest are roots.
 */
function buildAgentForest(
  piSessions: PiAgentSession[],
  agentRuns: AgentRun[],
  buckets: EventSpanBuckets,
): TraceSpan[] {
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
    piBuckets: Array.from(buckets.spansByPi.entries()).map(([piId, spans]) => ({
      piId,
      spans: spans.length,
      runs: runsByPi.get(piId)?.length ?? 0,
    })),
    orphanSpans: buckets.orphanSpans.length,
  });

  const agentSpansById = new Map<string, TraceSpan>();
  for (const pi of piSessions) {
    const children = wrapSpansInRuns(
      pi.id,
      buckets.spansByPi.get(pi.id) ?? [],
      runsByPi,
      buckets.index.runIdBySpanId,
    );
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
        ? (findToolCallSpanByToolUseId(parentSpan, parentToolUseId, buckets.index.typeById) ?? parentSpan)
        : parentSpan;
      host.children = host.children ?? [];
      host.children.push(span);
    } else {
      roots.push(span);
    }
  }

  roots.push(...buckets.orphanSpans);
  roots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return roots;
}

/**
 * Stage: container ranges from container_start/end events, backfilled with
 * persisted container summaries (event-derived start/end/phase win).
 */
function collectContainerRanges(
  events: TraceEvent[],
  containers: KernelContainerSummary[],
): Map<string, ContainerRange> {
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
  return containerMap;
}

/** Stage: hoist root spans under phase containers, then nest each phase's roots by container. */
function groupRoots(
  roots: TraceSpan[],
  phaseMap: Map<string, PhaseRange>,
  containerMap: Map<string, ContainerRange>,
): TraceSpan[] {
  const grouped = phaseMap.size > 0 ? groupAgentsByPhase(roots, phaseMap) : roots;
  if (containerMap.size === 0) return grouped;
  if (phaseMap.size === 0) return groupAgentsByContainer(grouped, containerMap);

  return grouped.map((span) => {
    if (!span.id.startsWith("phase:")) return span;
    const phaseName = span.id.replace("phase:", "");
    const phaseContainerMap = new Map(
      [...containerMap].filter(([, r]) => r.phase === phaseName || r.phase === null),
    );
    return { ...span, children: groupAgentsByContainer(span.children ?? [], phaseContainerMap) };
  });
}

export function buildTraceSpans(
  events: TraceEvent[],
  piSessions: PiAgentSession[],
  agentRuns: AgentRun[] = [],
  containers: KernelContainerSummary[] = [],
): TraceSpan[] {
  debugLog("inputs", {
    events: events.length,
    piSessions: piSessions.length,
    agentRuns: agentRuns.length,
    containers: containers.length,
    eventsWithNullPi: events.reduce((n, e) => n + (e.piSessionId ? 0 : 1), 0),
  });

  const buckets = toEventSpans(pairEvents(events));
  nestPiSpans(buckets.spansByPi, buckets.index);
  const roots = buildAgentForest(piSessions, agentRuns, buckets);

  const phaseMap = extractPhaseSpans(events);
  const containerMap = collectContainerRanges(events, containers);
  const final = groupRoots(roots, phaseMap, containerMap);

  debugLog("output", {
    phases: phaseMap.size,
    containers: containerMap.size,
    rootsBeforePhases: roots.length,
    finalTopLevel: final.length,
  });

  return final;
}
