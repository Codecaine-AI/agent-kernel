/**
 * TurnUsage extraction from Pi's persisted message usage shape.
 *
 * Pi assistant messages (live session events and JSONL transcript entries
 * alike) carry `usage: { input, output, cacheRead, cacheWrite, cost? }` and
 * `model`. Both the kernel's in-process emitter and the tailer's backfill
 * mapper extract TurnUsage here so the parsing exists in exactly one style.
 */

import type { TurnUsage } from "./types";

/** The usage shape Pi stores on assistant messages. */
export interface PiMessageUsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/**
 * Map a Pi message's usage to protocol TurnUsage. Returns null when the
 * message carries no usage at all (user messages, tool results).
 */
export function turnUsageFromPiMessage(
  message: { usage?: PiMessageUsageLike; model?: string },
  fallbackModel: string,
): TurnUsage | null {
  const usage = message.usage;
  if (!usage) return null;
  return {
    inputTokens: usage.input ?? 0,
    outputTokens: usage.output ?? 0,
    cacheReadTokens: usage.cacheRead ?? 0,
    cacheWriteTokens: usage.cacheWrite ?? 0,
    model: message.model ?? fallbackModel,
    ...(usage.cost?.total !== undefined ? { costEstimate: usage.cost.total } : {}),
  };
}
