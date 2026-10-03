/**
 * Clamped.test — server-rendering coverage for the shared height disclosure.
 *
 * The tests pin the critical contract that clamping is purely visual: long
 * content remains complete in collapsed markup, while modal chrome remains a
 * figure/shell concern and long unwrapped lines do not inflate vertical height.
 * For wrapping content, a measured height decides once it is known.
 */
import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Clamped } from "./Clamped";
import { CLAMP } from "./clamp";

/** One paragraph, no line breaks: the panel soft-wraps it into many lines. */
const PARAGRAPH = `${"a long single-paragraph message ".repeat(60)}END`;
const MANY_LINES = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
	"\n",
);

describe("Clamped", () => {
	test.each([
		["clamps one soft-wrapped paragraph rendered past its budget", PARAGRAPH, 900, true],
		["leaves a paragraph rendered within its budget open", PARAGRAPH, 300, false],
		["leaves a sub-pixel overshoot open", PARAGRAPH, 420.5, false],
		["clamps many line breaks before layout, as before", MANY_LINES, null, true],
	] as const)("%s", (_case, body, renderedHeightPx, clamped) => {
		const markup = renderToStaticMarkup(
			<Clamped
				policy={CLAMP.block}
				lineCount={body.split("\n").length}
				charCount={body.length}
				renderedHeightPx={renderedHeightPx}
				measureRef={createRef<HTMLDivElement>()}
			>
				<p>{body}</p>
			</Clamped>,
		);

		expect(markup.includes('data-clamped="true"')).toBe(clamped);
		expect(markup).toContain(body);
	});

	test("keeps the full content in collapsed SSR markup", () => {
		const fullContent = [
			"START-OF-SOURCE",
			...Array.from({ length: 98 }, (_, index) => `line ${index + 2}`),
			"END-OF-SOURCE",
		].join("\n");
		const markup = renderToStaticMarkup(
			<Clamped
				policy={CLAMP.block}
				lineCount={100}
				charCount={fullContent.length}
			>
				<pre>{fullContent}</pre>
			</Clamped>,
		);

		expect(markup).toContain('data-clamped="true"');
		expect(markup).toContain("max-height:420px");
		expect(markup).toContain("START-OF-SOURCE");
		expect(markup).toContain("line 75");
		expect(markup).toContain("END-OF-SOURCE");
		expect(markup).not.toContain(["Open", "in modal"].join(" "));
		expect(markup).not.toContain("data-detail-modal-trigger");
		expect(markup).not.toContain("Show all");
	});

	test("renders the complete never-clamped state without a wrapper or toggle", () => {
		const fullContent = `${"expanded-content\n".repeat(200)}FINAL-SENTINEL`;
		const markup = renderToStaticMarkup(
			<Clamped
				policy={CLAMP.none}
				lineCount={201}
				charCount={fullContent.length}
			>
				<pre>{fullContent}</pre>
			</Clamped>,
		);

		expect(markup).toContain("expanded-content");
		expect(markup).toContain("FINAL-SENTINEL");
		expect(markup).not.toContain("data-clamped");
		expect(markup).not.toContain("<button");
		expect(markup).not.toContain("max-height");
	});

	test("does not add disclosure chrome when content is too short to clamp", () => {
		const markup = renderToStaticMarkup(
			<Clamped
				policy={CLAMP.tight}
				lineCount={2}
				charCount={11}
			>
				<span>hello{"\n"}world</span>
			</Clamped>,
		);

		expect(markup).toContain("hello");
		expect(markup).toContain("world");
		expect(markup).not.toContain("data-clamped");
		expect(markup).not.toContain("<button");
	});

	test("does not clamp one pathological source line because it scrolls horizontally", () => {
		const content = "x".repeat(1_000);
		const markup = renderToStaticMarkup(
			<Clamped
				policy={CLAMP.tight}
				lineCount={1}
				charCount={content.length}
			>
				<span>{content}</span>
			</Clamped>,
		);

		expect(markup).not.toContain("data-clamped");
		expect(markup).not.toContain("<button");
		expect(markup).toContain(content);
	});
});
