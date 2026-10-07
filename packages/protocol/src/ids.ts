/**
 * Deterministic event-id derivation shared by every emission path.
 *
 * The in-process kernel emitter and the JSONL backfill mapper
 * (packages/kernel/src/transcript-recovery) both derive event ids here so that
 * live emission followed by a backfill of the same Pi session inserts zero duplicate rows
 * (trace_events inserts are keyed by event_id with INSERT OR IGNORE).
 */

import { sha256Hex } from "./sha256";

/**
 * Deterministic UUID-shaped id from a seed string (sha-256 truncated).
 * The same seed always produces the same event id.
 */
export function deterministicEventId(seed: string): string {
  const hex = sha256Hex(seed);
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

/**
 * Event id for a model-node event (call, decision, step, gate).
 *
 * Seed layout (do not change — stored ids depend on it):
 *   `kernel-node\n${scopeKey}\n${ordinal}\n${type}`
 *
 * - `scopeKey` — the node run id for call/decision events, or
 *   `"span:" + spanId` for step and gate events.
 * - `ordinal` — 0 for call_start, decision_made and call_end; the 0-based
 *   attempt index for an attempt's pi_request_snapshot, pi_turn_start and
 *   pi_turn_end (the type is part of the seed, so they never collide).
 *
 * The literal prefix keeps these seeds disjoint from piEntryEventId seeds,
 * which start with a Pi session uuid.
 */
export function kernelNodeEventId(scopeKey: string, ordinal: number, type: string): string {
  return deterministicEventId(`kernel-node\n${scopeKey}\n${ordinal}\n${type}`);
}

/**
 * Event id for a nested tool call event (a call made inside a codemode
 * script). The live emitter and the JSONL backfill both derive it from the
 * nested call id, so live emission followed by backfill dedupes.
 *
 * Seed layout (do not change — stored ids depend on it):
 *   `${piSessionUuid}\nnested-tool:${nestedCallId}\n0\n${type}`
 */
export function nestedToolEventId(piSessionUuid: string, nestedCallId: string, type: string): string {
  return deterministicEventId(`${piSessionUuid}\nnested-tool:${nestedCallId}\n0\n${type}`);
}

/**
 * Deterministic identity for an idempotent model-node request: the session id
 * of a call/decision (`kind: "session"`) or the span id of a step/gate
 * (`kind: "span"`) issued with a caller `requestId`.
 *
 * Seed layout (do not change — stored ids depend on it):
 *   `kernel-request\n${kernelId}\n${kind}\n${requestId}`
 */
export function kernelRequestId(kernelId: string, kind: "session" | "span", requestId: string): string {
  return deterministicEventId(`kernel-request\n${kernelId}\n${kind}\n${requestId}`);
}

/**
 * The immediate parent of a nested tool call id. Pi names a nested call
 * `<callerId>/<n>` and records no parent field, so the parent is the id with
 * its final `/<n>` stripped: `codemode/1/1` → `codemode/1` → `codemode`.
 * Shared by the live emitter and the backfill mapper so both build the same
 * hierarchy.
 *
 * Returns undefined when the id does not end in `/<n>` (a top-level call id).
 */
export function immediateParentId(id: string): string | undefined {
  const match = /^(.+)\/\d+$/.exec(id);
  return match ? match[1] : undefined;
}
