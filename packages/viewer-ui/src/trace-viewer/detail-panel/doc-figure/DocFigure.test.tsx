/**
 * DocFigure.test — static-markup verification for the shared code figure.
 *
 * These tests use a realistic, 100-plus-line board state to verify lossless
 * dedented source rendering, prompt-source gutters, caption controls, syntax
 * treatment, and containment of pathological long lines without a browser.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	PROMPT_EDITOR_ROOT_CLASS,
	promptEditorGutterWidth,
} from "@codecaine-ai/prompt-kit/ui/surface";

import { dedent } from "../renderers/state-block";
import { SECTION_LABEL_CLASS } from "../renderers/snapshot-message-view";
import { SUBORDINATE_SECTION_LABEL_CLASS } from "../section-label";
import { CLAMP } from "./clamp";
import {
	DocFigure,
	DocFigureCaption,
	DocFigureSubordinateCaption,
} from "./DocFigure";

const LARGE_STATE_BLOCK = [
	"",
	"		<state v=\"21\">",
	"		  <board elements=\"120\">",
	"		    # indent = containment · id type \"text\" [color] x,y w×h",
	...Array.from(
		{ length: 120 },
		(_, index) =>
			`		    obj-${String(index + 1).padStart(3, "0")} rect \"Step ${index + 1}\" ${40 + index * 8},80 140×60`,
	),
	"		    EDGES: obj-001→obj-002 \"success\" · obj-002→obj-003",
	"		  </board>",
	"		  <lints>0 errors · 0 warnings</lints>",
	"		</state>",
	"",
].join("\n");

const REALISTIC_SYSTEM_PROMPT = [
	"<purpose>",
	"    You are the full board editor for a shared whiteboard.",
	"",
	"    **Keep every edit inside the operator's scope.**",
	"</purpose>",
	"",
	"<board_model>",
	"    Every board keeps at least one section.",
	"</board_model>",
	"",
	"<state_grammar>",
	"    The latest <state> block is authoritative.",
	"</state_grammar>",
	"",
	"<workflow>",
	"    # Orient",
	"    Read the board, plan the smallest coherent edit, then apply it.",
	"</workflow>",
].join("\n");

function decodeHtml(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function renderedBodyText(markup: string): string {
	if (markup.includes('data-doc-gutter=""')) {
		return renderedGutterSource(markup);
	}
	const body = /<(div|pre) data-doc-body=""[^>]*>([\s\S]*?)<\/\1>/.exec(
		markup,
	)?.[2];
	if (body === undefined) throw new Error("DocFigure body was not rendered");
	return decodeHtml(
		body
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<[^>]+>/g, ""),
	);
}

function bodyOpeningTag(markup: string): string {
	const tag = /<(?:div|pre) data-doc-body=""[^>]*>/.exec(markup)?.[0];
	if (!tag) throw new Error("DocFigure body opening tag was not rendered");
	return tag;
}

function figureOpeningTag(markup: string): string {
	const tag = /<figure data-doc-figure=""[^>]*>/.exec(markup)?.[0];
	if (!tag) throw new Error("DocFigure opening tag was not rendered");
	return tag;
}

function lineNumberOpeningTag(markup: string): string {
	const tag = /<td aria-hidden="true" data-doc-line-number=""[^>]*>/.exec(
		markup,
	)?.[0];
	if (!tag) throw new Error("DocFigure line-number cell was not rendered");
	return tag;
}

function renderedGutterSource(markup: string): string {
	const lines = [
		...markup.matchAll(
			/<td data-doc-source-line=""[^>]*>([\s\S]*?)<\/td>/g,
		),
	].map((match) =>
		decodeHtml(
			match[1]!
				.replace(/<!--[\s\S]*?-->/g, "")
				.replace(/<[^>]+>/g, ""),
		),
	);
	if (lines.length === 0) throw new Error("Gutter source lines were not rendered");
	return lines.join("\n");
}

function coloredSegmentCount(markup: string): number {
	return (
		markup.match(
			/<span class="text-syntax-(?:key|string|number|boolean)">/g,
		)?.length ?? 0
	);
}

describe("DocFigure", () => {
	test("renders a 100-plus-line XML-ish block byte-for-byte after dedent", () => {
		const expected = dedent(LARGE_STATE_BLOCK);
		expect(expected.split("\n").length).toBeGreaterThan(100);

		const markup = renderToStaticMarkup(
			<DocFigure
				caption="State"
				body={LARGE_STATE_BLOCK}
				language="xml"
				clamp={CLAMP.none}
				dedent
			/>,
		);

		expect(renderedBodyText(markup)).toBe(expected);
		expect(markup).toContain('data-doc-figure=""');
		expect(markup).toContain('data-doc-language="xml"');
		expect(markup).toContain(">State<");
		expect(markup).not.toContain("126 lines · 9,999 chars");
		expect(markup).toContain("text-syntax-key");
		expect(markup).toContain("text-syntax-number");
		expect(markup).toContain("text-syntax-string");
		expect(markup).toContain('data-doc-gutter=""');
	});

	test("SSR renders a realistic prompt on the shared prompt-source substrate", () => {
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="System prompt"
				body={REALISTIC_SYSTEM_PROMPT}
				language="prompt"
				clamp={CLAMP.none}
				gutter
			/>,
		);

		expect(markup).toContain('data-doc-language="prompt"');
		expect(markup).toContain(PROMPT_EDITOR_ROOT_CLASS);
		expect(markup).toContain("prompt-editor-row");
		expect(markup).toContain(
			"rgb(var(--zebra-color) / var(--zebra-opacity))",
		);
		expect(markup).toContain("var(--doc-figure-token-zebra, color-mix(");
		expect(markup).toContain("rgb(255 255 255 / 0.025)");
		expect(markup).toContain('data-doc-line-number=""');
		expect(markup).toContain('data-doc-source-line=""');
		expect(markup).toContain("select-none");
		expect(markup).toContain("user-select:none");
		expect(markup).toContain(
			`min-width:${promptEditorGutterWidth("4ch")}`,
		);
		expect(markup).toContain(EDITOR_COLORS.syntaxTag);
		expect(renderedGutterSource(markup)).toBe(REALISTIC_SYSTEM_PROMPT);
		for (const tagName of [
			"purpose",
			"board_model",
			"state_grammar",
			"workflow",
		]) {
			expect(markup).toContain(
				`<span style="color:${EDITOR_COLORS.syntaxTag};font-weight:500">${tagName}</span>`,
			);
		}
	});

	test("scales the prompt-source gutter beyond 99 lines without source filler", () => {
		const source = Array.from(
			{ length: 120 },
			(_, index) => (index === 60 ? "" : `<line n="${index + 1}"/>`),
		).join("\n");
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="Context"
				body={source}
				language="prompt"
				clamp={CLAMP.none}
				dedent={false}
				gutter
			/>,
		);

		expect(markup.match(/data-doc-line-number=""/g)?.length).toBe(120);
		expect(markup).toContain(
			`min-width:${promptEditorGutterWidth("5ch")}`,
		);
		expect(markup).toContain(`height:${EDITOR_METRICS.lineHeight}`);
		expect(renderedGutterSource(markup)).toBe(source);
	});

	test("keeps the sticky gutter opaque and stacked above scrolling source", () => {
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="State"
				body={`first\n${"x".repeat(471)}`}
				language="text"
				clamp={CLAMP.none}
			/>,
		);
		const gutter = lineNumberOpeningTag(markup);

		expect(gutter).toContain("sticky");
		expect(gutter).toContain("z-10");
		expect(gutter).toContain(
			"bg-[var(--prompt-editor-bg,var(--editor-bg))]",
		);
		expect(gutter).toContain(`background-color:${EDITOR_COLORS.bg}`);
		expect(gutter).toContain(
			"linear-gradient(var(--prompt-editor-row-zebra, transparent)",
		);
		expect(gutter).not.toContain("background:transparent");
	});

	test("SSR emits syntax-colored spans for XML", () => {
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="State"
				body={'<state v="21"><board elements="3"/></state>'}
				language="xml"
				clamp={CLAMP.none}
			/>,
		);

		expect(markup).toContain('data-doc-language="xml"');
		expect(markup).toContain(
			'<span class="text-syntax-key">state</span>',
		);
		expect(markup).toContain(
			'<span class="text-syntax-number">v</span>',
		);
		expect(markup).toContain(
			'<span class="text-syntax-string">&quot;21&quot;</span>',
		);
		expect(coloredSegmentCount(markup)).toBeGreaterThan(0);
	});

	test("SSR emits syntax-colored spans for JSON", () => {
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="Input"
				body={'{"stickyId":"s-1","x":42,"locked":false}'}
				language="json"
				clamp={CLAMP.none}
			/>,
		);

		expect(markup).toContain('data-doc-language="json"');
		expect(markup).toContain(
			'<span class="text-syntax-key">&quot;stickyId&quot;</span>',
		);
		expect(markup).toContain(
			'<span class="text-syntax-string">&quot;s-1&quot;</span>',
		);
		expect(markup).toContain(
			'<span class="text-syntax-number">42</span>',
		);
		expect(markup).toContain(
			'<span class="text-syntax-boolean">false</span>',
		);
		expect(coloredSegmentCount(markup)).toBeGreaterThan(0);
	});

	test("always renders byte-exact unwrapped source", () => {
		const source = "  first\n    second";
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="Rendered context"
				body={source}
				dedent={false}
			/>,
		);

		expect(renderedBodyText(markup)).toBe(source);
		expect(bodyOpeningTag(markup)).toContain("whitespace-pre");
		expect(bodyOpeningTag(markup)).not.toContain(
			["whitespace", "pre-wrap"].join("-"),
		);
		expect(markup).not.toContain("data-wrap-toggle");
		expect(markup).not.toContain(">Byte-exact<");
	});

	test("uses the gutter by default and permits an explicit non-source opt-out", () => {
		const defaultMarkup = renderToStaticMarkup(
			<DocFigure
				caption="Result"
				body={'{"ok":true}'}
				language="json"
				clamp={CLAMP.none}
			/>,
		);
		const optedOutMarkup = renderToStaticMarkup(
			<DocFigure
				caption="Non-source"
				body="decorative label"
				gutter={false}
				clamp={CLAMP.none}
			/>,
		);

		expect(defaultMarkup).toContain('data-doc-gutter=""');
		expect(defaultMarkup).toContain('data-doc-line-number=""');
		expect(optedOutMarkup).not.toContain('data-doc-gutter=""');
		expect(optedOutMarkup).toContain("<pre");
	});

	test("contains a 471-character source line without widening or clamping", () => {
		const longLine = `<state note="${"x".repeat(455)}"/>`;
		expect(longLine.length).toBe(471);
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="State"
				body={longLine}
				language="xml"
				clamp={CLAMP.tight}
				onOpenModal={() => {}}
			/>,
		);

		expect(renderedBodyText(markup)).toBe(longLine);
		expect(bodyOpeningTag(markup)).toContain("overflow-x-auto");
		expect(figureOpeningTag(markup)).not.toContain("overflow-hidden");
		expect(markup).toContain("min-w-0");
		expect(markup).toContain("max-w-full");
		expect(markup).not.toContain("data-clamped");
		expect(markup).not.toContain("data-detail-modal-trigger");
	});

	test("keeps caption top-right expand-only with a 24px control", () => {
		const body = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join(
			"\n",
		);
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="System prompt"
				body={body}
				language="prompt"
				clamp={CLAMP.tight}
				onOpenModal={() => {}}
			/>,
		);

		expect(DocFigureCaption).toBe(SECTION_LABEL_CLASS);
		expect(markup).toContain(SECTION_LABEL_CLASS);
		expect(markup).toContain("System prompt");
		expect(markup).not.toContain("303 lines · 18,531 chars");
		expect(markup).not.toContain(">Open<");
		expect(markup).toContain('data-clamped="true"');
		expect(markup).toContain('data-detail-modal-trigger=""');
		expect(markup).toContain('aria-label="Expand System prompt"');
		expect(markup).toContain("size-6");
		expect(markup).toContain("hover:bg-muted/40");
		expect(markup).toContain("focus-visible:ring-1");
		expect(markup).toContain("⤢");
		expect(markup).not.toContain(["Open", "in modal"].join(" "));

		const caption = /<figcaption[\s\S]*?<\/figcaption>/.exec(markup)?.[0];
		if (!caption) throw new Error("DocFigure caption was not rendered");
		expect(caption.match(/<button\b/g)?.length).toBe(1);
		expect(caption).not.toMatch(/\b(?:line|lines|char|chars)\b/);
	});

	test("defaults captions to the promoted top tier and supports a quieter subordinate tier", () => {
		const topMarkup = renderToStaticMarkup(
			<DocFigure caption="Call" body="top" clamp={CLAMP.none} />,
		);
		const subordinateMarkup = renderToStaticMarkup(
			<DocFigure
				caption="Tool call"
				captionTier="subordinate"
				body="nested"
				clamp={CLAMP.none}
			/>,
		);

		expect(DocFigureCaption).toBe(SECTION_LABEL_CLASS);
		expect(DocFigureSubordinateCaption).toBe(
			SUBORDINATE_SECTION_LABEL_CLASS,
		);
		expect(SECTION_LABEL_CLASS).toContain("text-[11px]");
		expect(SECTION_LABEL_CLASS).toContain("font-semibold");
		// Subordinate, not faint: brightened a step on review so the inner cards
		// separate, while staying smaller and lighter than the top tier.
		expect(SUBORDINATE_SECTION_LABEL_CLASS).toContain("text-[10px]");
		expect(SUBORDINATE_SECTION_LABEL_CLASS).toContain("font-medium");
		expect(SUBORDINATE_SECTION_LABEL_CLASS).toContain("text-muted-foreground");
		expect(SUBORDINATE_SECTION_LABEL_CLASS).not.toContain(
			"text-muted-foreground/",
		);
		// …and its frame reads a step brighter than the top tier's hairline.
		expect(subordinateMarkup).toContain("border-border");
		expect(subordinateMarkup).not.toContain("border-border/60");
		expect(topMarkup).toContain("border-border/60");
		expect(topMarkup).toContain('data-doc-caption-tier="top"');
		expect(topMarkup).toContain(`class="${SECTION_LABEL_CLASS}"`);
		expect(subordinateMarkup).toContain(
			'data-doc-caption-tier="subordinate"',
		);
		expect(subordinateMarkup).toContain(
			`class="${SUBORDINATE_SECTION_LABEL_CLASS}"`,
		);
		expect(subordinateMarkup).not.toContain(
			`class="${SECTION_LABEL_CLASS}"`,
		);
	});
});

describe("DocFigure scroll window", () => {
	const body = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

	test("windows the whole body instead of clamping a preview of it", () => {
		const markup = renderToStaticMarkup(
			<DocFigure caption="State" body={body} clamp={CLAMP.scroll} />,
		);
		// Nothing is withheld: every line renders, with no fade and no clamp box.
		expect(markup).not.toContain("data-clamped");
		expect([...markup.matchAll(/data-doc-line-number=""/g)]).toHaveLength(200);
		// The window lives on the element that already scrolls horizontally.
		expect(markup).toContain('data-doc-scroll=""');
		expect(markup).toContain("overflow-x-auto");
		expect(markup).toContain("overflow-y-auto");
		expect(markup).toContain("max-height:min(70vh, 900px)");
	});

	test("the caption keeps its ⤢ modal — the window is not the escape hatch", () => {
		const markup = renderToStaticMarkup(
			<DocFigure
				caption="State"
				body={body}
				clamp={CLAMP.scroll}
				onOpenModal={() => {}}
			/>,
		);
		expect(markup).toContain("data-detail-modal-trigger");
		expect(markup).toContain('aria-label="Expand State"');
	});

	test("content that fits needs no window at all", () => {
		const markup = renderToStaticMarkup(
			<DocFigure caption="State" body="one\ntwo" clamp={CLAMP.scroll} />,
		);
		expect(markup).not.toContain("data-doc-scroll");
		expect(markup).not.toContain("data-clamped");
	});

	test("the other policies still clamp to a fading preview", () => {
		const markup = renderToStaticMarkup(
			<DocFigure caption="Context" body={body} clamp={CLAMP.tall} />,
		);
		expect(markup).toContain('data-clamped="true"');
		expect(markup).not.toContain("data-doc-scroll");
	});
});
