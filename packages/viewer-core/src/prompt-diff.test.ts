import { describe, expect, test } from "bun:test";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";

import { diffPromptDocuments } from "./prompt-diff";

function doc(nodes: PromptDocument["nodes"]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "test-prompt",
		nodes,
	};
}

const paragraph = (id: string, text: string) => ({
	type: "paragraph" as const,
	id,
	content: [text],
});

const section = (
	id: string,
	tag: string,
	children: PromptDocument["nodes"],
) => ({
	type: "section" as const,
	id,
	tag,
	children,
});

describe("diffPromptDocuments", () => {
	test("identical documents produce no entries", () => {
		const a = doc([
			section("s1", "role", [paragraph("p1", "You are a researcher.")]),
			paragraph("p2", "Be brief."),
		]);
		const b = doc([
			section("s1", "role", [paragraph("p1", "You are a researcher.")]),
			paragraph("p2", "Be brief."),
		]);
		expect(diffPromptDocuments(a, b)).toEqual([]);
	});

	test("classifies an inserted node", () => {
		const a = doc([paragraph("p1", "one")]);
		const b = doc([paragraph("p1", "one"), paragraph("p2", "two")]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "inserted",
			id: "p2",
			nodeType: "paragraph",
			pathInB: "nodes.1",
		});
		expect(entries[0]?.pathInA).toBeUndefined();
	});

	test("classifies a removed node", () => {
		const a = doc([paragraph("p1", "one"), paragraph("p2", "two")]);
		const b = doc([paragraph("p1", "one")]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "removed",
			id: "p2",
			pathInA: "nodes.1",
		});
		expect(entries[0]?.pathInB).toBeUndefined();
	});

	test("classifies an edited node via canonical content minus children", () => {
		const a = doc([section("s1", "role", [paragraph("p1", "old text")])]);
		const b = doc([section("s1", "role", [paragraph("p1", "new text")])]);
		const entries = diffPromptDocuments(a, b);
		// Only the paragraph changed; the section's own content (tag) did not.
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: "edited", id: "p1" });
	});

	test("a section tag change edits the section, not its children", () => {
		const a = doc([section("s1", "role", [paragraph("p1", "same")])]);
		const b = doc([section("s1", "identity", [paragraph("p1", "same")])]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "edited",
			id: "s1",
			label: "<identity>",
		});
	});

	test("reordering siblings marks moved nodes, keyed by common-sibling order", () => {
		const a = doc([
			paragraph("p1", "one"),
			paragraph("p2", "two"),
			paragraph("p3", "three"),
		]);
		const b = doc([
			paragraph("p2", "two"),
			paragraph("p1", "one"),
			paragraph("p3", "three"),
		]);
		const entries = diffPromptDocuments(a, b);
		const movedIds = entries
			.filter((entry) => entry.kind === "moved")
			.map((entry) => entry.id)
			.sort();
		expect(movedIds).toEqual(["p1", "p2"]);
		expect(entries.every((entry) => entry.kind === "moved")).toBe(true);
	});

	test("an insertion does not cascade moved onto shifted siblings", () => {
		const a = doc([paragraph("p1", "one"), paragraph("p2", "two")]);
		const b = doc([
			paragraph("p0", "zero"),
			paragraph("p1", "one"),
			paragraph("p2", "two"),
		]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: "inserted", id: "p0" });
	});

	test("a removal does not cascade moved onto shifted siblings", () => {
		const a = doc([
			paragraph("p1", "one"),
			paragraph("p2", "two"),
			paragraph("p3", "three"),
		]);
		const b = doc([paragraph("p1", "one"), paragraph("p3", "three")]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: "removed", id: "p2" });
	});

	test("reparenting a node is a move", () => {
		const a = doc([
			section("s1", "role", [paragraph("p1", "text")]),
			section("s2", "rules", []),
		]);
		const b = doc([
			section("s1", "role", []),
			section("s2", "rules", [paragraph("p1", "text")]),
		]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "moved",
			id: "p1",
			pathInA: "nodes.0.children.0",
			pathInB: "nodes.1.children.0",
		});
	});

	test("a node that moved and changed content yields both entries", () => {
		const a = doc([paragraph("p1", "one"), paragraph("p2", "old")]);
		const b = doc([paragraph("p2", "new"), paragraph("p1", "one")]);
		const entries = diffPromptDocuments(a, b);
		const forP2 = entries.filter((entry) => entry.id === "p2");
		expect(forP2.map((entry) => entry.kind).sort()).toEqual([
			"edited",
			"moved",
		]);
	});

	test("list item edits surface as the list node being edited", () => {
		const a = doc([
			{
				type: "bulletList",
				id: "list1",
				items: [{ type: "listItem", id: "i1", content: ["old item"] }],
			},
		]);
		const b = doc([
			{
				type: "bulletList",
				id: "list1",
				items: [{ type: "listItem", id: "i1", content: ["new item"] }],
			},
		]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: "edited", id: "list1" });
	});

	test("nodes without ids are ignored", () => {
		const a = doc([paragraph("p1", "one")]);
		const b = doc([
			paragraph("p1", "one"),
			{ type: "paragraph", content: ["anonymous"] },
		]);
		expect(diffPromptDocuments(a, b)).toEqual([]);
	});

	test("contextUsage instructions are walked as children", () => {
		const a = doc([
			{
				type: "contextUsage",
				id: "c1",
				contextId: "files",
				instructions: [paragraph("p1", "use it")],
			},
		]);
		const b = doc([
			{
				type: "contextUsage",
				id: "c1",
				contextId: "files",
				instructions: [],
			},
		]);
		const entries = diffPromptDocuments(a, b);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: "removed", id: "p1" });
	});
});
