import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { GROUP_ACCENT, SPAN_CAP_SIZE } from "../../../icons";
import { SUBORDINATE_SECTION_LABEL_CLASS } from "../../section-label";
import {
	MESSAGE_BLOCK_LIST_CLASS,
	MESSAGE_LIST_CLASS,
	MESSAGE_ROLE_HEADER_CLASS,
	TurnMessage,
	TurnMessageList,
} from "./turn-block-content";

/** A kind band always has a wash; asserting through this keeps that true. */
function bandWash(group: keyof typeof GROUP_ACCENT): string {
	const wash = GROUP_ACCENT[group].wash;
	if (wash === undefined) throw new Error(`${group} band has no wash`);
	return wash;
}

function classNameOf(openingTag: string): string {
	return /\bclass="([^"]*)"/.exec(openingTag)?.[1] ?? "";
}

function spacingStep(className: string): number {
	const value = /\bspace-y-(\d+)\b/.exec(className)?.[1];
	if (value === undefined) throw new Error(`No space-y step in ${className}`);
	return Number(value);
}

function textPixels(className: string): number {
	const value = /\btext-\[(\d+)px\]/.exec(className)?.[1];
	if (value === undefined) throw new Error(`No pixel text size in ${className}`);
	return Number(value);
}

function fontWeight(className: string): number {
	if (className.includes("font-semibold")) return 600;
	if (className.includes("font-medium")) return 500;
	throw new Error(`No tested font weight in ${className}`);
}

describe("TurnMessage image elision placeholder", () => {
	test("renders a complete kernel marker as quiet text without source chrome", () => {
		const marker = "[image elided — image/png, 79.7 KB]";
		const markup = renderToStaticMarkup(
			<TurnMessage
				entry={{
					index: 5,
					message: {
						role: "toolResult",
						content: [{ type: "text", text: marker }],
					},
				}}
				apiBase="http://localhost:4319"
			/>,
		);

		expect(markup).toContain('data-message-role="toolResult"');
		expect(markup).toContain('data-image-elision-placeholder=""');
		expect(markup).toContain("text-muted-foreground/70");
		expect(markup).toContain(marker);
		expect(markup).not.toContain("data-doc-figure");
		expect(markup).not.toContain("data-doc-line-number");
		expect(markup).not.toContain("data-doc-gutter");
	});
});

describe("TurnMessage card chrome", () => {
	function chromeOf(message: Parameters<typeof TurnMessage>[0]["entry"]["message"], kernelAuthored = false) {
		return renderToStaticMarkup(
			<TurnMessage
				entry={{ index: 0, message }}
				apiBase="http://localhost:4319"
				kernelAuthored={kernelAuthored}
			/>,
		);
	}

	test("maps every role onto the trace tree's group band and glyph", () => {
		const user = chromeOf({ role: "user", content: "hi" });
		const assistant = chromeOf({ role: "assistant", content: "hey" });
		const toolResult = chromeOf({ role: "toolResult", content: "done" });
		const kernel = chromeOf({ role: "custom", content: "state" }, true);

		expect(user).toContain(GROUP_ACCENT.user.border);
		expect(user).toContain(bandWash("user"));
		expect(user).toContain('aria-label="User message"');

		expect(assistant).toContain(GROUP_ACCENT.assistant.border);
		expect(assistant).toContain(bandWash("assistant"));
		expect(assistant).toContain('aria-label="Assistant message"');

		expect(toolResult).toContain(GROUP_ACCENT.tool.border);
		expect(toolResult).toContain(bandWash("tool"));
		expect(toolResult).toContain('aria-label="Tool result message"');

		// Kernel lines are plumbing: neutral hairline, no wash, gear glyph — and
		// they keep their KERNEL badge and authorship attribute.
		expect(kernel).toContain(GROUP_ACCENT.lifecycle.border);
		expect(kernel).not.toContain("band-wash-opacity");
		expect(kernel).toContain('aria-label="Kernel message"');
		expect(kernel).toContain('data-message-author="kernel"');
		expect(kernel).toContain("Kernel");
	});

	test("paints no ordinal — a message is identified by its role, not a number", () => {
		const markup = renderToStaticMarkup(
			<TurnMessage
				entry={{ index: 7, message: { role: "user", content: "hi" } }}
				apiBase="http://localhost:4319"
			/>,
		);
		// The index survives as a DOM hook; it is simply never drawn.
		expect(markup).toContain('data-message-index="7"');
		expect(markup).not.toContain("#7");
		expect(markup).not.toContain("tabular-nums");
	});

	test("keeps each role's glyph distinct so the cap identifies the message", () => {
		const glyph = (markup: string) =>
			/<path[^>]*\bd="([^"]*)"/.exec(markup)?.[1] ?? "";
		const paths = [
			glyph(chromeOf({ role: "user", content: "hi" })),
			glyph(chromeOf({ role: "assistant", content: "hey" })),
			glyph(chromeOf({ role: "toolResult", content: "done" })),
			glyph(chromeOf({ role: "custom", content: "state" }, true)),
		];
		expect(paths.every((path) => path.length > 0)).toBe(true);
		expect(new Set(paths).size).toBe(paths.length);
	});
});

describe("TurnMessage hierarchy", () => {
	test("bounds role-colored messages and nests quieter blocks at tighter spacing", () => {
		const marker = "[image elided — image/png, 79.7 KB]";
		const markup = renderToStaticMarkup(
			<TurnMessageList
				entries={[
					{
						index: 4,
						message: {
							role: "assistant",
							content: [
								{ type: "thinking", thinking: "Plan" },
								{ type: "toolCall", name: "first", arguments: { x: 1 } },
								{ type: "toolCall", name: "second", arguments: { y: 2 } },
							],
						},
					},
					{
						index: 5,
						message: {
							role: "toolResult",
							content: [
								{ type: "text", text: "APPLIED\nDELTA" },
								{ type: "text", text: marker },
							],
						},
					},
				]}
				apiBase="http://localhost:4319"
				subsection="tail"
			/>,
		);

		const assistantStart = markup.indexOf('data-message-index="4"');
		const toolResultStart = markup.indexOf('data-message-index="5"');
		const assistant = markup.slice(assistantStart, toolResultStart);
		const toolResult = markup.slice(toolResultStart);
		const assistantArticle = markup.slice(
			markup.lastIndexOf("<article", assistantStart),
			markup.indexOf(">", assistantStart) + 1,
		);
		const toolResultArticle = markup.slice(
			markup.lastIndexOf("<article", toolResultStart),
			markup.indexOf(">", toolResultStart) + 1,
		);
		const roleHeader = /<div[^>]*data-message-role-header=""[^>]*>/.exec(
			assistant,
		)?.[0] ?? "";
		const messageBlocks = /<div[^>]*data-message-blocks=""[^>]*>/.exec(
			assistant,
		)?.[0] ?? "";
		const messageList = /<div[^>]*data-turn-subsection="tail"[^>]*>/.exec(
			markup,
		)?.[0] ?? "";

		// The message wears the TREE's card: the group band (border + wash) at the
		// shared 2px radius, with the icon cap pinned in the corner. Pinned via
		// GROUP_ACCENT so retuning a band moves both surfaces together or neither.
		expect(classNameOf(assistantArticle)).toContain("rounded-[2px]");
		expect(classNameOf(assistantArticle)).toContain(GROUP_ACCENT.assistant.border);
		expect(classNameOf(assistantArticle)).toContain(bandWash("assistant"));
		expect(classNameOf(assistantArticle)).toContain("w-full");
		expect(classNameOf(toolResultArticle)).toContain(GROUP_ACCENT.tool.border);
		expect(classNameOf(toolResultArticle)).toContain(bandWash("tool"));
		expect(assistant).toContain('aria-label="Assistant message"');
		expect(toolResult).toContain('aria-label="Tool result message"');
		// The role line shares the cap's row, so the cap reads as its marker.
		expect(roleHeader).toContain(`height:${SPAN_CAP_SIZE}px`);
		expect(assistant).toContain("text-trace-assistant");
		expect(toolResult).toContain("text-trace-tool");
		expect(assistant.match(/data-doc-caption-tier="subordinate"/g)).toHaveLength(3);
		expect(messageBlocks).toContain(MESSAGE_BLOCK_LIST_CLASS);
		expect(messageList).toContain(MESSAGE_LIST_CLASS);
		expect(spacingStep(classNameOf(messageList))).toBeGreaterThan(
			spacingStep(classNameOf(messageBlocks)),
		);
		expect(textPixels(MESSAGE_ROLE_HEADER_CLASS)).toBeGreaterThan(
			textPixels(SUBORDINATE_SECTION_LABEL_CLASS),
		);
		expect(fontWeight(MESSAGE_ROLE_HEADER_CLASS)).toBeGreaterThan(
			fontWeight(SUBORDINATE_SECTION_LABEL_CLASS),
		);
	});
});
