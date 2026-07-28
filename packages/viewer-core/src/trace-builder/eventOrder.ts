/**
 * eventOrder.ts — canonical emission ordering for raw TraceEvents.
 *
 * The read API orders events by (timestamp, eventId). Timestamps have only
 * millisecond precision and event ids are content-derived hashes/uuids, so
 * same-millisecond events (instant mock-provider runs, fast tool calls) tie
 * on timestamp and then order ARBITRARILY by id — which is how an assistant
 * reply could render before the Turn-N request snapshot that produced it.
 *
 * buildTraceSpans re-sorts its input with this comparator once, up front:
 *   1. timestamp        — primary, as before (ISO-8601 strings compare safely)
 *   2. turn_number      — when BOTH events carry one (pi_turn_start/end,
 *                         pi_request_snapshot): an earlier turn's end sorts
 *                         before a later turn's start even in the same ms
 *   3. causal type rank — the order the emitter actually fires events within
 *                         one run cycle (see CAUSAL_RANK)
 *   4. eventId          — final deterministic tie-break
 *
 * Every downstream sort keys on startTime with JS's stable Array#sort, so the
 * canonical order established here survives the whole pipeline for ties.
 */

import { EventType, UI_ASK_ANSWERED, UI_ASK_REQUESTED, type TraceEvent } from "../types";

/**
 * Emission order of event types within one run cycle. Lower = fired earlier.
 * Derived from the emitter/spawn-pipeline sequence:
 *   session start → pi agent start → provisioning (prompt, context build) →
 *   run start → user message → turn start → request snapshot → tool calls →
 *   assistant reply → turn end → run end → pi agent end → session end.
 * Unknown types sit at DEFAULT_RANK (between user message and turn start) so
 * they never leapfrog the request/reply ordering this exists to protect.
 */
const CAUSAL_RANK: Record<string, number> = {
  [EventType.AGENT_SESSION_START]: 0,
  [EventType.PI_AGENT_START]: 1,
  [EventType.SYSTEM_PROMPT_RESOLVED]: 2,
  [EventType.CONTEXT_BUILD_STARTED]: 3,
  [EventType.CONTEXT_INPUT_RESOLVED]: 4,
  [EventType.CONTEXT_BUILD_COMPLETED]: 5,
  [EventType.AGENT_RUN_START]: 6,
  [EventType.USER_MESSAGE]: 7,
  [EventType.PI_TURN_START]: 9,
  [EventType.PI_REQUEST_SNAPSHOT]: 10,
  [EventType.TOOL_CALL_START]: 11,
  [EventType.TOOL_CALL_END]: 12,
  [UI_ASK_REQUESTED]: 13,
  [UI_ASK_ANSWERED]: 14,
  [EventType.ASSISTANT_MESSAGE]: 15,
  [EventType.PI_TURN_END]: 16,
  [EventType.AGENT_RUN_END]: 17,
  [EventType.PI_AGENT_END]: 18,
  [EventType.AGENT_SESSION_END]: 19,
};

const DEFAULT_RANK = 8;

/**
 * Host "app:" events fire from end-of-turn hooks, after the emitter has
 * written pi_turn_end — so in a same-millisecond tie they sort after their
 * own turn's tail rather than at DEFAULT_RANK (which would leapfrog them
 * ahead of the request snapshot that produced them). Earlier/later turns
 * still win via the turn_number rule when the app event carries one.
 */
const APP_EVENT_RANK = 16.5;

function rankOf(event: TraceEvent): number {
  const known = CAUSAL_RANK[event.type];
  if (known !== undefined) return known;
  return event.type.startsWith("app:") ? APP_EVENT_RANK : DEFAULT_RANK;
}

function turnNumberOf(event: TraceEvent): number | undefined {
  const raw = (event.eventData as { turn_number?: unknown } | null)?.turn_number;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Canonical emission-order comparator. See module doc for the key chain. */
export function compareEmissionOrder(a: TraceEvent, b: TraceEvent): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;

  const turnA = turnNumberOf(a);
  const turnB = turnNumberOf(b);
  if (turnA !== undefined && turnB !== undefined && turnA !== turnB) {
    return turnA - turnB;
  }

  const rank = rankOf(a) - rankOf(b);
  if (rank !== 0) return rank;

  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/** Events sorted into canonical emission order (input is not mutated). */
export function sortByEmissionOrder(events: TraceEvent[]): TraceEvent[] {
  return [...events].sort(compareEmissionOrder);
}
