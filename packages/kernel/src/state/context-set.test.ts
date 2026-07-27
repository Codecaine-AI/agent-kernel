/**
 * context-set.test.ts — section ② is rebuilt, never accumulated. Nothing
 * stale can linger, because nothing is pinned to history.
 */
import { describe, expect, test } from "bun:test";
import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import { createContextSet } from "./context-set";
import { KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE } from "./kernel-messages";
import type { AgentMessage } from "./types";

function blocks(message: AgentMessage): Array<Record<string, unknown>> {
	return (message as unknown as { content: Array<Record<string, unknown>> })
		.content;
}

function text(message: AgentMessage): string {
	return String(blocks(message)[0]?.text ?? "");
}

describe("context set", () => {
	test("an empty set renders no message at all", () => {
		expect(createContextSet().render()).toBeNull();
	});

	test("entries render into ONE context message, in order", () => {
		const set = createContextSet([
			{ id: "caps", content: "op reference" },
			{ id: "style", content: "house style" },
		]);
		const message = set.render();
		expect(message).not.toBeNull();
		expect(text(message as AgentMessage)).toBe(
			"<context>\nop reference\nhouse style\n</context>",
		);
		expect(blocks(message as AgentMessage)).toHaveLength(1);
	});

	test("a label wraps its entry in an XML tag", () => {
		const set = createContextSet([
			{ id: "caps", label: "capabilities", content: "ops" },
		]);
		expect(text(set.render() as AgentMessage)).toBe(
			"<context>\n<capabilities>\nops\n</capabilities>\n</context>",
		);
	});

	test("gaining and losing a skill mid-run adds and removes an entry", () => {
		const set = createContextSet([{ id: "caps", content: "ops" }]);
		set.add({ id: "skill:search", content: "search skill" });
		expect(text(set.render() as AgentMessage)).toContain("search skill");

		expect(set.remove("skill:search")).toBe(true);
		expect(set.has("skill:search")).toBe(false);
		expect(text(set.render() as AgentMessage)).not.toContain("search skill");
		expect(set.size).toBe(1);
	});

	test("re-adding an id replaces the entry in place, keeping its position", () => {
		const set = createContextSet([
			{ id: "a", content: "first" },
			{ id: "b", content: "second" },
		]);
		set.add({ id: "a", content: "first (updated)" });
		expect(text(set.render() as AgentMessage)).toBe(
			"<context>\nfirst (updated)\nsecond\n</context>",
		);
		expect(set.size).toBe(2);
	});

	test("explicit order wins over insertion order", () => {
		const set = createContextSet();
		set.add({ id: "late", content: "late", order: 1 });
		set.add({ id: "early", content: "early", order: -1 });
		expect(text(set.render() as AgentMessage)).toBe(
			"<context>\nearly\nlate\n</context>",
		);
		expect(set.list().map((e) => e.id)).toEqual(["early", "late"]);
	});

	test("entry images ride along as image blocks after the text", () => {
		const set = createContextSet([
			{
				id: "exemplar",
				content: "style exemplar",
				images: [{ data: "QUJD", mimeType: "image/png" }],
			},
		]);
		const rendered = blocks(set.render() as AgentMessage);
		expect(rendered).toHaveLength(2);
		expect(rendered[1]).toEqual({
			type: "image",
			data: "QUJD",
			mimeType: "image/png",
		});
	});

	test("the context message is kernel-authored, not something the user said", () => {
		const message = createContextSet([
			{ id: "caps", content: "ops" },
		]).render() as unknown as Record<string, unknown>;
		// role "custom" + a kernel: customType. Pi's convertToLlm turns this into
		// a plain user message on the wire, so it is provider-valid; the marker
		// is what lets the turn view badge it KERNEL instead of USER.
		expect(message.role).toBe("custom");
		expect(message.customType).toBe(KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE);
		expect(message.display).toBe(false);
		expect(isKernelAuthoredMessage(message)).toBe(true);
	});

	test("removing an unknown id reports false; clear empties the set", () => {
		const set = createContextSet([{ id: "a", content: "a" }]);
		expect(set.remove("nope")).toBe(false);
		expect(set.get("a")?.content).toBe("a");
		expect(set.get("nope")).toBeNull();
		set.clear();
		expect(set.size).toBe(0);
		expect(set.render()).toBeNull();
	});
});
