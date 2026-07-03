// Slice: content dispatcher — maps a tree entry's node type to its block editor,
// wiring each editor's changes through the id-keyed updateNode step helper.
"use client";

import type {
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	ParagraphNode,
	PromptDocument,
	RawNode,
} from "@codecaine-ai/prompt-kit";
import {
	editableTextToInline,
	inlineToEditableText,
	type PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import { PlainTextArea, updateNode } from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import {
	CodeBlock,
	ContextBlock,
	ExampleBlock,
	FieldBlock,
	ListBlock,
	SectionBlock,
} from "./blocks";

export function RenderedBlock({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
}) {
	const node = entry.node;

	switch (node.type) {
		case "section":
			return (
				<SectionBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section" ? { ...current, ...patch } : current,
						)
					}
				/>
			);
		case "paragraph":
			return (
				<PlainTextArea
					value={inlineToEditableText(node.content)}
					placeholder="Write..."
					onChange={(content) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "paragraph"
								? ({ ...current, content: editableTextToInline(content) } satisfies ParagraphNode)
								: current,
						)
					}
				/>
			);
		case "bulletList":
		case "orderedList":
			return (
				<ListBlock
					node={node}
					onChange={(items) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "bulletList" || current.type === "orderedList"
								? { ...current, items }
								: current,
						)
					}
				/>
			);
		case "field":
			return (
				<FieldBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field" ? { ...current, ...patch } : current,
						)
					}
				/>
			);
		case "codeBlock":
			return (
				<CodeBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "codeBlock" ? ({ ...current, ...patch } satisfies CodeBlockNode) : current,
						)
					}
				/>
			);
		case "raw":
			return (
				<PlainTextArea
					value={node.value}
					placeholder="Raw text..."
					className="font-mono text-[12px]"
					onChange={(value) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "raw" ? ({ ...current, value } satisfies RawNode) : current,
						)
					}
				/>
			);
		case "example":
			return (
				<ExampleBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "example" ? ({ ...current, ...patch } satisfies ExampleNode) : current,
						)
					}
				/>
			);
		case "contextUsage":
			return (
				<ContextBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, ...patch } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
			);
	}
}
