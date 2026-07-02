/**
 * Deterministic event-id derivation shared by every emission path.
 *
 * The in-process kernel emitter (packages/kernel) and the JSONL backfill
 * mapper (packages/tailer) both derive event ids here so that live emission
 * followed by a backfill of the same Pi session inserts zero duplicate rows
 * (trace_events inserts are keyed by event_id with INSERT OR IGNORE).
 */

import { createHash } from "node:crypto";

/**
 * Deterministic UUID-shaped id from a seed string (sha-256 truncated).
 * The same seed always produces the same event id.
 */
export function deterministicEventId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Event id for a trace event derived from one Pi session JSONL entry.
 *
 * Seed layout (do not change — stored ids depend on it):
 *   `${piSessionUuid}\n${entryId}\n${ordinal}\n${type}`
 *
 * - `piSessionUuid` — the Pi session uuid (JSONL header id).
 * - `entryId` — the JSONL entry id the event was derived from. For the
 *   session header entry itself, this is the session uuid.
 * - `ordinal` — index of this event among the events produced from the same
 *   entry (a message entry can yield several events: text blocks, tool calls).
 * - `type` — the protocol event type.
 */
export function piEntryEventId(
  piSessionUuid: string,
  entryId: string,
  ordinal: number,
  type: string,
): string {
  return deterministicEventId(`${piSessionUuid}\n${entryId}\n${ordinal}\n${type}`);
}

/**
 * Documented fallback for live events whose JSONL entry id cannot be
 * observed at emit time (see kernel emitter). Deterministic from the live
 * stream position — NOT random — but it cannot match the backfill id, so a
 * later backfill of the same entry may insert a second row for that event.
 */
export function liveFallbackEventId(
  piSessionUuid: string,
  turnOrdinal: number,
  type: string,
  indexWithinTurn: number,
): string {
  return deterministicEventId(
    `${piSessionUuid}\nlive-turn:${turnOrdinal}:${indexWithinTurn}\n0\n${type}`,
  );
}
