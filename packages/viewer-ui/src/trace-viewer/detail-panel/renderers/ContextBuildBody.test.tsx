import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailShell } from "../DetailShell";
import { CLAMP } from "../doc-figure/clamp";
import { ContextBuildBody } from "./ContextBuildBody";
import { PRIMARY_FIGURE_CLAMP } from "./primary-figure";
import { prettyJson } from "./json-document";

function span(overrides: Partial<TraceSpan> = {}): TraceSpan {
	return {
		id: "context-build",
		title: "context build",
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:00.010Z"),
		duration: 10,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [
			{ key: "event_type", value: { stringValue: "context_build_completed" } },
		],
		...overrides,
	};
}

function nodesMarkup(view: ReturnType<typeof ContextBuildBody>): string {
	return renderToStaticMarkup(
		<>
			{(view.blocks ?? []).map((block) => (
				<div key={block.id}>{block.node}</div>
			))}
		</>,
	);
}

describe("ContextBuildBody", () => {
	test("expresses declared, loaded, and rendered stages using standard blocks", () => {
		const declaredRaw = JSON.stringify([
			{ kind: "capabilities", ref: "capabilities" },
			{ kind: "project", ref: "style-guide" },
			{ kind: "memory", ref: "empty-memory" },
		]);
		const resolvedRaw = JSON.stringify([
			{
				loader_kind: "capabilities",
				input_ref: "capabilities",
				status: "ok",
				bytes: 11635,
				from_cache: false,
				content_hash: "content-hash",
			},
			{
				loader_kind: "project",
				input_ref: "style-guide",
				status: "error",
				bytes: 0,
			},
			{
				loader_kind: "memory",
				input_ref: "empty-memory",
				status: "empty",
				bytes: 0,
			},
		]);
		const contextSpan = span({
			input: declaredRaw,
			output: "<context><capabilities>ready</capabilities></context>",
			attributes: [
				{
					key: "event_type",
					value: { stringValue: "context_build_completed" },
				},
				{ key: "inputs_count", value: { intValue: "3" } },
				{ key: "total_bytes", value: { intValue: "11635" } },
				{
					key: "resolved_inputs",
					value: {
						stringValue: resolvedRaw,
					},
				},
				{ key: "prompt_hash", value: { stringValue: "prompt-hash" } },
				{ key: "from_cache", value: { boolValue: false } },
			],
		});
		const body = ContextBuildBody({ span: contextSpan });

		const blocks = body.blocks ?? [];
		expect(
			blocks.map(({ id, slot, order, caption }) => ({
				id,
				slot,
				order,
				caption,
			})),
		).toEqual([
			{
				id: "context:declared-inputs",
				slot: "input",
				order: 0,
				caption: "Declared inputs",
			},
			{
				id: "context:loaded-inputs",
				slot: "input",
				order: 10,
				caption: "Loaded",
			},
			{
				id: "context:rendered",
				slot: "content",
				order: undefined,
				caption: "Rendered context",
			},
		]);

		const rendered = blocks[2];
		expect(rendered?.body).toBe(
			"<context><capabilities>ready</capabilities></context>",
		);
		expect(rendered?.language).toBe("prompt");
		// The rendered context is this view's primary figure, so it reads the
		// same way as the Turn body's Context tab: a window, not a preview.
		expect(rendered?.clamp).toBe(PRIMARY_FIGURE_CLAMP);
		expect(rendered?.clamp?.windowed).toBe(true);
		expect(rendered?.expandable).toBe(true);
		expect(rendered?.collapsible).toBeUndefined();

		const declared = blocks[0];
		const loaded = blocks[1];
		// JSON lineage payloads render canonically pretty-printed: values exact,
		// whitespace canonical at a 2-space indent.
		expect(declared?.body).toBe(prettyJson(declaredRaw));
		expect(declared?.body).toContain('  {\n    "kind": "capabilities",');
		expect(JSON.parse(String(declared?.body))).toEqual(JSON.parse(declaredRaw));
		expect(declared?.language).toBe("json");
		expect(loaded?.body).toBe(prettyJson(resolvedRaw));
		expect(JSON.parse(String(loaded?.body))).toEqual(JSON.parse(resolvedRaw));
		expect(loaded?.language).toBe("json");

		const markup = renderToStaticMarkup(
			<DetailShell span={contextSpan} view={body} />,
		);
		// The normal body contains only its three payloads. The raw record lives
		// exclusively in the header-toggled full-panel Details view.
		expect(markup.match(/data-doc-figure=/g)?.length).toBe(3);
		expect(markup.match(/data-doc-gutter=/g)?.length).toBe(3);
		expect(markup).not.toContain("data-details-view");
		expect(markup).not.toContain("data-details-drawer");
		expect(markup).toContain("capabilities");
		expect(markup).toContain("style-guide");
		expect(markup).toContain("content-hash");
		expect(markup).toContain("from_cache");
		expect(markup).not.toContain("Context built · 3 inputs · 11.4 KB");
		expect(markup).not.toContain(">53 chars<");
	});

	test("collapses rendered context only when it exceeds the tall reading budget", () => {
		const output = Array.from(
			{ length: 100 },
			(_, index) => `<message index="${index}">context</message>`,
		).join("\n");
		const body = ContextBuildBody({ span: span({ output }) });
		const rendered = body.blocks?.find(
			(block) => block.id === "context:rendered",
		);

		expect(rendered?.collapsible).toBe(true);
		expect(rendered?.defaultOpen).toBe(false);
		expect("meta" in (rendered ?? {})).toBe(false);
	});

	test("uses the legacy count when per-input lineage is absent", () => {
		const body = ContextBuildBody({
			span: span({
				input: JSON.stringify([{ kind: "capabilities", ref: "capabilities" }]),
				output: "<context />",
				attributes: [
					{
						key: "event_type",
						value: { stringValue: "context_build_completed" },
					},
					{ key: "inputs_count", value: { intValue: "2" } },
					{ key: "total_bytes", value: { intValue: "16384" } },
				],
			}),
		});

		expect(
			"meta" in
				(body.blocks?.find((block) => block.id === "context:loaded-inputs") ??
					{}),
		).toBe(false);
		const markup = nodesMarkup(body);
		expect(markup).toContain(
			"2 inputs were loaded; per-input lineage was not recorded in this older trace.",
		);
		expect(markup).toContain('data-context-stage="loaded"');
	});

	test("does not expose malformed declared or lineage JSON as raw text", () => {
		const body = ContextBuildBody({
			span: span({
				input: '{"secret":"not-a-declared-input"}',
				output: "",
				attributes: [
					{
						key: "event_type",
						value: { stringValue: "context_build_started" },
					},
					{
						key: "resolved_inputs",
						value: { stringValue: '{"secret":"not-lineage"}' },
					},
				],
			}),
		});
		const markup = nodesMarkup(body);

		expect(
			"meta" in
				(body.blocks?.find((block) => block.id === "context:loaded-inputs") ??
					{}),
		).toBe(false);
		expect(markup).toContain("Declared input details were not recorded.");
		expect(markup).toContain(
			"Per-input lineage was not recorded in this older trace.",
		);
		expect(markup).not.toContain("secret");
	});
});
