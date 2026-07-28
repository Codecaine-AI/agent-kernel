import { describe, expect, test } from "bun:test";

import { EventType, TraceLevel, type TraceEvent } from "../types";

import { compareEmissionOrder, sortByEmissionOrder } from "./eventOrder";

const TS = "2026-07-27T16:10:22.016Z";

function event(partial: Partial<TraceEvent> & { eventId: string; type: string }): TraceEvent {
	return {
		containerId: "c1",
		runId: "run-1",
		piSessionId: "pi-1",
		source: "kernel",
		traceLevel: TraceLevel.PROCESSING,
		eventData: null,
		timestamp: TS,
		...partial,
	} as TraceEvent;
}

describe("compareEmissionOrder", () => {
	test("timestamp stays the primary key", () => {
		const early = event({ eventId: "z", type: EventType.ASSISTANT_MESSAGE, timestamp: "2026-07-27T16:10:22.015Z" });
		const late = event({ eventId: "a", type: EventType.PI_REQUEST_SNAPSHOT });
		expect(compareEmissionOrder(early, late)).toBeLessThan(0);
	});

	test("same-timestamp tie: request snapshot sorts before the reply it produced, regardless of eventId order", () => {
		// The demo-db bug: the assistant reply's id sorted BEFORE the Turn-1
		// snapshot's id, so (timestamp, eventId) ordering rendered the reply
		// first. Give the reply the lexicographically SMALLER id to prove the
		// causal rank — not the id — breaks the tie.
		const reply = event({ eventId: "aaaa", type: EventType.ASSISTANT_MESSAGE });
		const snapshot = event({
			eventId: "zzzz",
			type: EventType.PI_REQUEST_SNAPSHOT,
			eventData: { turn_number: 1 },
		});
		expect(compareEmissionOrder(snapshot, reply)).toBeLessThan(0);
		expect(sortByEmissionOrder([reply, snapshot]).map((e) => e.type)).toEqual([
			EventType.PI_REQUEST_SNAPSHOT,
			EventType.ASSISTANT_MESSAGE,
		]);
	});

	test("same-timestamp tie: tool_call_start sorts before tool_call_end", () => {
		const end = event({ eventId: "aaaa", type: EventType.TOOL_CALL_END });
		const start = event({ eventId: "zzzz", type: EventType.TOOL_CALL_START });
		expect(sortByEmissionOrder([end, start]).map((e) => e.type)).toEqual([
			EventType.TOOL_CALL_START,
			EventType.TOOL_CALL_END,
		]);
	});

	test("same-timestamp tie: user message precedes its turn's snapshot; run start precedes user message", () => {
		const snapshot = event({ eventId: "a", type: EventType.PI_REQUEST_SNAPSHOT, eventData: { turn_number: 0 } });
		const user = event({ eventId: "b", type: EventType.USER_MESSAGE });
		const runStart = event({ eventId: "c", type: EventType.AGENT_RUN_START });
		expect(sortByEmissionOrder([snapshot, user, runStart]).map((e) => e.type)).toEqual([
			EventType.AGENT_RUN_START,
			EventType.USER_MESSAGE,
			EventType.PI_REQUEST_SNAPSHOT,
		]);
	});

	test("turn_number outranks type at a turn boundary: turn 0's end before turn 1's start", () => {
		const nextStart = event({ eventId: "a", type: EventType.PI_TURN_START, eventData: { turn_number: 1 } });
		const prevEnd = event({ eventId: "b", type: EventType.PI_TURN_END, eventData: { turn_number: 0 } });
		expect(sortByEmissionOrder([nextStart, prevEnd]).map((e) => e.type)).toEqual([
			EventType.PI_TURN_END,
			EventType.PI_TURN_START,
		]);
		// Same turn (zero-length): start before end by causal rank.
		const start0 = event({ eventId: "z", type: EventType.PI_TURN_START, eventData: { turn_number: 0 } });
		const end0 = event({ eventId: "a", type: EventType.PI_TURN_END, eventData: { turn_number: 0 } });
		expect(sortByEmissionOrder([end0, start0]).map((e) => e.type)).toEqual([
			EventType.PI_TURN_START,
			EventType.PI_TURN_END,
		]);
	});

	test("full tie falls back to eventId so the order is total and deterministic", () => {
		const a = event({ eventId: "a", type: EventType.CONTEXT_INPUT_RESOLVED });
		const b = event({ eventId: "b", type: EventType.CONTEXT_INPUT_RESOLVED });
		expect(compareEmissionOrder(a, b)).toBeLessThan(0);
		expect(compareEmissionOrder(b, a)).toBeGreaterThan(0);
		expect(compareEmissionOrder(a, a)).toBe(0);
	});
});
