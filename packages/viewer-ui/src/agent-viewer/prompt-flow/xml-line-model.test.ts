import { describe, expect, it } from "bun:test";
import type { PromptBlockNode, PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	ensurePromptNodeIds,
	PROMPT_KIT_SCHEMA_VERSION,
	renderXmlMarkdown,
} from "@codecaine-ai/prompt-kit";

import { buildXmlLineModel } from "./xml-line-model";

function doc(nodes: PromptBlockNode[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "test-doc",
		nodes,
	};
}

function linesToString(prompt: PromptDocument): string {
	return buildXmlLineModel(prompt)
		.lines.map((line) => line.text)
		.join("\n");
}

/**
 * The whole contract: the editor's per-line model must concatenate to exactly
 * what the read-only Raw view renders. If these diverge, line numbers stop
 * tracking Raw and the "toggle editability" illusion breaks.
 */
function expectMatchesRenderer(nodes: PromptBlockNode[]) {
	const prompt = ensurePromptNodeIds(doc(nodes));
	expect(linesToString(prompt)).toBe(renderXmlMarkdown(prompt));
}

describe("buildXmlLineModel", () => {
	it("matches the renderer for a flat document with blank separators", () => {
		expectMatchesRenderer([
			{ type: "paragraph", content: ["First paragraph."] },
			{ type: "paragraph", content: ["Second paragraph."] },
		]);
	});

	it("matches the renderer for nested sections", () => {
		expectMatchesRenderer([
			{
				type: "section",
				tag: "purpose",
				children: [
					{ type: "paragraph", content: ["You are an agent."] },
					{
						type: "section",
						tag: "rules",
						children: [{ type: "paragraph", content: ["Be precise."] }],
					},
				],
			},
			{
				type: "section",
				tag: "process",
				children: [
					{
						type: "orderedList",
						items: [
							{ type: "listItem", content: ["Read."] },
							{ type: "listItem", content: ["Write."] },
						],
					},
				],
			},
		]);
	});

	it("matches the renderer for lists, fields, code, raw, example, context", () => {
		expectMatchesRenderer([
			{
				type: "bulletList",
				items: [
					{ type: "listItem", content: ["Alpha"] },
					{ type: "listItem", content: ["Beta"] },
				],
			},
			{ type: "field", label: "Model", value: ["opus"] },
			{
				type: "codeBlock",
				language: "ts",
				code: "const x = 1;\n\nconst y = 2;",
			},
			{ type: "raw", value: "line one\nline two" },
			{
				type: "example",
				title: "Sample",
				children: [{ type: "paragraph", content: ["Body."] }],
			},
			{
				type: "contextUsage",
				contextId: "researchContext",
				instructions: [{ type: "paragraph", content: ["Use it."] }],
			},
		]);
	});

	it("matches the renderer for an empty section", () => {
		expectMatchesRenderer([{ type: "section", tag: "empty", children: [] }]);
	});

	it("matches the renderer for list items with children", () => {
		expectMatchesRenderer([
			{
				type: "orderedList",
				items: [
					{
						type: "listItem",
						content: ["Parent step"],
						children: [{ type: "paragraph", content: ["Detail paragraph."] }],
					},
					{ type: "listItem", content: ["Next step"] },
				],
			},
		]);
	});

	it("tags line roles and editability", () => {
		const prompt = ensurePromptNodeIds(
			doc([
				{
					type: "section",
					tag: "purpose",
					children: [{ type: "paragraph", content: ["Hi."] }],
				},
			]),
		);
		const { lines } = buildXmlLineModel(prompt);
		expect(lines.map((line) => line.role)).toEqual(["open", "content", "close"]);
		expect(lines[1]?.editable).toBe(true);
		expect(lines[0]?.editable).toBe(false);
		expect(lines[2]?.editable).toBe(false);
	});
});
