/**
 * containerGrouping.ts — Pipeline-container extraction + agent nesting.
 *
 * Pairs container_start / container_end events into ContainerRange records
 * keyed by container_id, then nests root PI-agent spans under the container
 * whose id matches the agent's explicit container_id attribute set at span
 * build time (toAgentSpan). The container forest is reconstructed from
 * parent_container_id (task_group → checkpoint → outline). Pre-CP2 sessions
 * emit no container events, so callers fall through to the legacy phase-only
 * shape.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
  EventType,
  type TraceEvent,
  type ContainerStartData,
  type ContainerEndData,
  type KernelContainerSummary,
} from "../types";

import { makeAttr } from "./spanAttributes";
import { toContainerSpan } from "./spanFactories";

export type ContainerRange = {
  containerId: string;
  level: ContainerStartData["level"];
  label: string;
  producerStage: string;
  parentContainerId: string | null;
  checkpointId: number | null;
  taskGroupId: number | null;
  phase: string | null;
  status?: string | null;
  start: Date;
  end: Date | null;
};

export function extractContainerSpans(events: TraceEvent[]): Map<string, ContainerRange> {
  const map = new Map<string, ContainerRange>();
  for (const event of events) {
    if (event.type === EventType.CONTAINER_START) {
      const data = event.eventData as ContainerStartData | null;
      if (!data?.container_id) continue;
      map.set(data.container_id, {
        containerId: data.container_id,
        level: data.level,
        label: data.label,
        producerStage: data.producer_stage,
        parentContainerId: data.parent_container_id ?? null,
        checkpointId: data.checkpoint_id ?? null,
        taskGroupId: data.task_group_id ?? null,
        phase: data.phase ?? null,
        status: null,
        start: new Date(event.timestamp),
        end: null,
      });
    } else if (event.type === EventType.CONTAINER_END) {
      const data = event.eventData as ContainerEndData | null;
      if (!data?.container_id) continue;
      const entry = map.get(data.container_id);
      if (entry) entry.end = new Date(event.timestamp);
    }
  }
  return map;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function containerDepth(container: KernelContainerSummary, byId: Map<string, KernelContainerSummary>): number {
  let depth = 0;
  let parentId = container.parentContainerId ?? null;
  const seen = new Set<string>([container.id]);
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    depth += 1;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentContainerId ?? null;
  }
  return depth;
}

function rangeDepth(range: ContainerRange, byId: Map<string, ContainerRange>): number {
  let depth = 0;
  let parentId = range.parentContainerId ?? null;
  const seen = new Set<string>([range.containerId]);
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    depth += 1;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentContainerId ?? null;
  }
  return depth;
}

function summaryLevel(depth: number): ContainerStartData["level"] {
  if (depth <= 0) return "outline";
  if (depth === 1) return "checkpoint";
  return "task_group";
}

export function containerSummariesToRanges(
  containers: KernelContainerSummary[] = [],
): Map<string, ContainerRange> {
  const byId = new Map(containers.map((container) => [container.id, container]));
  const ranges = new Map<string, ContainerRange>();
  for (const container of containers) {
    const start =
      parseDate(container.startedAt) ??
      parseDate(container.createdAt) ??
      parseDate(container.updatedAt) ??
      new Date(0);
    const end = parseDate(container.completedAt);
    ranges.set(container.id, {
      containerId: container.id,
      level: summaryLevel(containerDepth(container, byId)),
      label: container.label || container.id,
      producerStage: "tasks",
      parentContainerId: container.parentContainerId ?? null,
      checkpointId: null,
      taskGroupId: null,
      phase: container.phase ?? null,
      status: container.status,
      start,
      end,
    });
  }
  return ranges;
}

function readStringAttr(span: TraceSpan, key: string): string | null {
  const found = span.attributes?.find((a) => a.key === key);
  return found?.value?.stringValue ?? null;
}

export function groupAgentsByContainer(
  rootAgents: TraceSpan[],
  containerMap: Map<string, ContainerRange>,
): TraceSpan[] {
  if (containerMap.size === 0) return rootAgents;

  const ranges = Array.from(containerMap.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  const childrenByContainer = new Map<string, TraceSpan[]>();
  for (const r of ranges) childrenByContainer.set(r.containerId, []);

  const unmatched: TraceSpan[] = [];
  for (const agent of rootAgents) {
    const containerId = readStringAttr(agent, "container_id");
    if (containerId && childrenByContainer.has(containerId)) {
      childrenByContainer.get(containerId)!.push(agent);
    } else {
      unmatched.push(agent);
    }
  }

  // Build container spans bottom-up so child containers are constructed before
  // their parents and can be picked up via parentContainerId.
  const containerSpans = new Map<string, TraceSpan>();
  const rangesById = new Map(ranges.map((range) => [range.containerId, range]));
  const reversed = ranges.slice().sort((a, b) => {
    const depthDelta = rangeDepth(b, rangesById) - rangeDepth(a, rangesById);
    if (depthDelta !== 0) return depthDelta;
    return b.start.getTime() - a.start.getTime();
  });
  for (const range of reversed) {
    const directAgents = childrenByContainer.get(range.containerId) ?? [];
    const subContainers = ranges
      .filter((r) => r.parentContainerId === range.containerId)
      .map((r) => containerSpans.get(r.containerId))
      .filter((s): s is TraceSpan => s !== undefined);
    const children = [...subContainers, ...directAgents].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );
    const onlyDirectPiAgent =
      subContainers.length === 0 &&
      directAgents.length === 1 &&
      readStringAttr(directAgents[0]!, "event_type") === "pi_agent_container";
    const folded = onlyDirectPiAgent ? directAgents[0]!.children ?? [] : children;
    containerSpans.set(range.containerId, toContainerSpan(range, folded));
  }

  // Place unmatched spans (orphans like approval events) into the deepest
  // container whose time range contains the span's startTime.
  const remainingUnmatched: TraceSpan[] = [];
  for (const span of unmatched) {
    const t = span.startTime.getTime();
    // Walk ranges from most specific (deepest) to broadest so the span lands
    // in the tightest-fitting container.
    const depthOrder = ["task_group", "checkpoint", "outline"] as const;
    let placed = false;
    for (const level of depthOrder) {
      for (const range of ranges) {
        if (range.level !== level) continue;
        const end = range.end?.getTime() ?? Infinity;
        if (t >= range.start.getTime() && t <= end) {
          const cSpan = containerSpans.get(range.containerId);
          if (cSpan) {
            cSpan.children = cSpan.children ?? [];
            cSpan.children.push(span);
            cSpan.children.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
            placed = true;
            break;
          }
        }
      }
      if (placed) break;
    }
    if (!placed) remainingUnmatched.push(span);
  }

  const topLevel = ranges
    .filter((r) => r.parentContainerId === null)
    .map((r) => containerSpans.get(r.containerId)!)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (remainingUnmatched.length === 0) {
    return topLevel;
  }

  const orphanStart = new Date(Math.min(...remainingUnmatched.map((s) => s.startTime.getTime())));
  const orphanEnd = new Date(Math.max(...remainingUnmatched.map((s) => s.endTime.getTime())));
  const orphanContainer: TraceSpan = {
    id: `orphaned:${orphanStart.getTime()}`,
    title: "Uncategorized",
    startTime: orphanStart,
    endTime: orphanEnd,
    duration: orphanEnd.getTime() - orphanStart.getTime(),
    type: "agent_invocation",
    status: "warning",
    raw: JSON.stringify({ synthetic: true, orphaned: true }),
    attributes: [makeAttr("event_type", "orphan_container")!],
    children: remainingUnmatched,
  };

  return [...topLevel, orphanContainer].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
}
