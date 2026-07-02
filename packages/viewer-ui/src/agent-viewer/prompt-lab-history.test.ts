import { describe, expect, test } from "bun:test";
import { canonicalizePrompt, type PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	removePromptBlockNodeByIdWithStep,
	updatePromptBlockNodeByIdWithStep,
} from "@codecaine-ai/prompt-kit/ui";

import { createPromptLabHistory } from "./prompt-lab-history";

function baseDoc(): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "lab-test",
		title: "Original title",
		nodes: [
			{ type: "paragraph", id: "p1", content: ["first"] },
			{ type: "paragraph", id: "p2", content: ["second"] },
		],
	};
}

describe("createPromptLabHistory", () => {
	test("step commit, undo, redo round-trips the document", () => {
		const history = createPromptLabHistory(baseDoc());
		const before = canonicalizePrompt(history.current());

		const result = updatePromptBlockNodeByIdWithStep(
			history.current(),
			"p1",
			(node) =>
				node.type === "paragraph" ? { ...node, content: ["changed"] } : node,
		);
		expect(result.step).toBeDefined();
		expect(history.commitSteps([result.step!])).toBe(true);

		const after = canonicalizePrompt(history.current());
		expect(after).not.toBe(before);
		expect(history.canUndo()).toBe(true);

		expect(history.undo()).toBe(true);
		expect(canonicalizePrompt(history.current())).toBe(before);

		expect(history.redo()).toBe(true);
		expect(canonicalizePrompt(history.current())).toBe(after);
	});

	test("metadata edits are undoable and interleave with step edits", () => {
		const history = createPromptLabHistory(baseDoc());
		history.commitMeta({ title: "New title" });

		const removal = removePromptBlockNodeByIdWithStep(history.current(), "p2");
		history.commitSteps([removal.step!]);

		expect(history.current().title).toBe("New title");
		expect(history.current().nodes).toHaveLength(1);

		history.undo(); // undo the removal
		expect(history.current().nodes).toHaveLength(2);
		expect(history.current().title).toBe("New title");

		history.undo(); // undo the title change
		expect(history.current().title).toBe("Original title");
		expect(history.canUndo()).toBe(false);

		history.redo();
		history.redo();
		expect(history.current().title).toBe("New title");
		expect(history.current().nodes).toHaveLength(1);
	});

	test("commit clears the redo stack", () => {
		const history = createPromptLabHistory(baseDoc());
		history.commitMeta({ title: "A" });
		history.undo();
		expect(history.canRedo()).toBe(true);
		history.commitMeta({ title: "B" });
		expect(history.canRedo()).toBe(false);
		expect(history.current().title).toBe("B");
	});

	test("no-op commits report false and add no history", () => {
		const history = createPromptLabHistory(baseDoc());
		expect(history.commitSteps([])).toBe(false);
		expect(history.commitMeta({ title: "Original title" })).toBe(false);
		expect(history.canUndo()).toBe(false);
	});

	test("undo works across a save boundary and re-dirties the draft", () => {
		const history = createPromptLabHistory(baseDoc());
		expect(history.isDirty()).toBe(false);

		const removal = removePromptBlockNodeByIdWithStep(history.current(), "p2");
		history.commitSteps([removal.step!]);
		expect(history.isDirty()).toBe(true);

		history.markSaved();
		expect(history.isDirty()).toBe(false);

		// History survives the baseline swap: undo past the save point.
		expect(history.undo()).toBe(true);
		expect(history.current().nodes).toHaveLength(2);
		expect(history.isDirty()).toBe(true);

		// Redo returns to the saved state; clean again.
		expect(history.redo()).toBe(true);
		expect(history.isDirty()).toBe(false);
	});

	test("transactions carry local (browser-safe) hashes", () => {
		const history = createPromptLabHistory(baseDoc());
		const removal = removePromptBlockNodeByIdWithStep(history.current(), "p2");
		history.commitSteps([removal.step!]);
		const transactions = history.transactions();
		expect(transactions).toHaveLength(1);
		expect(transactions[0]?.baseHash.startsWith("local-")).toBe(true);
	});
});
