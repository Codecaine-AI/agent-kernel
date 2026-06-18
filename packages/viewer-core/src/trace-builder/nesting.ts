/**
 * nesting.ts — Intra-run span nesting helpers.
 *
 *   - groupSpansByUserMessage: folds non-user_message spans under the
 *     preceding user_message span so one turn = one visual block.
 *   - findToolCallSpanByToolUseId: walks a PI agent's subtree to find the
 *     tool_call_start span whose tool_use_id attribute matches the given
 *     id, so spawn_agent tool_calls host their nested PI Session span by
 *     explicit reference rather than timestamp containment.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType } from "../types";

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
    const children = span.children ?? [];
    if (children.length === 0) continue;
    const maxEnd = Math.max(
      span.endTime.getTime(),
      ...children.map((c) => c.endTime.getTime()),
    );
    span.endTime = new Date(maxEnd);
    span.duration = maxEnd - span.startTime.getTime();
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
