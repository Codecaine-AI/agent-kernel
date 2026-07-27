/**
 * real-snapshot-render.test.tsx — the turn renderer against REAL captured data
 * plus the shapes a real builder can legitimately hand it.
 *
 * turn-sections.test.tsx covers the hand-written canvas fixture (the rich
 * state.ts case). This file covers what the kernel actually produced on a live
 * run — a BASE agent with only a window policy, whose section ③ is the elision
 * marker rather than an XML state block — and the adversarial edges: an empty
 * tail, a state block full of characters that could break the highlighter, and
 * section ranges that claim more messages than the snapshot carries.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import { SnapshotContextBody } from "./RequestSnapshotRenderer";
import { highlightXmlish, looksLikeStateBlock } from "./state-block";
import { groupTurnSections, parseSectionTags } from "./turn-sections";
import type { RunTurnContextResponse, SanitizedMessage } from "./request-snapshot-api";
import { realTurnContext } from "./__fixtures__/real-turn-context";

const API_BASE = "http://localhost:4319";

function renderBody(context: RunTurnContextResponse): string {
	return renderToStaticMarkup(
		createElement(SnapshotContextBody, {
			systemPrompt: context.system_prompt,
			messages: context.messages,
			sections: parseSectionTags(context.sections),
			apiBase: API_BASE,
		}),
	);
}

function sectionIds(markup: string): string[] {
	return [...markup.matchAll(/data-turn-section="([a-z]+)"/g)].map((m) => m[1]!);
}

function count(markup: string, needle: string): number {
	return markup.split(needle).length - 1;
}

// ─── The real capture ───────────────────────────────────────────────────────

describe("real captured turn (kernel run, base state module + 2-turn window)", () => {
	test("the capture is what the pipeline claims it is", () => {
		expect(realTurnContext.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
			{ kind: "tail", start: 2, end: 7 },
		]);
		expect(realTurnContext.messages.length).toBe(realTurnContext.message_count);
		// Half-open, contiguous, in bounds.
		let cursor = 0;
		for (const section of realTurnContext.sections!) {
			expect(section.start).toBe(cursor);
			expect(section.end).toBeGreaterThan(section.start);
			cursor = section.end;
		}
		expect(cursor).toBe(realTurnContext.messages.length);
	});

	test("renders the three sections without crashing on real data", () => {
		const markup = renderBody(realTurnContext);
		expect(markup).toContain('data-turn-view="sections"');
		expect(sectionIds(markup)).toEqual(["system", "context", "state"]);
		// Nothing fell outside the tags.
		expect(markup).not.toContain('data-turn-section="untagged"');
	});

	test("② carries the rebuilt L2 context message, escaped", () => {
		const markup = renderBody(realTurnContext);
		expect(markup).toContain("&lt;state_demo_context&gt;");
		// The hostile characters the context loader plants survive escaping.
		expect(markup).toContain("&amp;");
		expect(markup).toContain("→");
		expect(markup).toContain("×");
	});

	test("③ opens with the kernel's elision marker and keeps the tail as message cards", () => {
		const markup = renderBody(realTurnContext);
		expect(markup).toContain("[turns 1–2 elided]");
		expect(markup).toContain('data-turn-subsection="tail"');
		// 5 tail messages: the two surviving turns.
		const tail = groupTurnSections(
			realTurnContext.messages,
			parseSectionTags(realTurnContext.sections)!,
		).tail;
		expect(tail.map((entry) => entry.message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"user",
		]);
		expect(markup).toContain("probe"); // the real toolCall name
		expect(markup).toContain("probe → run-3"); // the real tool result
	});

	test("the base module's elision marker is NOT an XML state block", () => {
		// Base agents emit a plain text marker, so ③ renders it as text rather
		// than through StateBlockView's XML-ish printer.
		const marker = realTurnContext.messages[1] as SanitizedMessage;
		const text = (marker.content as Array<{ text: string }>)[0]!.text;
		expect(looksLikeStateBlock(text)).toBe(false);
		const markup = renderBody(realTurnContext);
		expect(markup).not.toContain("data-state-block");
	});

	test("kernel-authored lines are badged KERNEL, never USER", () => {
		// ② (the rebuilt context message) and ③ (the elision marker) are things
		// the KERNEL wrote, not things the user said. The kernel ships them as
		// role "custom" with a kernel: customType — provider-valid via pi's
		// convertToLlm — precisely so this badge is possible.
		const contextMessage = realTurnContext.messages[0] as SanitizedMessage;
		const marker = realTurnContext.messages[1] as SanitizedMessage;
		expect(contextMessage.role).toBe("custom");
		expect(contextMessage.customType).toBe("kernel:context");
		expect(marker.role).toBe("custom");
		expect(marker.customType).toBe("kernel:state");
		expect(isKernelAuthoredMessage(contextMessage)).toBe(true);
		expect(isKernelAuthoredMessage(marker)).toBe(true);

		const markup = renderBody(realTurnContext);
		expect(count(markup, 'data-message-author="kernel"')).toBe(2);
		// The ② card wears KERNEL; nothing kernel-authored wears USER.
		expect(markup).toContain(">Kernel<");
		expect(markup).not.toContain('data-message-role="user" data-message-author');
		// Only the real conversation turns are user/assistant/toolResult cards.
		const userCards = count(markup, 'data-message-role="user"');
		expect(userCards).toBe(2); // the two real user turns in the tail
	});
});

// ─── Adversarial shapes ─────────────────────────────────────────────────────

const STATE_MESSAGE = (text: string): SanitizedMessage => ({
	role: "custom",
	customType: "state",
	content: [{ type: "text", text }],
});

describe("adversarial section shapes", () => {
	test("sections with an empty tail render ③ without a tail divider", () => {
		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 0,
			prompt_hash: null,
			system_prompt: "sys",
			message_count: 2,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 1, end: 2 },
				{ kind: "tail", start: 2, end: 2 },
			],
			messages: [
				{ role: "user", content: [{ type: "text", text: "<context>c</context>" }] },
				STATE_MESSAGE('<state v="1"><board>empty</board></state>'),
			],
		};
		const markup = renderBody(context);
		expect(sectionIds(markup)).toEqual(["system", "context", "state"]);
		expect(markup).not.toContain('data-turn-subsection="tail"');
		expect(markup).toContain("data-state-block");
	});

	test("a hostile state block round-trips through the highlighter", () => {
		const hostile = [
			'<state v="2" note="quotes \'&\' &amp; angles">',
			"  <board>",
			'    a → b × 3 · "quoted" & bare & <not a tag',
			"    <!-- comment with < and > -->",
			"    5 < 6 > 4 → done",
			"  </board>",
			"  <malformed <>>",
			"</state>",
		].join("\n");
		// Every character survives, in order.
		expect(highlightXmlish(hostile).map((s) => s.value).join("")).toBe(hostile);
		expect(looksLikeStateBlock(hostile)).toBe(true);

		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 1,
			prompt_hash: null,
			system_prompt: null,
			message_count: 2,
			sections: [
				{ kind: "state", start: 0, end: 1 },
				{ kind: "tail", start: 1, end: 2 },
			],
			messages: [
				STATE_MESSAGE(hostile),
				{ role: "user", content: [{ type: "text", text: "carry on" }] },
			],
		};
		const markup = renderBody(context);
		expect(markup).toContain("data-state-block");
		// Escaped, never injected as markup.
		expect(markup).toContain("&amp;amp;");
		expect(markup).toContain("→");
		expect(markup).toContain("×");
		expect(markup).not.toContain("<state v=");
		// ① with no system prompt still renders its empty state.
		expect(markup).toContain("No system prompt captured for this turn.");
	});

	test("ranges longer than the message list clamp instead of crashing", () => {
		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 2,
			prompt_hash: null,
			system_prompt: "sys",
			message_count: 3,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 1, end: 2 },
				{ kind: "tail", start: 2, end: 99 },
			],
			messages: [
				{ role: "user", content: [{ type: "text", text: "<context>c</context>" }] },
				STATE_MESSAGE('<state v="9"/>'),
				{ role: "user", content: [{ type: "text", text: "only one tail message" }] },
			],
		};
		const model = groupTurnSections(context.messages, parseSectionTags(context.sections)!);
		expect(model.tail.length).toBe(1);
		expect(model.untagged.length).toBe(0);

		const markup = renderBody(context);
		// Exactly three messages rendered: no duplication, no dropped slot.
		expect(count(markup, "data-message-role=")).toBe(2); // ② + tail; ③ is the state block
		expect(markup).toContain("data-state-block");
		expect(markup).toContain("only one tail message");
	});

	test("a missing blob placeholder and an unknown block shape render, not crash", () => {
		// getRunTurnContext substitutes {missing_blob} for an unresolvable
		// message — no role, no content — and any block shape it does not know
		// degrades to JSON. Both can land inside a tagged section.
		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 4,
			prompt_hash: null,
			system_prompt: "sys",
			message_count: 3,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 1, end: 2 },
				{ kind: "tail", start: 2, end: 3 },
			],
			messages: [
				{ missing_blob: "b1-deadbeef" } as unknown as SanitizedMessage,
				{ missing_blob: "b1-cafebabe" } as unknown as SanitizedMessage,
				{
					role: "assistant",
					content: [
						{ type: "video", src: "nope" },
						{ type: "image", mimeType: "image/png" },
					],
				},
			],
		};
		const markup = renderBody(context);
		expect(markup).toContain("Empty message.");
		expect(markup).toContain("video");
		expect(sectionIds(markup)).toEqual(["system", "context", "state"]);
	});

	test("a range starting past the end of the list renders an empty section", () => {
		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 3,
			prompt_hash: null,
			system_prompt: "sys",
			message_count: 1,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 7, end: 9 },
			],
			messages: [{ role: "user", content: [{ type: "text", text: "just context" }] }],
		};
		const markup = renderBody(context);
		expect(markup).toContain("No state rendered.");
		expect(markup).toContain("just context");
	});
});

// ─── Back-compat ────────────────────────────────────────────────────────────

describe("untagged snapshots", () => {
	test("render flat, exactly as before section tags existed", () => {
		const untagged: RunTurnContextResponse = {
			...realTurnContext,
			sections: undefined,
		};
		const markup = renderBody(untagged);
		expect(markup).toContain('data-turn-view="flat"');
		expect(markup).not.toContain("data-turn-section");
		expect(markup).toContain("Context window");
		// Every message still shown, in context order.
		expect(count(markup, "data-message-role=")).toBe(realTurnContext.messages.length);
	});
});
