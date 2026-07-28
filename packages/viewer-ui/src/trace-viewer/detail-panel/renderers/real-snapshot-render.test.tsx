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
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import { DetailShell } from "../DetailShell";
import { buildSnapshotContextView } from "./TurnBody";
import { highlightXmlish, looksLikeStateBlock } from "./state-block";
import { groupTurnSections, parseSectionTags } from "./turn-sections";
import type { RunTurnContextResponse, SanitizedMessage } from "./request-snapshot-api";
import { realTurnContext } from "./__fixtures__/real-turn-context";

const API_BASE = "http://localhost:4319";
const RETIRED_STATE_MEDIA_ID = ["turn:attached", "renders"].join("-");

/**
 * The elision marker exactly as THIS capture recorded it. The run behind the
 * fixture reused a longer session than the previous capture did, so the count
 * moved; the window still keeps the same two surviving turns.
 */
const REAL_ELISION_MARKER = "[turns 1–10 elided]";

/** The one tool this run offered, in the canonical 2-space JSON form. */
const REAL_PROBE_BODY = [
	"{",
	'  "name": "probe",',
	'  "description": "Echo a note back verbatim. Deterministic, no side effects.",',
	'  "parameters": {',
	'    "type": "object",',
	'    "required": [',
	'      "note"',
	"    ],",
	'    "properties": {',
	'      "note": {',
	'        "type": "string"',
	"      }",
	"    }",
	"  }",
	"}",
].join("\n");

function renderBody(context: RunTurnContextResponse): string {
	const span: TraceSpan = {
		id: `turn-${context.turn_number}`,
		title: `Turn ${context.turn_number}`,
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:01.000Z"),
		duration: 1_000,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [
			{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
		],
	};
	return renderToStaticMarkup(
		<DetailShell
			span={span}
			view={buildSnapshotContextView({
				systemPrompt: context.system_prompt,
				messages: context.messages,
				sections: parseSectionTags(context.sections),
				apiBase: API_BASE,
				// Presence, not length: the adversarial fixtures below carry no
				// roster at all, and must keep saying so rather than borrowing one.
				...(context.tools === undefined ? {} : { tools: context.tools }),
			})}
		/>,
	);
}

function sectionIds(markup: string): string[] {
	return [
		...new Set(
			[...markup.matchAll(/data-turn-section="([a-z]+)"/g)].map(
				(match) => match[1]!,
			),
		),
	];
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

	test("renders the exact four tabs without crashing on real data", () => {
		const markup = renderBody(realTurnContext);
		expect(markup).toContain('data-turn-view="sections"');
		expect(sectionIds(markup)).toEqual([
			"state",
			"context",
			"system",
			"tools",
		]);
		expect(
			[...markup.matchAll(/data-detail-tab-trigger="([^"]+)"/g)].map(
				([, id]) => id,
			),
		).toEqual(["state", "context", "system", "tools"]);
		expect(markup).toContain('data-detail-active-tab="state"');
		// Nothing fell outside the tags.
		expect(markup).not.toContain('data-turn-section="untagged"');
	});

	test("④ is the roster this run really offered, not a not-captured notice", () => {
		// The capture carries the field, so the viewer must show the tool rather
		// than either of the honest empty states.
		expect(realTurnContext.tools?.map((tool) => tool.name)).toEqual(["probe"]);
		const markup = renderBody(realTurnContext);
		expect(markup).toContain('data-detail-block="turn:tool:probe"');
		expect(markup).not.toContain('data-detail-block="turn:tools-not-captured"');
		expect(markup).not.toContain('data-detail-block="turn:tools-empty"');

		const start = markup.indexOf('data-detail-block="turn:tool:probe"');
		const block = markup.slice(start, markup.indexOf("</section>", start));
		// A real data block: captioned with the tool name, on the shared gutter.
		expect(block).toContain('data-doc-language="json"');
		expect(block).toContain("data-doc-line-number");
		expect(block).toContain(">probe</span>");
		// The captured schema reaches the reader whole.
		expect(block).toContain("Echo a note back verbatim.");
		expect(block).toContain("note");
	});

	test("SSR uses the shared gutter for every source while preserving byte-exact text", () => {
		const markup = renderBody(realTurnContext);
		const block = (id: string) => {
			const start = markup.indexOf(`data-detail-block="${id}"`);
			return markup.slice(start, markup.indexOf("</section>", start));
		};
		const system = block("turn:system");
		const context = block("turn:context");
		const state = block("turn:state");
		const sourceBodies =
			markup.match(/<(?:div|pre)[^>]*data-doc-body=""[^>]*>/g) ?? [];

		expect(system).toContain("data-doc-line-number");
		expect(context).toContain("data-doc-line-number");
		expect(state).toContain("data-doc-line-number");
		expect(sourceBodies.length).toBeGreaterThan(0);
		for (const body of sourceBodies) {
			expect(body).toContain("whitespace-pre");
			expect(body).not.toContain(["whitespace", "pre-wrap"].join("-"));
		}
		expect(markup).not.toContain("data-wrap-toggle");
	});

	test("② carries the rebuilt L2 context message, escaped", () => {
		const markup = renderBody(realTurnContext);
		expect(markup).toContain("state_demo_context");
		expect(markup).toContain("prompt-editor-syntax-tag");
		// The hostile characters the context loader plants survive escaping.
		expect(markup).toContain("&amp;");
		expect(markup).toContain("→");
		expect(markup).toContain("×");
	});

	test("③ carries the kernel's elision marker and keeps the tail as conversation", () => {
		const markup = renderBody(realTurnContext);
		expect(
			(realTurnContext.messages[1]!.content as Array<{ text: string }>)[0]!
				.text,
		).toBe(REAL_ELISION_MARKER);
		expect(markup).toContain(REAL_ELISION_MARKER);
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
		// Base agents emit a plain text marker, so ③ remains readable through
		// the standard XML-capable document figure.
		const marker = realTurnContext.messages[1] as SanitizedMessage;
		const text = (marker.content as Array<{ text: string }>)[0]!.text;
		expect(looksLikeStateBlock(text)).toBe(false);
		const markup = renderBody(realTurnContext);
		expect(markup).toContain('data-detail-block="turn:state"');
	});

	test("kernel-authored ranges render as documents, never USER conversation", () => {
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
		expect(count(markup, 'data-message-author="kernel"')).toBe(0);
		const contextBlock = markup.slice(
			markup.indexOf('data-detail-tab="context"'),
			markup.indexOf('data-detail-tab="system"'),
		);
		expect(contextBlock).not.toContain(">User<");
		// Only the real conversation turns are role-labelled rows.
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
	test("state-range attached renders are kernel-authored by position, never USER", () => {
		const attachmentText =
			"attached renders, newest first: (1) close-up, (2) full board, (3) memory bank";
		const context: RunTurnContextResponse = {
			run_id: "r",
			turn_number: 8,
			prompt_hash: null,
			system_prompt: "sys",
			message_count: 2,
			sections: [{ kind: "state", start: 0, end: 2 }],
			messages: [
				STATE_MESSAGE('<state v="2"><board>ready</board></state>'),
				{
					// This is the real transport shape: role:user despite being
					// emitted by render(state). Position, not role, owns authorship.
					role: "user",
					content: [
						{ type: "text", text: attachmentText },
						{ type: "image", blob_hash: "b1-close", mimeType: "image/png" },
						{ type: "image", blob_hash: "b1-board", mimeType: "image/png" },
						{ type: "image", blob_hash: "b1-memory", mimeType: "image/png" },
					],
				},
			],
		};
		const markup = renderBody(context);
		const stateStart = markup.indexOf('data-detail-block="turn:state"');
		expect(stateStart).toBeGreaterThan(-1);
		// The carrier no longer becomes a card of its own: it is embedded INSIDE
		// the state figure as an inline row, so a role:"user" transport shape can
		// never surface as USER conversation.
		expect(markup).not.toContain('data-detail-block="turn:state-message:1"');
		expect(markup).not.toContain('data-message-role="user"');
		expect(markup).not.toContain(">User<");

		const stateBlock = markup.slice(
			stateStart,
			markup.indexOf("</section>", stateStart),
		);
		const inlineStart = stateBlock.indexOf('data-doc-inline-row=""');
		expect(inlineStart).toBeGreaterThan(-1);
		const inlineRow = stateBlock.slice(inlineStart);
		// Its own text survives as the kernel-attributed inline label.
		expect(inlineRow).toContain("Attached renders · kernel");
		expect(inlineRow).toContain(attachmentText);
		const closeImage = inlineRow.indexOf("/kernel/blobs/b1-close");
		const boardImage = inlineRow.indexOf("/kernel/blobs/b1-board");
		const memoryImage = inlineRow.indexOf("/kernel/blobs/b1-memory");
		expect(closeImage).toBeGreaterThan(inlineRow.indexOf(attachmentText));
		expect(boardImage).toBeGreaterThan(closeImage);
		expect(memoryImage).toBeGreaterThan(boardImage);
		expect(inlineRow).toContain("data-turn-thumbnails");
		expect(stateBlock).not.toContain(RETIRED_STATE_MEDIA_ID);
	});

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
		expect(sectionIds(markup)).toEqual(["state", "context", "system"]);
		expect(markup).not.toContain('data-turn-subsection="tail"');
		expect(markup).toContain('data-detail-block="turn:state"');
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
		expect(markup).toContain('data-detail-block="turn:state"');
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
		// Only the real tail message receives conversation treatment.
		expect(count(markup, "data-message-role=")).toBe(1);
		expect(markup).toContain('data-detail-block="turn:state"');
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
		expect(markup).toContain("No rendered context captured");
		expect(markup).toContain("No state rendered.");
		expect(markup).toContain("video");
		expect(sectionIds(markup)).toEqual(["state", "context", "system"]);
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
	test("keeps flat messages inside the Context tab", () => {
		const untagged: RunTurnContextResponse = {
			...realTurnContext,
			sections: undefined,
		};
		const markup = renderBody(untagged);
		expect(markup).toContain('data-turn-view="flat"');
		expect(markup).not.toContain("data-turn-section");
		expect(markup).toContain('data-detail-active-tab="state"');
		expect(
			[...markup.matchAll(/data-detail-tab-trigger="([^"]+)"/g)].map(
				([, id]) => id,
			),
		).toEqual(["state", "context", "system", "tools"]);
		// The roster is orthogonal to section tagging: it still renders in full,
		// it simply carries no section marker on a flat snapshot.
		expect(markup).toContain('data-detail-block="turn:tool:probe"');
		expect(markup).toContain("Context window");
		// Every message still shown, in context order.
		expect(count(markup, "data-message-role=")).toBe(realTurnContext.messages.length);
	});
});
