/**
 * spanFactories.ts — PairedEvent / PiAgentSession / AgentRun → TraceSpan constructors.
 *
 * Keeps container identity conventions in one place:
 *   - toEventSpan: `id` = TraceEvent.id (flows back to page selectedId)
 *   - toAgentSpan: `id` = `pi:<piSessionUuid>` — attributes include event_type=pi_agent_container
 *   - toRunSpan:   `id` = `run:<agentRunUuid>` — attributes include event_type=run_container
 */

import type { TraceSpan, TraceSpanAttribute, TraceSpanStatus } from "@evilmartians/agent-prism-types";

import type { AgentRun } from "../types";
import type { PiAgentSession } from "../types";

import type { PairedEvent } from "./pairEvents";
import type { ContainerRange } from "./containerGrouping";
import { categoryFor, extractSpanPayload, pushAttr, statusFor, titleFor } from "./spanAttributes";

function containerStatusFor(status: string | null | undefined): TraceSpanStatus {
  if (status === "error" || status === "failed" || status === "blocked") return "error";
  if (status === "running" || status === "queued") return "pending";
  return "success";
}

export function toEventSpan(paired: PairedEvent): TraceSpan {
  const payload = extractSpanPayload(paired);
  if (paired.kind === "pair") {
    const start = new Date(paired.start.timestamp);
    const end = new Date(paired.end.timestamp);
    return {
      id: paired.start.id,
      title: titleFor(paired),
      startTime: start,
      endTime: end,
      duration: end.getTime() - start.getTime(),
      type: categoryFor(paired.start.type),
      status: statusFor(paired),
      raw: JSON.stringify({ start: paired.start, end: paired.end }),
      ...payload,
    };
  }
  const ts = new Date(paired.event.timestamp);
  return {
    id: paired.event.id,
    title: titleFor(paired),
    startTime: ts,
    endTime: ts,
    duration: 0,
    type: categoryFor(paired.event.type),
    status: statusFor(paired),
    raw: JSON.stringify(paired.event),
    ...payload,
  };
}

export function toAgentSpan(pi: PiAgentSession, children: TraceSpan[]): TraceSpan {
  const start = new Date(pi.startedAt ?? pi.createdAt);
  const end = new Date(pi.completedAt ?? pi.updatedAt);
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "piSessionUuid", pi.id);
  pushAttr(attrs, "status", pi.status);
  pushAttr(attrs, "model", pi.model);
  pushAttr(attrs, "event_type", "pi_agent_container");
  pushAttr(attrs, "container_id", pi.containerId);
  pushAttr(attrs, "phase", pi.phase);
  return {
    id: `pi:${pi.id}`,
    title: pi.displayLabel ?? pi.agentName,
    startTime: start,
    endTime: end,
    duration: 0,
    type: "agent_invocation",
    status: "success",
    raw: JSON.stringify(pi),
    attributes: attrs.length > 0 ? attrs : undefined,
    children,
  };
}

export function toContainerSpan(range: ContainerRange, children: TraceSpan[]): TraceSpan {
  const endTime =
    range.end ??
    (children.length > 0
      ? new Date(Math.max(...children.map((c) => c.endTime.getTime())))
      : range.start);
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "event_type", "container_container");
  pushAttr(attrs, "container_level", range.level);
  pushAttr(attrs, "producer_stage", range.producerStage);
  pushAttr(attrs, "container_id", range.containerId);
  if (range.checkpointId !== null) pushAttr(attrs, "checkpoint_id", range.checkpointId);
  if (range.taskGroupId !== null) pushAttr(attrs, "task_group_id", range.taskGroupId);
  return {
    id: `container:${range.containerId}`,
    title: range.label,
    startTime: range.start,
    endTime,
    duration: endTime.getTime() - range.start.getTime(),
    type: "agent_invocation",
    status: containerStatusFor(range.status),
    raw: JSON.stringify(range),
    attributes: attrs,
    children,
  };
}

export function toRunSpan(run: AgentRun, children: TraceSpan[]): TraceSpan {
  const startedAt = run.startedAt ?? run.createdAt;
  const startTime = new Date(startedAt);
  const endTime = run.completedAt
    ? new Date(run.completedAt)
    : (children.at(-1)?.endTime ?? new Date());
  const duration = run.completedAt ? endTime.getTime() - startTime.getTime() : 0;
  const status: TraceSpanStatus = run.status === "error" ? "error" : "success";
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "event_type", "run_container");
  pushAttr(attrs, "trace_level", 1);
  pushAttr(attrs, "run_number", run.runNumber);
  pushAttr(attrs, "run_status", run.status);
  pushAttr(attrs, "parent_tool_use_id", run.parentToolUseId);
  return {
    id: `run:${run.id}`,
    title: `Run #${run.runNumber}`,
    startTime,
    endTime,
    duration,
    type: "agent_invocation",
    status,
    raw: JSON.stringify(run),
    attributes: attrs,
    children,
  };
}
