/**
 * phaseGrouping.ts — Phase extraction + root-agent bucketing under phases.
 *
 * phase_start/end events become synthetic container spans (`phase:<name>`).
 * Root PI-agent spans get placed under the phase whose name matches the
 * agent's explicit phase attribute set at span build time. Agents without a
 * phase fall into the synthetic "phase:setup" container so nothing renders
 * at the session root.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType, type TraceEvent, type PhaseStartData, type PhaseEndData } from "../types";

import { makeAttr, readStringAttr } from "./spanAttributes";

export function formatPhaseTitle(phase: string): string {
  return phase
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type PhaseRange = { start: Date; end: Date | null };

export function extractPhaseSpans(events: TraceEvent[]): Map<string, PhaseRange> {
  const map = new Map<string, PhaseRange>();
  for (const event of events) {
    if (event.type === EventType.PHASE_START) {
      const data = event.eventData as PhaseStartData | null;
      if (data?.phase && !map.has(data.phase)) {
        map.set(data.phase, { start: new Date(event.timestamp), end: null });
      }
    } else if (event.type === EventType.PHASE_END) {
      const data = event.eventData as PhaseEndData | null;
      if (data?.phase) {
        const entry = map.get(data.phase);
        if (entry) entry.end = new Date(event.timestamp);
      }
    }
  }
  return map;
}

export function groupAgentsByPhase(
  rootAgents: TraceSpan[],
  phaseMap: Map<string, PhaseRange>,
): TraceSpan[] {
  const setupChildren: TraceSpan[] = [];

  const phaseChildren = new Map<string, TraceSpan[]>();
  for (const name of phaseMap.keys()) phaseChildren.set(name, []);

  const phases = Array.from(phaseMap.entries()).sort(
    (a, b) => a[1].start.getTime() - b[1].start.getTime(),
  );

  for (const agent of rootAgents) {
    const phase = readStringAttr(agent, "phase");
    if (phase && phaseChildren.has(phase)) {
      phaseChildren.get(phase)!.push(agent);
    } else {
      const t = agent.startTime.getTime();
      const match = phases.find(([, range]) => {
        const end = range.end?.getTime() ?? Infinity;
        return t >= range.start.getTime() && t <= end;
      });
      if (match) {
        phaseChildren.get(match[0])!.push(agent);
      } else {
        setupChildren.push(agent);
      }
    }
  }

  const firstPhaseStart = phases[0]?.[1].start.getTime() ?? Infinity;

  const result: TraceSpan[] = [];
  for (const [phase, range] of phaseMap.entries()) {
    const children = phaseChildren.get(phase) ?? [];
    const end =
      range.end ??
      (children.length > 0
        ? new Date(Math.max(...children.map((c) => c.endTime.getTime())))
        : range.start);
    result.push({
      id: `phase:${phase}`,
      title: formatPhaseTitle(phase),
      startTime: range.start,
      endTime: end,
      duration: end.getTime() - range.start.getTime(),
      type: "agent_invocation",
      status: "success",
      raw: JSON.stringify({ phase, start: range.start, end: range.end }),
      attributes: [makeAttr("event_type", "phase_container")!],
      children,
    });
  }
  if (setupChildren.length > 0) {
    const setupStart = Math.min(...setupChildren.map((c) => c.startTime.getTime()));
    const childrenMaxEnd = Math.max(...setupChildren.map((c) => c.endTime.getTime()));
    const setupEnd =
      firstPhaseStart !== Infinity
        ? Math.max(childrenMaxEnd, firstPhaseStart - 1)
        : childrenMaxEnd;
    result.unshift({
      id: "phase:setup",
      title: "Setup",
      startTime: new Date(setupStart),
      endTime: new Date(setupEnd),
      duration: setupEnd - setupStart,
      type: "agent_invocation",
      status: "success",
      raw: JSON.stringify({ phase: "setup", synthetic: true }),
      attributes: [makeAttr("event_type", "phase_container")!],
      children: setupChildren,
    });
  }
  return result;
}
