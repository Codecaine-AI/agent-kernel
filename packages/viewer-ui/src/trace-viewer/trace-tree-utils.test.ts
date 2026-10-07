/**
 * trace-tree-utils.test.ts — level filtering vs. turn nesting.
 *
 * Turn containers (pi_request_snapshot, trace level 2) own their tool
 * children after the trace-builder restructure. The filter must not make
 * those children vanish at any level where tools are visible:
 *   - L1 (Tools): the Turn row itself is above the cutoff, but it stays
 *     visible as the owner of its surviving tool children;
 *   - L0 (Messages): tools drop, the Turn drops with them, and the
 *     assistant reply hoists so the conversation reads flat.
 */
import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { filterSpansByTraceLevel } from "./trace-tree-utils";

let idSeq = 0;

function span(
	title: string,
	eventType: string,
	traceLevel: number,
	children?: TraceSpan[],
): TraceSpan {
	idSeq += 1;
	const ts = new Date("2026-07-27T00:00:00.000Z");
	return {
		id: `span-${idSeq}`,
		title,
		startTime: ts,
		endTime: ts,
		duration: 0,
		type: "event",
		status: "success",
		raw: "{}",
		attributes: [
			{ key: "event_type", value: { stringValue: eventType } },
			{ key: "trace_level", value: { intValue: String(traceLevel) } },
		],
		children,
	};
}

function shape(spans: TraceSpan[]): unknown[] {
	return spans.map((s) => [s.title, shape(s.children ?? [])]);
}

function turnTree(): TraceSpan[] {
	return [
		span("user_message", "user_message", 0, [
			span("Turn 0", "pi_request_snapshot", 2, [
				span("update_sticky", "tool_call_start", 1),
				span("add_object", "tool_call_start", 1),
				span("text", "assistant_message", 0),
			]),
			span("pi_turn_end", "pi_turn_end", 3),
		]),
	];
}

describe("filterSpansByTraceLevel with turn containers", () => {
	it("keeps everything nested at L2+", () => {
		expect(shape(filterSpansByTraceLevel(turnTree(), 2))).toEqual([
			[
				"user_message",
				[
					[
						"Turn 0",
						[["update_sticky", []], ["add_object", []], ["text", []]],
					],
				],
			],
		]);
	});

	it("keeps the Turn container visible at L1 when its tool children survive", () => {
		expect(shape(filterSpansByTraceLevel(turnTree(), 1))).toEqual([
			[
				"user_message",
				[
					[
						"Turn 0",
						[["update_sticky", []], ["add_object", []], ["text", []]],
					],
				],
			],
		]);
	});

	it("drops the Turn container at L0 and hoists the reply for a flat conversation", () => {
		expect(shape(filterSpansByTraceLevel(turnTree(), 0))).toEqual([
			["user_message", [["text", []]]],
		]);
	});

	it("still hoists children of non-turn filtered spans", () => {
		const tree = [
			span("wrapper", "pi_turn_start", 3, [
				span("text", "assistant_message", 0),
			]),
		];
		expect(shape(filterSpansByTraceLevel(tree, 0))).toEqual([["text", []]]);
	});
});

describe("filterSpansByTraceLevel with model nodes", () => {
	/** A node row as viewer-core builds it: no trace level, synthetic id. */
	function nodeRow(title: string, id: string, eventType: string, children: TraceSpan[]): TraceSpan {
		const row = span(title, eventType, 0, children);
		return {
			...row,
			id,
			attributes: [{ key: "event_type", value: { stringValue: eventType } }],
		};
	}

	function nodeTree(): TraceSpan[] {
		return [
			span("llm-review-advisories", "gate_start", 1, [
				span("justification:A1", "step_start", 1),
				nodeRow("JudgeAdvisory:A2", "pi:retry", "decision_container", [
					nodeRow("attempt 1", "attempt:r1", "decision_attempt", [
						span("Turn 0", "pi_request_snapshot", 2),
					]),
					nodeRow("attempt 2", "attempt:r2", "decision_attempt", []),
				]),
			]),
		];
	}

	it("node types survive L1: the gate keeps its step, decision row and attempts", () => {
		expect(shape(filterSpansByTraceLevel(nodeTree(), 1))).toEqual([
			[
				"llm-review-advisories",
				[
					["justification:A1", []],
					["JudgeAdvisory:A2", [["attempt 1", []], ["attempt 2", []]]],
				],
			],
		]);
	});

	it("node rows and their gate stay at L0 too; only the classifier turn drops", () => {
		expect(shape(filterSpansByTraceLevel(nodeTree(), 0))).toEqual(
			shape(filterSpansByTraceLevel(nodeTree(), 1)),
		);
	});
});
