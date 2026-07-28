import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailBlocksProvider } from "../blocks";
import type { DetailView } from "../contract";
import { DetailShell } from "../DetailShell";
import { CLAMP } from "../doc-figure/clamp";
import {
	SECTION_LABEL_CLASS,
	SUBORDINATE_SECTION_LABEL_CLASS,
} from "../section-label";
import { prettyJson } from "./json-document";
import { ToolBody } from "./ToolBody";

const UPDATE_STICKY_INPUT = JSON.stringify({
	raw: {
		stickyId: "sticky-memory-bank",
		patch: {
			geometry: {
				x: 3968,
				y: 864,
				width: 544,
				height: 336,
			},
		},
		view: "section-memory-bank",
	},
});

function toolSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
	return {
		id: "tool-1",
		title: "update_sticky",
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:00.412Z"),
		duration: 412,
		type: "tool_execution",
		raw: "{}",
		status: "success",
		input: UPDATE_STICKY_INPUT,
		output: "APPLIED · update_sticky sticky-memory-bank",
		attributes: [
			{ key: "event_type", value: { stringValue: "tool_call_start" } },
			{ key: "tool_name", value: { stringValue: "update_sticky" } },
		],
		...overrides,
	};
}

type UntabbedDetailView = DetailView & {
	blocks: NonNullable<DetailView["blocks"]>;
};

function captureView(span: TraceSpan): UntabbedDetailView {
	const capture: { current: DetailView | null } = { current: null };

	function Capture(): ReactNode {
		capture.current = ToolBody({ span });
		return null;
	}

	renderToStaticMarkup(<Capture />);
	if (capture.current === null) throw new Error("ToolBody did not render");
	if (capture.current.blocks === undefined) {
		throw new Error("ToolBody must return an untabbed view");
	}
	return capture.current as UntabbedDetailView;
}

function detailBlockIds(markup: string): string[] {
	return [...markup.matchAll(/data-detail-block="([^"]+)"/g)].map(
		([, id]) => id!,
	);
}

describe("ToolBody", () => {
	test("keeps canvas thinking and program blocks before call input", () => {
		function RenderedTool() {
			const span = toolSpan();
			return <DetailShell span={span} view={ToolBody({ span })} />;
		}

		const markup = renderToStaticMarkup(
			<DetailBlocksProvider
				provider={() => [
					{
						id: "canvas:thinking",
						slot: "input",
						order: -100,
						caption: "Thinking",
						body: "reasoning",
					},
					{
						id: "canvas:program",
						slot: "input",
						order: -50,
						caption: "Program",
						body: "operation plan",
					},
					{
						id: "canvas:renders",
						slot: "media",
						caption: "Renders",
						node: "render thumbnails",
					},
				]}
			>
				<RenderedTool />
			</DetailBlocksProvider>,
		);

		expect(detailBlockIds(markup)).toEqual([
			"canvas:thinking",
			"canvas:program",
			"tool:call",
			"tool:result",
			"canvas:renders",
		]);
		// Source blocks expose their default tier directly. The node-backed Renders
		// extension uses NodeFigure, whose caption consumes the same top-tier class.
		expect(markup.match(/data-doc-caption-tier="top"/g)).toHaveLength(4);
		expect(markup).not.toContain('data-doc-caption-tier="subordinate"');
		for (const caption of ["Thinking", "Program", "Call", "Result", "Renders"]) {
			expect(markup).toContain(
				`class="${SECTION_LABEL_CLASS}">${caption}</span>`,
			);
		}
		expect(markup).not.toContain(SUBORDINATE_SECTION_LABEL_CLASS);
		expect(captureView(toolSpan()).blocks[0]?.order).toBe(10);
	});

	test("renders the real update_sticky arguments as pretty-printed colorized JSON", () => {
		const view = captureView(toolSpan());
		const call = view.blocks.find((block) => block.id === "tool:call");
		expect(call?.slot).toBe("input");
		expect(call?.caption).toBe("Call");
		expect(call).not.toHaveProperty("node");
		expect(call?.language).toBe("json");
		// The provider serializes arguments minified; the call block canonicalizes
		// whitespace to 2-space indent while every value stays exact.
		expect(UPDATE_STICKY_INPUT).not.toContain("\n");
		expect(call?.body).toBe(prettyJson(UPDATE_STICKY_INPUT));
		expect(call?.body?.split("\n").length).toBeGreaterThan(1);
		expect(call?.body).toContain('  "raw": {');
		expect(call?.body).toContain('    "stickyId": "sticky-memory-bank"');
		expect(JSON.parse(call?.body ?? "")).toEqual(JSON.parse(UPDATE_STICKY_INPUT));
		expect(
			Object.keys(
				(JSON.parse(call?.body ?? "") as { raw: Record<string, unknown> }).raw,
			),
		).toEqual(["stickyId", "patch", "view"]);

		function RenderedTool() {
			const span = toolSpan();
			return <DetailShell span={span} view={ToolBody({ span })} />;
		}
		const markup = renderToStaticMarkup(<RenderedTool />);
		const callStart = markup.indexOf('data-detail-block="tool:call"');
		const resultStart = markup.indexOf('data-detail-block="tool:result"');
		const callMarkup = markup.slice(callStart, resultStart);
		expect(callMarkup).toContain('data-doc-language="json"');
		expect(callMarkup).toContain("text-syntax-key");
		expect(callMarkup).toContain("text-syntax-string");
		expect(callMarkup).toContain("text-syntax-number");
		expect(callMarkup).not.toContain('data-tool-argument="');
	});

	test("keeps arrays and long strings in the single JSON call document", () => {
		const longText = "x".repeat(200);
		const input = JSON.stringify({
			raw: {
				tags: ["alpha", "beta"],
				instruction: longText,
			},
		});
		const view = captureView(
			toolSpan({
				input,
			}),
		);
		const call = view.blocks[0];

		expect(call).not.toHaveProperty("node");
		expect(call?.language).toBe("json");
		expect(call?.body).toBe(prettyJson(input));
		expect(call?.body).toContain('"tags": [\n      "alpha",\n      "beta"\n    ]');
		expect(call?.body).toContain(`"instruction": "${longText}"`);
	});

	test("falls back to an unmodified text document when call input is not JSON", () => {
		const input = "{ malformed input";
		const view = captureView(toolSpan({ input }));

		expect(view.blocks[0]).toMatchObject({
			id: "tool:call",
			body: input,
			language: "text",
			clamp: CLAMP.block,
		});
		expect(view.blocks[0]).not.toHaveProperty("node");
	});

	test("emits one Result block and preserves the result text exactly once in the body view", () => {
		const result = "RESULT_ONCE_SENTINEL";
		const view = captureView(toolSpan({ output: result }));
		const resultBlocks = view.blocks.filter(
			(block) => block.id === "tool:result",
		);

		expect(resultBlocks).toHaveLength(1);
		expect(resultBlocks[0]).toMatchObject({
			slot: "output",
			caption: "Result",
			body: result,
			language: "text",
			clamp: CLAMP.block,
		});
		const bodyMarkup = renderToStaticMarkup(
			<>
				{view.blocks.map((block) => (
					<div key={block.id}>{block.body ?? block.node}</div>
				))}
			</>,
		);
		expect(bodyMarkup.match(new RegExp(result, "g"))).toHaveLength(1);
	});

	test("pretty-prints a parseable result document without changing its values", () => {
		const output = '{"ok":true,"count":2}';
		const result = captureView(toolSpan({ output })).blocks.find(
			(block) => block.id === "tool:result",
		);

		expect(result).toMatchObject({
			body: '{\n  "ok": true,\n  "count": 2\n}',
			language: "json",
		});
		expect(JSON.parse(String(result?.body))).toEqual(JSON.parse(output));
		expect(result).not.toHaveProperty("node");
	});

	test("leaves a non-JSON result byte-exact", () => {
		const output = "APPLIED · update_sticky sticky-memory-bank";
		const result = captureView(toolSpan({ output })).blocks.find(
			(block) => block.id === "tool:result",
		);

		expect(result).toMatchObject({ body: output, language: "text" });
	});

	test("leaves destructive result styling to the shell", () => {
		const view = captureView(
			toolSpan({
				title: "finalize",
				status: "error",
				attributes: [
					{ key: "event_type", value: { stringValue: "tool_call_end" } },
					{ key: "tool_name", value: { stringValue: "finalize" } },
				],
			}),
		);

		expect(view.blocks.find((block) => block.slot === "output")).not.toHaveProperty(
			"node",
		);
	});

	test("emits an explicit outcome output block when the result is missing or blank", () => {
		for (const output of [undefined, "", "   "]) {
			const view = captureView(
				toolSpan({
					input: undefined,
					output,
				}),
			);

			expect(view.blocks).toHaveLength(1);
			expect(view.blocks[0]).toMatchObject({
				id: "tool:outcome",
				slot: "output",
				caption: "Outcome",
				body: "update_sticky → applied",
				language: "text",
				clamp: CLAMP.tight,
				expandable: false,
			});
		}

		const span = toolSpan({ input: undefined, output: undefined });
		const markup = renderToStaticMarkup(
			<DetailShell span={span} view={ToolBody({ span })} />,
		);
		expect(markup).toContain('data-doc-caption-tier="top"');
		expect(markup).toContain(
			`class="${SECTION_LABEL_CLASS}">Outcome</span>`,
		);
		expect(markup).not.toContain('data-doc-caption-tier="subordinate"');
		expect(markup).not.toContain(SUBORDINATE_SECTION_LABEL_CLASS);
	});

	test("keeps an error outcome visible when an unpaired call has no result", () => {
		const view = captureView(
			toolSpan({
				status: "error",
				output: undefined,
			}),
		);

		expect(view.blocks.find((block) => block.id === "tool:outcome")).toMatchObject({
			slot: "output",
			caption: "Outcome",
			body: "update_sticky → error",
		});
	});
});
