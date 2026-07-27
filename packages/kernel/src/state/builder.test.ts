/**
 * builder.test.ts — three-section assembly and the boundaries it reports.
 * Sections are half-open [start, end) and must not overlap: context, then
 * state, then tail.
 */
import { describe, expect, test } from "bun:test";

import { buildRequest, normalizeRenderOutput } from "./builder";
import { createContextSet } from "./context-set";
import type { AgentMessage, RequestSection } from "./types";

function msg(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 1,
	} as unknown as AgentMessage;
}

function textOf(message: AgentMessage): string {
	const content = (message as unknown as { content: Array<{ text?: string }> })
		.content;
	return content[0]?.text ?? "";
}

/** Sections must tile the message list without gaps or overlaps. */
function assertNonOverlapping(
	sections: RequestSection[],
	total: number,
): void {
	let cursor = 0;
	for (const section of sections) {
		expect(section.start).toBe(cursor);
		expect(section.end).toBeGreaterThan(section.start);
		cursor = section.end;
	}
	expect(cursor).toBe(total);
}

describe("builder — section boundaries", () => {
	test("context + state + tail tile the request in order", () => {
		const built = buildRequest({
			contextMessage: msg("<context>caps</context>"),
			rendered: {
				messages: [msg("<state v=1/>"), msg("t1"), msg("t2")],
				stateMessageCount: 1,
			},
		});
		expect(built.messages).toHaveLength(4);
		expect(built.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
			{ kind: "tail", start: 2, end: 4 },
		]);
		assertNonOverlapping(built.sections, built.messages.length);
	});

	test("a bare array render is all tail", () => {
		const built = buildRequest({
			contextMessage: null,
			rendered: [msg("t1"), msg("t2")],
		});
		expect(built.sections).toEqual([{ kind: "tail", start: 0, end: 2 }]);
		assertNonOverlapping(built.sections, 2);
	});

	test("an empty context set emits no context section", () => {
		const built = buildRequest({
			contextMessage: createContextSet().render(),
			rendered: { messages: [msg("s")], stateMessageCount: 1 },
		});
		expect(built.sections).toEqual([{ kind: "state", start: 0, end: 1 }]);
	});

	test("an all-state render emits no tail section", () => {
		const built = buildRequest({
			contextMessage: msg("ctx"),
			rendered: { messages: [msg("s1"), msg("s2")], stateMessageCount: 2 },
		});
		expect(built.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 3 },
		]);
		assertNonOverlapping(built.sections, 3);
	});

	test("nothing rendered and no context yields no messages and no sections", () => {
		const built = buildRequest({ contextMessage: null, rendered: [] });
		expect(built.messages).toEqual([]);
		expect(built.sections).toEqual([]);
	});

	test("the context message always comes first", () => {
		const built = buildRequest({
			contextMessage: msg("ctx"),
			rendered: [msg("tail")],
		});
		expect(textOf(built.messages[0])).toBe("ctx");
	});

	test("an over-large stateMessageCount is clamped to what was rendered", () => {
		const normalized = normalizeRenderOutput({
			messages: [msg("a")],
			stateMessageCount: 9,
		});
		expect(normalized.stateMessageCount).toBe(1);
		const built = buildRequest({
			contextMessage: null,
			rendered: { messages: [msg("a")], stateMessageCount: 9 },
		});
		expect(built.sections).toEqual([{ kind: "state", start: 0, end: 1 }]);
	});

	test("a negative stateMessageCount clamps to zero", () => {
		expect(
			normalizeRenderOutput({ messages: [msg("a")], stateMessageCount: -4 })
				.stateMessageCount,
		).toBe(0);
	});

	test("rendered messages pass through by reference", () => {
		const tail = msg("t");
		const built = buildRequest({ contextMessage: null, rendered: [tail] });
		expect(built.messages[0]).toBe(tail);
	});
});
