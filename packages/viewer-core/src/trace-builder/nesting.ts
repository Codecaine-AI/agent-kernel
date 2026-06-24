/**
 * nesting.ts — Intra-run span nesting helpers.
 *
 *   - groupContextInputsByBuild: folds context_input_resolved spans under
 *     the matching context_build_started/completed pair by protocol spanId.
 *   - groupProvisioningSpans: wraps system prompt and context build spans
 *     into a synthetic provisioning container per spawn lifecycle spanId.
 *   - groupSpansByUserMessage: folds non-user_message spans under the
 *     preceding user_message span so one turn = one visual block.
 *   - findToolCallSpanByToolUseId: walks a PI agent's subtree to find the
 *     tool_call_start span whose tool_use_id attribute matches the given
 *     id, so spawn_agent tool_calls host their nested PI Session span by
 *     explicit reference rather than timestamp containment.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType } from "../types";

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
      const childToolUseId = child.attributes?.find((a) => a.key === "tool_use_id")?.value
        ?.stringValue;
      if (childToolUseId === toolUseId) return child;
    }
    const inner = findToolCallSpanByToolUseId(child, toolUseId, typeById);
    if (inner) return inner;
  }

  return null;
}
