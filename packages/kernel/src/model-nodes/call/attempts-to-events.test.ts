/**
 * Per-attempt event order (plan §4.4 Timestamps): like a chat turn, each
 * attempt reads pi_turn_start, then its pi_request_snapshot, then
 * pi_turn_end, in strictly increasing timestamps, whatever the attempt's
 * reported start and duration.
 */
import { describe, expect, test } from "bun:test";

import type { NodeRunHandle } from "../node-run";
import { createNodeClock } from "../scope";
import type { EngineAttempt } from "../types";
import { attemptsToEvents } from "./attempts-to-events";

/** A NodeRunHandle on a fresh node clock whose call_start is at `startedAtMs`. */
function handleAt(startedAtMs: number): NodeRunHandle {
	const clock = createNodeClock(() => startedAtMs);
	clock.nextMs();
	const traceIds = { containerId: "c", runId: "r", piSessionUuid: "s" };
	return {
		kind: "call",
		name: "Extract",
		ids: { containerId: "c", sessionId: "s", runId: "r" },
		attempt: 1,
		startEventId: "start",
		startedAtMs,
		deadlineAtMs: startedAtMs + 60_000,
		signal: new AbortController().signal,
		deadlineExceeded: () => false,
		traceIds,
		eventId: (ordinal, type) => `${type}-${ordinal}`,
		timestamp: () => clock.nextIso(),
		turnWindow(attemptStartedAtMs, durationMs) {
			const start = Math.max(attemptStartedAtMs, startedAtMs + 1);
			const end = Math.max(start + (durationMs !== null && durationMs > 0 ? durationMs : 0), start + 1);
			clock.observe(end);
			return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
		},
	};
}

function attempt(startedAtMs: number, durationMs: number | null): EngineAttempt {
	return {
		transport: "baml-http",
		clientName: "KernelCall",
		provider: "openai-responses",
		startedAtMs,
		durationMs,
		selected: true,
		status: 200,
		usage: null,
		request: { method: "POST", url: "http://fake.invalid/v1/responses", headers: {}, body: { input: [] } },
		response: { status: 200, headers: {}, body: {} },
	};
}

describe("attemptsToEvents", () => {
	test("each attempt orders pi_turn_start < pi_request_snapshot < pi_turn_end", () => {
		const t0 = 1_700_000_000_000;
		const { events } = attemptsToEvents(handleAt(t0), {
			// An attempt starting at call_start with no duration, a zero-duration one, and an ordinary one.
			attempts: [attempt(t0, null), attempt(t0 + 10, 0), attempt(t0 + 20, 30)],
			secrets: [],
			promptHash: "baml1-fake",
			provider: "fake",
			selectedStopReason: "stop",
		});
		for (const i of [0, 1, 2]) {
			const at = (type: string) => Date.parse(events.find((e) => e.eventId === `${type}-${i}`)!.timestamp);
			expect(at("pi_turn_start")).toBeGreaterThan(t0);
			expect(at("pi_request_snapshot")).toBeGreaterThan(at("pi_turn_start"));
			expect(at("pi_turn_end")).toBeGreaterThan(at("pi_request_snapshot"));
		}
		expect(events.map((e) => e.type).slice(0, 3)).toEqual(["pi_turn_start", "pi_request_snapshot", "pi_turn_end"]);
	});
});
