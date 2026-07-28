/**
 * DetailsView.test.tsx — SSR coverage for the metadata and raw views being
 * retained in the header-toggled full-panel details takeover.
 *
 * The fixture intentionally exercises every TraceSpan top-level field, every
 * supported attribute scalar, usage grouping, and a prompt-shaped multiline
 * value so losing information is visible as a focused regression.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailsView } from "./DetailsView";

const MULTILINE_OUTPUT = [
	"RAW_BLOCK_LINE_ONE_" + "x".repeat(9_415),
	"RAW_BLOCK_LINE_TWO_" + "y".repeat(9_415),
	"RAW_BLOCK_LINE_THREE",
].join("\n");

function fixture(): TraceSpan {
	return {
		id: "span-full-coverage",
		title: "Full coverage span",
		startTime: new Date("2026-07-27T14:03:04.000Z"),
		endTime: new Date("2026-07-27T14:04:09.000Z"),
		duration: 65_000,
		type: "tool_execution",
		raw: '{"source":"collector"}',
		status: "warning",
		input: "the input",
		output: MULTILINE_OUTPUT,
		cost: 12.5,
		tokensCount: 12_345,
		metadata: { nested: "metadata-value" },
		attributes: [
			{ key: "event_type", value: { stringValue: "tool_call_end" } },
			{ key: "tool_name", value: { stringValue: "research" } },
			{
				key: "prompt_hash",
				value: {
					stringValue:
						"prompt:0123456789abcdef0123456789abcdef0123456789abcdef",
				},
			},
			{ key: "attempt", value: { intValue: "1234567" } },
			{ key: "cache_hit", value: { boolValue: false } },
			{ key: "input_tokens", value: { intValue: "1234567" } },
			{ key: "output_tokens", value: { intValue: "2345678" } },
			{ key: "cache_read_tokens", value: { intValue: "3456789" } },
			{ key: "cache_write_tokens", value: { intValue: "4567890" } },
			{ key: "cost_estimate", value: { intValue: "1234.5" } },
			{ key: "model", value: { stringValue: "model-with-context" } },
			{ key: "stop_reason", value: { stringValue: "tool_use" } },
		],
		children: [
			{
				id: "child-not-in-raw",
				title: "Child",
				startTime: new Date("2026-07-27T14:03:04.000Z"),
				endTime: new Date("2026-07-27T14:03:04.000Z"),
				duration: 0,
				type: "event",
				raw: "{}",
				status: "success",
			},
		],
	};
}

function renderDetails(span = fixture()): string {
	return renderToStaticMarkup(createElement(DetailsView, { span }));
}

function docSourceLines(markup: string): string[] {
	return [...markup.matchAll(/<td[^>]*data-doc-source-line=""[^>]*>(.*?)<\/td>/gs)]
		.map(([, inner]) => inner ?? "")
		.map((inner) =>
			inner
				.replace(/<[^>]+>/g, "")
				.replaceAll("&quot;", '"')
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")
				.replaceAll("&amp;", "&"),
		);
}

describe("DetailsView", () => {
	test("directly renders every retired Metadata field in the full-panel view", () => {
		const markup = renderDetails();

		expect(markup).toContain("data-details-view");
		expect(markup).not.toContain("data-details-drawer");
		expect(markup).not.toContain("ap-collapsible");

		for (const label of [
			"Start",
			"End",
			"Duration",
			"Type",
			"Status",
			"Tool",
			"Span ID",
		]) {
			expect(markup).toContain(`>${label}<`);
		}
		expect(markup).toContain("span-full-coverage");
		expect(markup).toContain("tool_execution");
		expect(markup).toContain(">1.1m<");
		expect(markup).toContain("warning");
		expect(markup).toContain("text-status-warning");
		expect(markup).toContain("research");
		expect(markup).toContain('aria-label="Copy event_type"');
		expect(markup).toContain(">tool_call_end<");

		// All three attribute value shapes survive; false must not fall through
		// to the old em-dash behavior.
		expect(markup).toContain("prompt:0123456789abcdef");
		expect(markup).toContain(">1234567<");
		expect(markup).toContain(">false<");
		expect(markup).toContain('aria-label="Copy prompt_hash"');
		expect(markup).toContain('aria-label="Copy attempt"');
		expect(markup).toContain('aria-label="Copy cache_hit"');
		expect(markup).toContain("break-all");
	});

	test("appends renderer-provided extras after the standard sections", () => {
		const markup = renderToStaticMarkup(
			createElement(DetailsView, {
				span: fixture(),
				extras: createElement(
					"section",
					{ "data-details-section": "references" },
					"Message references",
				),
			}),
		);

		expect(markup.indexOf('data-details-section="references"')).toBeGreaterThan(
			markup.indexOf('data-details-section="raw"'),
		);
		expect(markup).toContain("Message references");
	});

	test("shows all requested usage attributes with locale grouping", () => {
		const markup = renderDetails();

		expect(markup).toContain('data-details-section="usage"');
		expect(markup).toContain("Input tokens");
		expect(markup).toContain("1,234,567");
		expect(markup).toContain("Output tokens");
		expect(markup).toContain("2,345,678");
		expect(markup).toContain("Cache read tokens");
		expect(markup).toContain("3,456,789");
		expect(markup).toContain("Cache write tokens");
		expect(markup).toContain("4,567,890");
		expect(markup).toContain("Cost estimate");
		expect(markup).toContain("1,234.5");
		expect(markup).toContain("model-with-context");
		expect(markup).toContain("tool_use");
	});

	test("raw coverage includes every former RawTab top-level key except children", () => {
		const span = fixture();
		const { children: _children, ...rawSpan } = span;
		const markup = renderDetails(span);

		for (const key of Object.keys(rawSpan)) {
			expect(markup).toContain(`&quot;${key}&quot;`);
		}
		expect(markup).not.toContain("&quot;children&quot;");
		expect(markup).not.toContain("child-not-in-raw");
		expect(markup).toContain("metadata-value");
		expect(markup).toContain(">Copy JSON<");
		expect(markup).toContain("data-raw-record");
		expect(markup).toContain('data-doc-figure=""');
		expect(markup).toContain('data-doc-gutter=""');
		expect(markup).toContain('data-doc-language="json"');
	});

	test("promotes multiline raw strings to byte-identical unwrapped block lines", () => {
		const markup = renderDetails();
		const [first, second] = MULTILINE_OUTPUT.split("\n");

		expect(MULTILINE_OUTPUT.length).toBe(18_890);
		expect(markup).not.toContain(["whitespace", "pre-wrap"].join("-"));
		expect(markup).toContain(first!);
		expect(markup).toContain(second!);
		expect(markup.indexOf(first!)).toBeLessThan(markup.indexOf(second!));
		expect(markup).not.toContain(
			`${first}\\n${second}`,
		);
		expect(docSourceLines(markup).some((line) => line.trim() === '"""')).toBe(
			true,
		);
	});

	test("keeps the raw figure caption expand-only and Copy JSON in details chrome", () => {
		const markup = renderToStaticMarkup(
			createElement(DetailsView, {
				span: fixture(),
				onOpenModal: () => {},
			}),
		);
		const rawStart = markup.indexOf('data-details-section="raw"');
		const rawSection = markup.slice(rawStart);
		const captionRow =
			/<figcaption[\s\S]*?<\/figcaption>/.exec(rawSection)?.[0];
		if (!captionRow) throw new Error("Raw figure caption was not rendered");

		expect(captionRow).toContain(">Raw<");
		expect(captionRow).toContain('aria-label="Expand Raw"');
		expect(captionRow).toContain('data-detail-modal-trigger=""');
		expect(captionRow).toContain(">⤢<");
		expect(captionRow).not.toMatch(/\b(?:line|lines|char|chars)\b/);
		expect(captionRow).not.toContain("Copy JSON");
		expect(rawSection).toContain("Copy JSON");
		expect(rawSection).not.toContain(["Open", "in modal"].join(" "));
	});

	test("omits Usage when the span has no usage attributes", () => {
		const span = fixture();
		span.attributes = [
			{ key: "event_type", value: { stringValue: "tool_call_end" } },
		];

		expect(renderDetails(span)).not.toContain('data-details-section="usage"');
	});
});
