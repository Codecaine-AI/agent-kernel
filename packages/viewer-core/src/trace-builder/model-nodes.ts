/**
 * model-nodes.ts — Span passes for model nodes (kernel.call / decide / step /
 * gate) and nested tool calls.
 *
 *   - toNodeSpans: one call/decision session → node rows. The session's runs
 *     are grouped by placement (parent run, gate span from that run's
 *     call_start); each group renders as one node row. A group with several
 *     runs (retry attempts) gets one attempt row per run under a summary row.
 *   - foldGateChildren: spans whose payload names a gate_span_id move under
 *     that gate span.
 *   - attachRunScopedSpans: node rows hang under their placement's parent
 *     run, step/gate spans under their run_id: the `run:<id>` wrapper when the
 *     parent session has one, else the parent session's `pi:<id>` span.
 *   - nestToolSpans: nested tool calls move under their immediate parent tool
 *     span (tool_use_id = parent_tool_use_id), shallowest first, so chains of
 *     any depth resolve.
 *
 * Every pass returns its input unchanged when there is nothing to move, so
 * traces without model nodes or nested tools build exactly as before.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
  CALL_ATTEMPT,
  CALL_CONTAINER,
  DECISION_ATTEMPT,
  DECISION_CONTAINER,
  EventType,
  type AgentRun,
  type CallStartData,
  type PiAgentSession,
  type TraceEvent,
} from "../types";

import { findToolCallSpanByToolUseId } from "./nesting";
import type { PairedEvent } from "./pairEvents";
import { bucketSpansByRun, sortRunsByStart } from "./runBucketing";
import { readStringAttr } from "./spanAttributes";
import { toAgentSpan, toNodeSpan, type NodeRunSource } from "./spanFactories";

/** Event types a node row absorbs from its run's spans. */
export const NODE_LIFECYCLE_EVENT_TYPES = new Set<string>([
  EventType.CALL_START,
  EventType.CALL_END,
  EventType.DECISION_MADE,
]);

/** Session kinds rendered as node rows; every other kind renders as an agent. */
export function isNodeSession(pi: PiAgentSession): boolean {
  return pi.kind === "call" || pi.kind === "decision";
}

/** Side tables toNodeSpans reads, keyed by event span id. */
export interface NodeSpanIndex {
  typeById: Map<string, string>;
  runIdBySpanId: Map<string, string>;
  /** Source events of the node lifecycle spans (NODE_LIFECYCLE_EVENT_TYPES). */
  pairedBySpanId: Map<string, PairedEvent>;
}

interface NodeRunParts extends NodeRunSource {
  /** The run's other spans (turns, turn lifecycle points), in startTime order. */
  children: TraceSpan[];
  parentRunId: string | null;
  gateSpanId: string | null;
}

function dataOf<T>(event: TraceEvent | null): T | null {
  return (event?.eventData as T | null | undefined) ?? null;
}

/** Split one run's spans into its absorbed lifecycle events and its children. */
function toRunParts(run: AgentRun, spans: TraceSpan[], index: NodeSpanIndex): NodeRunParts {
  let start: TraceEvent | null = null;
  let end: TraceEvent | null = null;
  let decision: TraceEvent | null = null;
  const children: TraceSpan[] = [];

  for (const span of spans) {
    const paired = index.pairedBySpanId.get(span.id);
    const type = index.typeById.get(span.id);
    if (paired?.kind === "pair" && type === EventType.CALL_START && !start && !end) {
      start = paired.start;
      end = paired.end;
      continue;
    }
    if (paired?.kind === "point") {
      if (type === EventType.CALL_START && !start) {
        start = paired.event;
        continue;
      }
      if (type === EventType.CALL_END && !end) {
        end = paired.event;
        continue;
      }
      if (type === EventType.DECISION_MADE && !decision) {
        decision = paired.event;
        continue;
      }
    }
    children.push(span);
  }

  const startData = dataOf<CallStartData>(start);
  const gateSpanId =
    startData?.gate_span_id ??
    dataOf<{ gate_span_id?: string }>(end)?.gate_span_id ??
    dataOf<{ gate_span_id?: string }>(decision)?.gate_span_id ??
    null;
  return {
    run,
    start,
    end,
    decision,
    children,
    parentRunId: run.parentRunId ?? startData?.parent_run_id ?? null,
    gateSpanId,
  };
}

/** Row title: the run's display label, else the session's, else the function name. */
function nodeTitle(pi: PiAgentSession, parts: NodeRunParts): string {
  const start = dataOf<CallStartData>(parts.start);
  const decision = dataOf<{ decision_name?: string }>(parts.decision);
  return (
    start?.display_label ??
    pi.displayLabel ??
    start?.function_name ??
    decision?.decision_name ??
    pi.agentName
  );
}

/**
 * The attempt a multi-attempt row summarizes: the latest run with status
 * "done"; when none is done, the latest run by startedAt. `attempts` is in
 * startedAt order.
 */
export function selectAttemptIndex(attempts: ReadonlyArray<{ run: AgentRun }>): number {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    if (attempts[i].run.status === "done") return i;
  }
  return attempts.length - 1;
}

/**
 * One call/decision session → node rows, one per placement group (§4.9).
 *
 * Row ids: `pi:<sessionId>` when the session has one placement; with several
 * placements each row is `run:<firstRunId>` of its group, so ids stay unique.
 * Attempt rows are `attempt:<runId>`, titled `attempt <n>` in startedAt order.
 * A session without runs renders as a plain agent span.
 */
export function toNodeSpans(
  pi: PiAgentSession,
  runs: AgentRun[],
  bucketSpans: TraceSpan[],
  index: NodeSpanIndex,
): TraceSpan[] {
  if (runs.length === 0) return [toAgentSpan(pi, bucketSpans)];

  const sorted = sortRunsByStart(runs);
  const { runBuckets, orphans } = bucketSpansByRun(bucketSpans, sorted, index.runIdBySpanId);

  const groups = new Map<string, NodeRunParts[]>();
  for (const run of sorted) {
    const parts = toRunParts(run, runBuckets.get(run.id) ?? [], index);
    const key = `${parts.parentRunId ?? ""}\u0000${parts.gateSpanId ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(parts);
    else groups.set(key, [parts]);
  }

  const isDecision = pi.kind === "decision";
  const containerType = isDecision ? DECISION_CONTAINER : CALL_CONTAINER;
  const attemptType = isDecision ? DECISION_ATTEMPT : CALL_ATTEMPT;
  const singlePlacement = groups.size === 1;

  const rows: TraceSpan[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const id = singlePlacement ? `pi:${pi.id}` : `run:${first.run.id}`;

    if (group.length === 1) {
      rows.push(
        toNodeSpan(pi, first, {
          id,
          eventType: containerType,
          title: nodeTitle(pi, first),
          parentRunId: first.parentRunId,
          gateSpanId: first.gateSpanId,
          children: first.children,
        }),
      );
      continue;
    }

    const attemptRows = group.map((parts, i) =>
      toNodeSpan(pi, parts, {
        id: `attempt:${parts.run.id}`,
        eventType: attemptType,
        title: `attempt ${i + 1}`,
        parentRunId: parts.parentRunId,
        gateSpanId: parts.gateSpanId,
        children: parts.children,
        extraAttrs: [
          ["attempt_number", i + 1],
          ["attempt_count", group.length],
        ],
      }),
    );
    const selected = selectAttemptIndex(group);
    const summary = group[selected];
    rows.push(
      toNodeSpan(pi, summary, {
        id,
        eventType: containerType,
        title: nodeTitle(pi, summary),
        parentRunId: first.parentRunId,
        gateSpanId: first.gateSpanId,
        children: attemptRows,
        startTime: attemptRows[0].startTime,
        extraAttrs: [
          ["attempt_count", group.length],
          ["selected_attempt", selected + 1],
        ],
      }),
    );
  }

  // Spans of this session that match none of its runs stay visible on the
  // first row rather than being dropped.
  for (const orphan of orphans) insertByStartTime(rows[0], orphan);
  return rows;
}

// ─── Placement passes ───────────────────────────────────────────────────────

/** Adds `child` to `host.children` after every child that starts no later. */
function insertByStartTime(host: TraceSpan, child: TraceSpan): void {
  const children = host.children ?? [];
  const at = children.findIndex(
    (existing) => existing.startTime.getTime() > child.startTime.getTime(),
  );
  if (at < 0) children.push(child);
  else children.splice(at, 0, child);
  host.children = children;
}

function contains(root: TraceSpan, target: TraceSpan): boolean {
  if (root === target) return true;
  return (root.children ?? []).some((child) => contains(child, target));
}

/**
 * Moves top-level spans whose payload carries `gate_span_id` (a gate's step
 * checks and decide-check node rows) under the gate span with that span id.
 * A check whose gate is missing stays where it is.
 */
export function foldGateChildren(spans: TraceSpan[]): TraceSpan[] {
  const gatesBySpanId = new Map<string, TraceSpan>();
  for (const span of spans) {
    if (readStringAttr(span, "event_type") !== EventType.GATE_START) continue;
    const spanId = readStringAttr(span, "span_id");
    if (spanId) gatesBySpanId.set(spanId, span);
  }
  if (gatesBySpanId.size === 0) return spans;

  const result: TraceSpan[] = [];
  let moved = false;
  for (const span of spans) {
    const gateSpanId = readStringAttr(span, "gate_span_id");
    const gate = gateSpanId ? gatesBySpanId.get(gateSpanId) : undefined;
    if (!gate || contains(span, gate)) {
      result.push(span);
      continue;
    }
    insertByStartTime(gate, span);
    moved = true;
  }
  return moved ? result : spans;
}

const NODE_ROW_EVENT_TYPES = new Set<string>([CALL_CONTAINER, DECISION_CONTAINER]);

const STEP_GATE_EVENT_TYPES = new Set<string>([
  EventType.STEP_START,
  EventType.STEP_END,
  EventType.GATE_START,
  EventType.GATE_END,
]);

/** The run a top-level span belongs under, or null when it is not run-scoped. */
function scopedRunIdOf(span: TraceSpan): string | null {
  const eventType = readStringAttr(span, "event_type");
  if (!eventType) return null;
  if (NODE_ROW_EVENT_TYPES.has(eventType)) return readStringAttr(span, "parent_run_id");
  if (STEP_GATE_EVENT_TYPES.has(eventType)) return readStringAttr(span, "run_id");
  return null;
}

const ATTEMPT_ROW_EVENT_TYPES = new Set<string>([CALL_ATTEMPT, DECISION_ATTEMPT]);

interface RunHosts {
  /** run id → the row that stands for exactly that run. */
  byRunId: Map<string, TraceSpan>;
  /** `pi:<sessionId>` agent spans. */
  agentsById: Map<string, TraceSpan>;
}

/**
 * The row that stands for one run: its attempt row, else its single-run node
 * row, else its `run:<id>` wrapper. A multi-attempt node row stands for no
 * single run (its run_id is only the selected attempt's), so a span owned by
 * any attempt lands on that attempt's own row.
 */
function indexHosts(spans: TraceSpan[], hosts: RunHosts): void {
  for (const span of spans) {
    const eventType = readStringAttr(span, "event_type");
    const runId = readStringAttr(span, "run_id");
    const isSingleRunNodeRow =
      eventType !== null &&
      NODE_ROW_EVENT_TYPES.has(eventType) &&
      !span.attributes?.some((a) => a.key === "attempt_count");
    const standsForRun =
      eventType === "run_container" ||
      (eventType !== null && ATTEMPT_ROW_EVENT_TYPES.has(eventType)) ||
      isSingleRunNodeRow;
    if (runId && standsForRun && !hosts.byRunId.has(runId)) hosts.byRunId.set(runId, span);
    if (eventType === "pi_agent_container" && !hosts.agentsById.has(span.id)) {
      hosts.agentsById.set(span.id, span);
    }
    if (span.children) indexHosts(span.children, hosts);
  }
}

/**
 * Hangs top-level node rows (by their own placement's parent_run_id) and
 * step/gate spans (by run_id) under the row of that run: a node run's own
 * attempt or node row, a `run:<id>` wrapper when the parent session has
 * several runs, else the parent session's `pi:<id>` span. Children are placed
 * in startTime order; an unknown run leaves the span at the root.
 */
export function attachRunScopedSpans(spans: TraceSpan[], runs: AgentRun[]): TraceSpan[] {
  if (!spans.some((span) => scopedRunIdOf(span) !== null)) return spans;

  const runsById = new Map(runs.map((run) => [run.id, run]));
  const hosts: RunHosts = { byRunId: new Map(), agentsById: new Map() };
  indexHosts(spans, hosts);

  const hostFor = (runId: string): TraceSpan | undefined => {
    const own = hosts.byRunId.get(runId);
    if (own) return own;
    const run = runsById.get(runId);
    return run ? hosts.agentsById.get(`pi:${run.piSessionId}`) : undefined;
  };

  const result: TraceSpan[] = [];
  let moved = false;
  for (const span of spans) {
    const runId = scopedRunIdOf(span);
    const host = runId ? hostFor(runId) : undefined;
    if (!host || contains(span, host)) {
      result.push(span);
      continue;
    }
    insertByStartTime(host, span);
    moved = true;
  }
  return moved ? result : spans;
}

// ─── Nested tool calls ──────────────────────────────────────────────────────

const TOOL_EVENT_TYPES = new Set<string>([EventType.TOOL_CALL_START, EventType.TOOL_CALL_END]);

interface NestedToolEntry {
  span: TraceSpan;
  parentToolUseId: string;
  /** The list that holds the span before it moves. */
  container: TraceSpan[];
  depth: number;
}

function collectNestedTools(
  spans: TraceSpan[],
  typeById: Map<string, string>,
  into: NestedToolEntry[],
): void {
  for (const span of spans) {
    const type = typeById.get(span.id);
    const parentToolUseId = readStringAttr(span, "parent_tool_use_id");
    if (type && TOOL_EVENT_TYPES.has(type) && parentToolUseId) {
      const ownId = readStringAttr(span, "tool_use_id") ?? parentToolUseId;
      into.push({
        span,
        parentToolUseId,
        container: spans,
        depth: ownId.split("/").length,
      });
    }
    if (span.children) collectNestedTools(span.children, typeById, into);
  }
}

/**
 * Moves every nested tool span (one with parent_tool_use_id) under the tool
 * span whose tool_use_id is that parent (§4.4: the immediate parent, its id
 * minus the final `/<n>`). Runs after turn grouping, which places nested
 * calls under the turn like any tool. Spans attach shallowest first, so a
 * parent that is itself nested is already in place when its children look
 * for it. A span whose parent is not found stays where it was.
 */
export function nestToolSpans(spans: TraceSpan[], typeById: Map<string, string>): TraceSpan[] {
  const top = [...spans];
  const entries: NestedToolEntry[] = [];
  collectNestedTools(top, typeById, entries);
  if (entries.length === 0) return spans;

  const findHost = (toolUseId: string): TraceSpan | null => {
    for (const span of top) {
      if (
        typeById.get(span.id) === EventType.TOOL_CALL_START &&
        readStringAttr(span, "tool_use_id") === toolUseId
      ) {
        return span;
      }
      const inner = findToolCallSpanByToolUseId(span, toolUseId, typeById);
      if (inner) return inner;
    }
    return null;
  };

  // Stable sort: equal depths keep their emission order.
  entries.sort((a, b) => a.depth - b.depth);
  for (const entry of entries) {
    const at = entry.container.indexOf(entry.span);
    if (at < 0) continue;
    // Detach first so a span can never be found inside its own subtree.
    entry.container.splice(at, 1);
    const host = findHost(entry.parentToolUseId);
    if (host) {
      insertByStartTime(host, entry.span);
    } else {
      entry.container.splice(at, 0, entry.span);
    }
  }
  return top;
}
