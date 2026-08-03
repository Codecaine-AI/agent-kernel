/**
 * Shared fixtures for the prompt-edit-session tests. Not exported from the
 * module barrel — test-only.
 */
import type { PromptDocument } from "@codecaine-ai/prompt-kit";

import type { PromptEditRequestInput } from "./types";

/**
 * doc-1
 * ├─ sec-a <overview>
 * │  ├─ par-1  "You are a helpful agent."
 * │  └─ par-2  "Keep answers short."
 * ├─ sec-b <rules>
 * │  └─ list-1 (Rule one. / Rule two.)
 * └─ par-3    "Sign off politely."
 */
export function fixtureDoc(): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "doc-1",
		nodes: [
			{
				type: "section",
				id: "sec-a",
				tag: "overview",
				children: [
					{
						type: "paragraph",
						id: "par-1",
						content: ["You are a helpful agent."],
					},
					{
						type: "paragraph",
						id: "par-2",
						content: ["Keep answers short."],
					},
				],
			},
			{
				type: "section",
				id: "sec-b",
				tag: "rules",
				children: [
					{
						type: "bulletList",
						id: "list-1",
						items: [
							{ type: "listItem", id: "item-1", content: ["Rule one."] },
							{ type: "listItem", id: "item-2", content: ["Rule two."] },
						],
					},
				],
			},
			{ type: "paragraph", id: "par-3", content: ["Sign off politely."] },
		],
	};
}

export function fixtureRequests(): PromptEditRequestInput[] {
	return [
		{
			id: "ann-1",
			target: { kind: "node", nodeId: "par-1" },
			body: "Make the opening more direct.",
		},
		{
			id: "ann-2",
			target: { kind: "range", nodeId: "par-2", start: 0, end: 4, quote: "Keep" },
			body: "This rule reads as filler — tighten or cut.",
		},
		{
			id: "ann-3",
			target: { kind: "doc" },
			body: "Overall: the prompt repeats itself, dedupe.",
		},
	];
}
