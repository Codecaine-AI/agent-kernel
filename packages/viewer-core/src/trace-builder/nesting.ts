/**
 * nesting.ts — Intra-run span nesting helpers.
 *
 *   - groupContextInputsByBuild: folds context_input_resolved spans under
 *     the matching context_build_started/completed pair by protocol spanId.
 *   - groupProvisioningSpans: wraps system prompt and context build spans
 *     into a synthetic provisioning container per spawn lifecycle spanId.
 *   - groupSpansByTurn: folds each turn's tool calls / asks / assistant
 *     replies under the pi_request_snapshot ("Turn N") span that issued
 *     them, derived causally from the canonical emission order.
 *   - foldTurnEndUsageOntoTurns: copies pi_turn_end model usage onto its
 *     matching Turn span without consuming the debug event.
 *   - groupSpansByUserMessage: folds non-user_message spans under the
 *     preceding user_message span so one turn = one visual block.
 *   - findToolCallSpanByToolUseId: walks a PI agent's subtree to find the
 *     tool_call_start span whose tool_use_id attribute matches the given
 *     id, so spawn_agent tool_calls host their nested PI Session span by
 *     explicit reference rather than timestamp containment.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType, UI_ASK_ANSWERED, UI_ASK_REQUESTED } from "../types";

import { readStringAttr } from "./spanAttributes";

const PROVISIONING_EVENT_TYPES = new Set<string>([
  EventType.SYSTEM_PROMPT_RESOLVED,
  EventType.CONTEXT_BUILD_STARTED,
  EventType.CONTEXT_BUILD_COMPLETED,
]);

const PROVISIONING_ORDER = new Map<string, number>([
  [EventType.SYSTEM_PROMPT_RESOLVED, 0],
  [EventType.CONTEXT_BUILD_STARTED, 1],
  [EventType.CONTEXT_BUILD_COMPLETED, 1],
]);

function extendSpanToChildren(span: TraceSpan): void {
  const children = span.children ?? [];
  if (children.length === 0) return;
  const maxEnd = Math.max(
    span.endTime.getTime(),
    ...children.map((c) => c.endTime.getTime()),
  );
  span.endTime = new Date(maxEnd);
  span.duration = maxEnd - span.startTime.getTime();
}

export function groupContextInputsByBuild(
  spans: TraceSpan[],
  typeById: Map<string, string>,
  protocolSpanIdById: Map<string, string>,
): TraceSpan[] {
  const contextBuildByProtocolSpanId = new Map<string, TraceSpan>();
  const replacementBySpanId = new Map<string, TraceSpan>();

  for (const span of spans) {
    if (typeById.get(span.id) !== EventType.CONTEXT_BUILD_STARTED) continue;
    const protocolSpanId = protocolSpanIdById.get(span.id);
    if (!protocolSpanId) continue;
    const replacement: TraceSpan = {
      ...span,
      children: [...(span.children ?? [])],
    };
    contextBuildByProtocolSpanId.set(protocolSpanId, replacement);
    replacementBySpanId.set(span.id, replacement);
  }

  if (contextBuildByProtocolSpanId.size === 0) return spans;

  const result: TraceSpan[] = [];
  for (const span of spans) {
    const replacement = replacementBySpanId.get(span.id);
    if (replacement) {
      result.push(replacement);
      continue;
    }

    const protocolSpanId = protocolSpanIdById.get(span.id);
    const contextBuild = protocolSpanId
      ? contextBuildByProtocolSpanId.get(protocolSpanId)
      : undefined;
    if (contextBuild && typeById.get(span.id) === EventType.CONTEXT_INPUT_RESOLVED) {
      contextBuild.children = contextBuild.children ?? [];
      contextBuild.children.push(span);
      continue;
    }

    result.push(span);
  }

  for (const contextBuild of contextBuildByProtocolSpanId.values()) {
    extendSpanToChildren(contextBuild);
  }

  return result;
}

function childStatus(children: TraceSpan[]): TraceSpan["status"] {
  if (children.some((child) => child.status === "error")) return "error";
  if (children.some((child) => child.status === "warning")) return "warning";
  if (children.some((child) => child.status === "pending")) return "pending";
  return "success";
}

function sortProvisioningChildren(
  children: TraceSpan[],
  typeById: Map<string, string>,
): TraceSpan[] {
  return [...children].sort((a, b) => {
    const aOrder = PROVISIONING_ORDER.get(typeById.get(a.id) ?? "") ?? 99;
    const bOrder = PROVISIONING_ORDER.get(typeById.get(b.id) ?? "") ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.startTime.getTime() - b.startTime.getTime();
  });
}

function makeProvisioningSpan(
  protocolSpanId: string,
  children: TraceSpan[],
  typeById: Map<string, string>,
): TraceSpan {
  const sortedChildren = sortProvisioningChildren(children, typeById);
  const startTime = new Date(
    Math.min(...sortedChildren.map((child) => child.startTime.getTime())),
  );
  const endTime = new Date(
    Math.max(...sortedChildren.map((child) => child.endTime.getTime())),
  );
  return {
    id: `provisioning:${protocolSpanId}`,
    title: "Provisioning",
    startTime,
    endTime,
    duration: endTime.getTime() - startTime.getTime(),
    type: "agent_invocation",
    status: childStatus(sortedChildren),
    raw: JSON.stringify({ kind: "provisioning_container", spanId: protocolSpanId }),
    attributes: [
      { key: "event_type", value: { stringValue: "provisioning_container" } },
      { key: "trace_level", value: { intValue: "1" } },
      { key: "span_id", value: { stringValue: protocolSpanId } },
    ],
    children: sortedChildren,
  };
}

export function groupProvisioningSpans(
  spans: TraceSpan[],
  typeById: Map<string, string>,
  protocolSpanIdById: Map<string, string>,
): TraceSpan[] {
  const childrenByProtocolSpanId = new Map<string, TraceSpan[]>();

  for (const span of spans) {
    const eventType = typeById.get(span.id);
    if (!eventType || !PROVISIONING_EVENT_TYPES.has(eventType)) continue;
    const protocolSpanId = protocolSpanIdById.get(span.id);
    if (!protocolSpanId) continue;
    const children = childrenByProtocolSpanId.get(protocolSpanId) ?? [];
    children.push(span);
    childrenByProtocolSpanId.set(protocolSpanId, children);
  }

  if (childrenByProtocolSpanId.size === 0) return spans;

  const provisioningByProtocolSpanId = new Map<string, TraceSpan>();
  const groupedChildIds = new Set<string>();

  for (const [protocolSpanId, children] of childrenByProtocolSpanId.entries()) {
    provisioningByProtocolSpanId.set(
      protocolSpanId,
      makeProvisioningSpan(protocolSpanId, children, typeById),
    );
    for (const child of children) groupedChildIds.add(child.id);
  }

  const inserted = new Set<string>();
  const result: TraceSpan[] = [];
  for (const span of spans) {
    if (!groupedChildIds.has(span.id)) {
      result.push(span);
      continue;
    }

    const protocolSpanId = protocolSpanIdById.get(span.id);
    if (!protocolSpanId || inserted.has(protocolSpanId)) continue;
    const provisioning = provisioningByProtocolSpanId.get(protocolSpanId);
    if (provisioning) {
      result.push(provisioning);
      inserted.add(protocolSpanId);
    }
  }

  return result;
}

/**
 * Event types a Turn span owns: the model's own actions in response to that
 * request — tool calls (+ hooks), UI asks, and assistant reply blocks. Debug
 * lifecycle events (pi_turn_start/end, pi_agent_*) deliberately stay siblings.
 */
const TURN_OWNED_EVENT_TYPES = new Set<string>([
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_END,
  EventType.PRE_TOOL_HOOK,
  EventType.POST_TOOL_HOOK,
  UI_ASK_REQUESTED,
  UI_ASK_ANSWERED,
  EventType.ASSISTANT_MESSAGE,
]);

/**
 * Host-defined "app:" events (e.g. app:board-render) are turn-owned as a
 * namespace: they document what the turn produced, so they nest under the
 * open Turn span alongside the tool calls that caused them. The cross-run
 * guard in groupSpansByTurn applies to them exactly like the closed set.
 */
function isTurnOwnedEventType(eventType: string): boolean {
  return TURN_OWNED_EVENT_TYPES.has(eventType) || eventType.startsWith("app:");
}

/** Event types that close the current turn's ownership window. */
const TURN_BOUNDARY_EVENT_TYPES = new Set<string>([
  EventType.USER_MESSAGE,
  EventType.AGENT_RUN_START,
  EventType.AGENT_RUN_END,
  EventType.AGENT_SESSION_START,
  EventType.AGENT_SESSION_END,
]);

const TURN_USAGE_ATTRIBUTE_KEYS = new Set<string>([
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "model",
  "cost_estimate",
]);

function readIntAttr(span: TraceSpan, key: string): string | null {
  const found = span.attributes?.find((attribute) => attribute.key === key);
  return found?.value?.intValue ?? null;
}

/**
 * Copies the usage carried by each pi_turn_end point onto the matching
 * pi_request_snapshot span. Callers pass one PI-session bucket, which supplies
 * the piSessionId part of the match; turn_number must match, and runId must
 * also match when both events carry one. The latest preceding compatible Turn
 * wins when legacy events omit runId.
 *
 * The input spans and their attribute arrays are never mutated. pi_turn_end
 * remains in the returned list with its own attributes intact.
 */
export function foldTurnEndUsageOntoTurns(
  spans: TraceSpan[],
  typeById: Map<string, string>,
  runIdBySpanId: Map<string, string>,
): TraceSpan[] {
  const result = [...spans];
  const turnIndexesByNumber = new Map<string, number[]>();

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const eventType = typeById.get(span.id);
    const turnNumber = readIntAttr(span, "turn_number");

    if (eventType === EventType.PI_REQUEST_SNAPSHOT && turnNumber !== null) {
      const indexes = turnIndexesByNumber.get(turnNumber) ?? [];
      indexes.push(index);
      turnIndexesByNumber.set(turnNumber, indexes);
      continue;
    }

    if (eventType !== EventType.PI_TURN_END || turnNumber === null) continue;

    const turnEndRunId = runIdBySpanId.get(span.id);
    const candidateIndexes = turnIndexesByNumber.get(turnNumber) ?? [];
    let turnIndex: number | undefined;
    for (
      let candidate = candidateIndexes.length - 1;
      candidate >= 0;
      candidate -= 1
    ) {
      const candidateIndex = candidateIndexes[candidate];
      const turnRunId = runIdBySpanId.get(spans[candidateIndex].id);
      if (!turnEndRunId || !turnRunId || turnEndRunId === turnRunId) {
        turnIndex = candidateIndex;
        break;
      }
    }
    if (turnIndex === undefined) continue;

    const turn = result[turnIndex];
    const existingKeys = new Set(
      turn.attributes?.map((attribute) => attribute.key) ?? [],
    );
    const usageAttributes = (span.attributes ?? []).filter(
      (attribute) =>
        TURN_USAGE_ATTRIBUTE_KEYS.has(attribute.key) && !existingKeys.has(attribute.key),
    );
    if (usageAttributes.length === 0) continue;

    result[turnIndex] = {
      ...turn,
      attributes: [...(turn.attributes ?? []), ...usageAttributes],
    };
  }

  return result;
}

/**
 * Folds each turn's tool calls, UI asks, and assistant replies under the
 * pi_request_snapshot ("Turn N") span that issued them.
 *
 * Ownership is causal, not attribute-based (tool events carry no turn
 * number): after the canonical emission sort, a span belongs to the most
 * recent preceding Turn span. Guard rails:
 *   - traces with no snapshot spans return unchanged (flat fallback for
 *     agents without the state extension / old traces);
 *   - spans before the first Turn stay siblings (no owner to claim them);
 *   - user_message / run / session boundary spans close the open turn, and
 *     a span stamped with a different runId than its candidate turn is never
 *     folded (cross-run guard for interleaved emission);
 *   - other spans (pi_turn_start/end, errors, warnings, unknown types) pass
 *     through as siblings without closing the turn.
 *
 * Turn containers extend their end time over adopted children so the
 * waterfall covers the work the request produced.
 */
export function groupSpansByTurn(
  spans: TraceSpan[],
  typeById: Map<string, string>,
  runIdBySpanId: Map<string, string>,
): TraceSpan[] {
  const hasTurnSpans = spans.some(
    (span) => typeById.get(span.id) === EventType.PI_REQUEST_SNAPSHOT,
  );
  if (!hasTurnSpans) return spans;

  const usageFolded = foldTurnEndUsageOntoTurns(spans, typeById, runIdBySpanId);

  const result: TraceSpan[] = [];
  let currentTurn: TraceSpan | null = null;
  let currentTurnRunId: string | undefined;

  for (const span of usageFolded) {
    const eventType = typeById.get(span.id);

    if (eventType === EventType.PI_REQUEST_SNAPSHOT) {
      currentTurn = { ...span, children: [...(span.children ?? [])] };
      currentTurnRunId = runIdBySpanId.get(span.id);
      result.push(currentTurn);
      continue;
    }

    if (eventType && TURN_BOUNDARY_EVENT_TYPES.has(eventType)) {
      currentTurn = null;
      currentTurnRunId = undefined;
      result.push(span);
      continue;
    }

    if (currentTurn && eventType && isTurnOwnedEventType(eventType)) {
      const spanRunId = runIdBySpanId.get(span.id);
      if (spanRunId && currentTurnRunId && spanRunId !== currentTurnRunId) {
        // A different run's span means the open turn is stale.
        currentTurn = null;
        currentTurnRunId = undefined;
        result.push(span);
        continue;
      }
      currentTurn.children = currentTurn.children ?? [];
      currentTurn.children.push(span);
      continue;
    }

    result.push(span);
  }

  for (const span of result) {
    if (typeById.get(span.id) !== EventType.PI_REQUEST_SNAPSHOT) continue;
    extendSpanToChildren(span);
  }

  return result;
}

export function groupSpansByUserMessage(
  spans: TraceSpan[],
  typeById: Map<string, string>,
): TraceSpan[] {
  const result: TraceSpan[] = [];
  let currentContainer: TraceSpan | null = null;

  for (const span of spans) {
    if (typeById.get(span.id) === EventType.USER_MESSAGE) {
      currentContainer = { ...span, children: [] };
      result.push(currentContainer);
    } else if (currentContainer !== null) {
      currentContainer.children = currentContainer.children ?? [];
      currentContainer.children.push(span);
    } else {
      result.push(span);
    }
  }

  for (const span of result) {
    if (typeById.get(span.id) !== EventType.USER_MESSAGE) continue;
    extendSpanToChildren(span);
  }

  return result;
}

export function findToolCallSpanByToolUseId(
  parent: TraceSpan,
  toolUseId: string,
  typeById: Map<string, string>,
): TraceSpan | null {
  const children = parent.children;
  if (!children || children.length === 0) return null;

  for (const child of children) {
    if (typeById.get(child.id) === EventType.TOOL_CALL_START) {
      if (readStringAttr(child, "tool_use_id") === toolUseId) return child;
    }
    const inner = findToolCallSpanByToolUseId(child, toolUseId, typeById);
    if (inner) return inner;
  }

  return null;
}
