/**
 * spanFactories.ts — PairedEvent / PiAgentSession / AgentRun → TraceSpan constructors.
 *
 * Keeps container identity conventions in one place:
 *   - toEventSpan: `id` = TraceEvent.eventId (flows back to page selectedId)
 *   - toAgentSpan: `id` = `pi:<piSessionUuid>` — attributes include event_type=pi_agent_container
 *   - toRunSpan:   `id` = `run:<agentRunUuid>` — attributes include event_type=run_container
 *   - toNodeSpan:  model-node rows; the caller picks the id (`pi:<sessionId>`,
 *                  `run:<runId>`, or `attempt:<runId>`) and the event_type
 *                  (call/decision container or attempt), see model-nodes.ts
 */

import type { TraceSpan, TraceSpanAttribute, TraceSpanStatus } from "@evilmartians/agent-prism-types";

import type {
  AgentRun,
  CallEndData,
  CallStartData,
  DecisionMadeData,
  TraceEvent,
} from "../types";
import type { PiAgentSession } from "../types";

import type { PairedEvent } from "./pairEvents";
import type { ContainerRange } from "./containerGrouping";
import {
  callEndStatus,
  categoryFor,
  nodeInputBlobHash,
  type CallEndWithInput,
  extractSpanPayload,
  pushAttr,
  statusFor,
  titleFor,
} from "./spanAttributes";

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
      id: paired.start.eventId,
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
    id: paired.event.eventId,
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
  const start = new Date(pi.createdAt);
  const end = new Date(pi.endedAt ?? pi.createdAt);
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "piSessionUuid", pi.id);
  pushAttr(attrs, "status", pi.status);
  pushAttr(attrs, "model", pi.model);
  pushAttr(attrs, "event_type", "pi_agent_container");
  pushAttr(attrs, "container_id", pi.containerId);
  pushAttr(attrs, "phase", pi.phase);
  pushAttr(attrs, "parent_tool_use_id", pi.parentToolUseId);
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

export function toRunSpan(
  run: AgentRun,
  children: TraceSpan[],
  runNumber?: number,
): TraceSpan {
  const startTime = new Date(run.startedAt);
  const endTime = run.endedAt
    ? new Date(run.endedAt)
    : (children.at(-1)?.endTime ?? new Date());
  const duration = run.endedAt ? endTime.getTime() - startTime.getTime() : 0;
  const status: TraceSpanStatus = run.status === "error" ? "error" : "success";
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "event_type", "run_container");
  pushAttr(attrs, "trace_level", 1);
  pushAttr(attrs, "run_id", run.id);
  if (runNumber !== undefined) pushAttr(attrs, "run_number", runNumber);
  pushAttr(attrs, "run_trigger", run.trigger);
  pushAttr(attrs, "run_status", run.status);
  pushAttr(attrs, "parent_tool_use_id", run.parentToolUseId);
  return {
    id: `run:${run.id}`,
    title: runNumber !== undefined ? `Run #${runNumber}` : (run.displayLabel ?? "Run"),
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

/** One model-node run's lifecycle events, as absorbed into its row. */
export interface NodeRunSource {
  run: AgentRun;
  start: TraceEvent | null;
  end: TraceEvent | null;
  decision: TraceEvent | null;
}

type NodeAttrValue = string | number | boolean | null | undefined;

export interface NodeSpanShape {
  id: string;
  /** call_container | decision_container | call_attempt | decision_attempt. */
  eventType: string;
  title: string;
  /** The placement this row hangs under (parent run, gate). */
  parentRunId: string | null;
  gateSpanId: string | null;
  children: TraceSpan[];
  /** Overrides the source's start: a multi-attempt row starts at its first attempt. */
  startTime?: Date;
  /** Appended after the node attributes (attempt counters). */
  extraAttrs?: ReadonlyArray<readonly [key: string, value: NodeAttrValue]>;
}

function nodeStatusFor(source: NodeRunSource): TraceSpanStatus {
  const end = source.end?.eventData as CallEndData | null | undefined;
  if (!end) {
    const status = source.run.status;
    if (status === "running") return "pending";
    if (status === "error") return "error";
    if (status === "aborted") return "warning";
    return "success";
  }
  const status = callEndStatus(end.status);
  const decision = source.decision?.eventData as DecisionMadeData | null | undefined;
  return status === "success" && decision?.abstained === true ? "warning" : status;
}

/**
 * A model-node row (call or decision, node row or attempt row) built from one
 * run's call_start / call_end / decision_made. Status: call_end.status
 * (ok → success, error → error, aborted → warning), an abstained decision is
 * a warning, and a run with no call_end follows its run status (running →
 * pending). A decision's output is its decision_made payload as JSON. The
 * input blob is call_end's final input when recorded, else call_start's.
 */
export function toNodeSpan(
  pi: PiAgentSession,
  source: NodeRunSource,
  shape: NodeSpanShape,
): TraceSpan {
  const start = source.start?.eventData as CallStartData | null | undefined;
  const end = source.end?.eventData as CallEndWithInput | null | undefined;
  const decision = source.decision?.eventData as DecisionMadeData | null | undefined;
  const { run } = source;

  const startTime =
    shape.startTime ?? new Date(source.start?.timestamp ?? run.startedAt);
  const endIso = source.end?.timestamp ?? run.endedAt ?? null;
  const lastChildEnd = Math.max(
    startTime.getTime(),
    ...shape.children.map((child) => child.endTime.getTime()),
  );
  const endTime = endIso ? new Date(endIso) : new Date(lastChildEnd);

  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "event_type", shape.eventType);
  pushAttr(attrs, "node_kind", start?.node_kind ?? end?.node_kind ?? pi.kind);
  pushAttr(
    attrs,
    "function_name",
    start?.function_name ?? end?.function_name ?? decision?.decision_name ?? run.agentName,
  );
  pushAttr(attrs, "engine", start?.engine ?? decision?.engine);
  pushAttr(attrs, "transport", start?.transport);
  pushAttr(attrs, "model", end?.resolved_model ?? decision?.model ?? start?.model ?? pi.model);
  pushAttr(attrs, "requested_model", start?.model ?? decision?.requested_model);
  pushAttr(attrs, "api", start?.api ?? decision?.api);
  pushAttr(attrs, "provider", start?.provider ?? decision?.provider);
  pushAttr(attrs, "status", end?.status ?? run.status);
  pushAttr(attrs, "trigger", start?.trigger ?? run.trigger);
  pushAttr(attrs, "run_id", run.id);
  pushAttr(attrs, "parent_run_id", shape.parentRunId);
  pushAttr(attrs, "prompt_hash", start?.prompt_hash);
  pushAttr(attrs, "input_blob_hash", nodeInputBlobHash(start, end));
  pushAttr(attrs, "output_blob_hash", end?.output_blob_hash);
  pushAttr(attrs, "duration_ms", end?.duration_ms);
  pushAttr(attrs, "attempts", end?.attempts);
  pushAttr(attrs, "abstained", decision?.abstained);
  pushAttr(attrs, "abstain_reason", decision?.abstain_reason);
  pushAttr(attrs, "chosen", decision?.chosen);
  pushAttr(attrs, "confidence_source", decision?.confidence_source);
  pushAttr(attrs, "gate_span_id", shape.gateSpanId);
  pushAttr(attrs, "container_id", run.containerId);
  pushAttr(attrs, "piSessionUuid", pi.id);
  pushAttr(attrs, "model_alias", start?.model_alias);
  pushAttr(attrs, "parent_tool_use_id", start?.parent_tool_use_id ?? run.parentToolUseId);
  pushAttr(attrs, "request_id", start?.request_id);
  pushAttr(attrs, "attempt", start?.attempt);
  pushAttr(attrs, "error_kind", end?.error?.kind ?? decision?.error_kind);
  pushAttr(attrs, "error_message", end?.error?.message);
  pushAttr(attrs, "http_status", end?.error?.http_status);
  pushAttr(attrs, "input_tokens", end?.usage?.inputTokens);
  pushAttr(attrs, "output_tokens", end?.usage?.outputTokens);
  pushAttr(attrs, "cache_read_tokens", end?.usage?.cacheReadTokens);
  pushAttr(attrs, "cache_write_tokens", end?.usage?.cacheWriteTokens);
  pushAttr(attrs, "cost_estimate", end?.usage?.costEstimate);
  for (const [key, value] of shape.extraAttrs ?? []) pushAttr(attrs, key, value);

  return {
    id: shape.id,
    title: shape.title,
    startTime,
    endTime,
    duration: endTime.getTime() - startTime.getTime(),
    type: "llm_call",
    status: nodeStatusFor(source),
    raw: JSON.stringify({
      run,
      start: source.start,
      end: source.end,
      decision: source.decision,
    }),
    ...(decision ? { output: JSON.stringify(decision) } : {}),
    attributes: attrs,
    children: shape.children,
  };
}
