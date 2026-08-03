import { describe, expect, test } from "bun:test";
import { getPromptBlockNodeById } from "@codecaine-ai/prompt-kit/ui";

import { compilePromptEditOps, parsePromptEditOps } from "./compile-ops";
import { fixtureDoc } from "./test-fixtures";

describe("compilePromptEditOps — id → path resolution", () => {
	test("update_node compiles to an id-based update step with a shallow diff", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "update_node", nodeId: "par-1", patch: { content: ["Be terse."] } },
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]).toMatchObject({
			op: "update",
			id: "par-1",
			before: { content: ["You are a helpful agent."] },
			after: { content: ["Be terse."] },
		});
		expect(result.changedIds).toEqual(["par-1"]);
		const updated = getPromptBlockNodeById(result.doc, "par-1");
		expect(updated?.node).toMatchObject({ content: ["Be terse."] });
	});

	test("insert_after a nested sibling resolves the parent path", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_after",
				refNodeId: "par-1",
				node: { type: "paragraph", id: "fresh-1", content: ["New line."] },
			},
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.steps[0]).toMatchObject({
			op: "insert",
			path: ["nodes", 0, "children", 1],
		});
		expect(result.changedIds).toEqual(["fresh-1"]);
		// Lands between par-1 and par-2.
		expect(getPromptBlockNodeById(result.doc, "par-2")?.path).toEqual([
			"nodes",
			0,
			"children",
			2,
		]);
	});

	test("insert_after a top-level node inserts at the document level", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_after",
				refNodeId: "sec-a",
				node: { type: "paragraph", content: ["Between sections."] },
			},
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.steps[0]).toMatchObject({ op: "insert", path: ["nodes", 1] });
	});

	test("colliding ids on the inserted node are reassigned", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_after",
				refNodeId: "par-3",
				node: { type: "paragraph", id: "par-1", content: ["Duplicate id."] },
			},
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		const step = result.steps[0]!;
		if (step.op !== "insert") throw new Error("expected insert step");
		expect(step.node.id).toBeDefined();
		expect(step.node.id).not.toBe("par-1");
	});

	test("insert_into with an index places the child; without appends", () => {
		const withIndex = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_into",
				parentNodeId: "sec-b",
				index: 0,
				node: { type: "paragraph", id: "fresh-2", content: ["Preamble."] },
			},
		]);
		if (!withIndex.ok) throw new Error(JSON.stringify(withIndex.errors));
		expect(withIndex.steps[0]).toMatchObject({
			op: "insert",
			path: ["nodes", 1, "children", 0],
		});

		const append = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_into",
				parentNodeId: "sec-b",
				node: { type: "paragraph", content: ["Coda."] },
			},
		]);
		if (!append.ok) throw new Error(JSON.stringify(append.errors));
		expect(append.steps[0]).toMatchObject({
			op: "insert",
			path: ["nodes", 1, "children", 1],
		});
	});

	test("remove_node compiles to a path-based remove carrying the node", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "remove_node", nodeId: "par-2" },
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.steps[0]).toMatchObject({
			op: "remove",
			path: ["nodes", 0, "children", 1],
			removed: { id: "par-2" },
		});
		expect(getPromptBlockNodeById(result.doc, "par-2")).toBeUndefined();
	});

	test("move_after across parents resolves `to` against the removed doc", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "move_after", nodeId: "par-3", refNodeId: "par-1" },
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.steps[0]).toMatchObject({
			op: "move",
			from: ["nodes", 2],
			to: ["nodes", 0, "children", 1],
		});
		const secA = getPromptBlockNodeById(result.doc, "sec-a");
		if (secA?.node.type !== "section") throw new Error("expected section");
		expect(secA.node.children.map((child) => child.id)).toEqual([
			"par-1",
			"par-3",
			"par-2",
		]);
	});

	test("move_after among top-level siblings (downward) lands after the ref", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "move_after", nodeId: "sec-a", refNodeId: "sec-b" },
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.doc.nodes.map((node) => node.id)).toEqual([
			"sec-b",
			"sec-a",
			"par-3",
		]);
	});

	test("later ops compile against the document produced by earlier ops", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_after",
				refNodeId: "par-2",
				node: { type: "paragraph", id: "fresh-3", content: ["Draft."] },
			},
			{ op: "update_node", nodeId: "fresh-3", patch: { content: ["Final."] } },
		]);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		expect(result.changedIds).toEqual(["fresh-3"]);
		expect(getPromptBlockNodeById(result.doc, "fresh-3")?.node).toMatchObject({
			content: ["Final."],
		});
	});
});

describe("compilePromptEditOps — typed errors", () => {
	test("unknown ids produce unknown_node with the op index", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "update_node", nodeId: "par-1", patch: { content: ["ok"] } },
			{ op: "remove_node", nodeId: "ghost" },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual([
			expect.objectContaining({ code: "unknown_node", opIndex: 1, nodeId: "ghost" }),
		]);
	});

	test("insert_into a leaf node is cannot_contain_children", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{
				op: "insert_into",
				parentNodeId: "par-1",
				node: { type: "paragraph", content: ["nope"] },
			},
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]?.code).toBe("cannot_contain_children");
	});

	test("update_node rejects id and type changes and no-op patches", () => {
		const idChange = compilePromptEditOps(fixtureDoc(), [
			{ op: "update_node", nodeId: "par-1", patch: { id: "par-x" } },
		]);
		expect(!idChange.ok && idChange.errors[0]?.code).toBe("cannot_change_id");

		const typeChange = compilePromptEditOps(fixtureDoc(), [
			{ op: "update_node", nodeId: "par-1", patch: { type: "raw" } },
		]);
		expect(!typeChange.ok && typeChange.errors[0]?.code).toBe("cannot_change_type");

		const noop = compilePromptEditOps(fixtureDoc(), [
			{
				op: "update_node",
				nodeId: "par-1",
				patch: { content: ["You are a helpful agent."] },
			},
		]);
		expect(!noop.ok && noop.errors[0]?.code).toBe("noop_update");
	});

	test("move_after into the moved subtree is rejected", () => {
		const result = compilePromptEditOps(fixtureDoc(), [
			{ op: "move_after", nodeId: "sec-a", refNodeId: "par-1" },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]?.code).toBe("move_ref_inside_subtree");
	});

	test("an empty op list is rejected", () => {
		const result = compilePromptEditOps(fixtureDoc(), []);
		expect(!result.ok && result.errors[0]?.code).toBe("empty_ops");
	});
});

describe("parsePromptEditOps", () => {
	test("narrows well-formed ops", () => {
		const parsed = parsePromptEditOps([
			{ op: "remove_node", nodeId: "par-1" },
			{ op: "move_after", nodeId: "par-2", refNodeId: "par-3" },
		]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.ops).toHaveLength(2);
	});

	test("rejects non-arrays, unknown op names, and missing fields", () => {
		expect(parsePromptEditOps("nope").ok).toBe(false);
		const badName = parsePromptEditOps([{ op: "replace_node", nodeId: "x" }]);
		expect(!badName.ok && badName.errors[0]?.code).toBe("invalid_op_shape");
		const missing = parsePromptEditOps([{ op: "insert_after", refNodeId: "x" }]);
		expect(!missing.ok && missing.errors[0]?.code).toBe("invalid_op_shape");
	});
});
