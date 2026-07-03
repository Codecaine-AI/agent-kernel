// Slice: per-node-type detail editors (tag/title/label/language/context id …)
// plus the id-keyed updateNode step helper they share.
"use client";

import type {
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	PromptBlockNode,
	PromptDocument,
	SectionNode,
} from "@codecaine-ai/prompt-kit";
import {
	updatePromptBlockNodeByIdWithStep,
	type PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import type { PromptFlowChangeHandler } from "../types";
import { InspectorSection, MiniField, TextInput } from "./fields";

export function NodeDetails({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
}) {
	const node = entry.node;

	if (node.type === "section") {
		return (
			<InspectorSection title="Section">
				<TextInput
					label="tag"
					value={node.tag}
					onChange={(tag) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section"
								? ({ ...current, tag } satisfies SectionNode)
								: current,
						)
					}
				/>
				<TextInput
					label="title"
					value={node.title ?? ""}
					onChange={(title) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section"
								? ({ ...current, title: title || undefined } satisfies SectionNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "field") {
		return (
			<InspectorSection title="Field">
				<TextInput
					label="label"
					value={node.label}
					onChange={(label) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field"
								? ({ ...current, label } satisfies FieldNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children?.length ?? 0)} />
			</InspectorSection>
		);
	}

	if (node.type === "codeBlock") {
		return (
			<InspectorSection title="Code">
				<TextInput
					label="language"
					value={node.language ?? ""}
					onChange={(language) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "codeBlock"
								? ({ ...current, language: language || undefined } satisfies CodeBlockNode)
								: current,
						)
					}
				/>
			</InspectorSection>
		);
	}

	if (node.type === "example") {
		return (
			<InspectorSection title="Example">
				<TextInput
					label="title"
					value={node.title ?? ""}
					onChange={(title) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "example"
								? ({ ...current, title: title || undefined } satisfies ExampleNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "contextUsage") {
		return (
			<InspectorSection title="Context">
				<TextInput
					label="context id"
					value={node.contextId}
					onChange={(contextId) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, contextId } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<TextInput
					label="tag"
					value={node.tag ?? ""}
					onChange={(tag) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, tag: tag || undefined } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<MiniField label="instructions" value={String(node.instructions.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "raw") {
		return (
			<InspectorSection title="Raw">
				<MiniField label="chars" value={String(node.value.length)} />
			</InspectorSection>
		);
	}

	return null;
}

function updateNode(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	onPromptChange: PromptFlowChangeHandler,
	updater: (node: PromptBlockNode) => PromptBlockNode,
) {
	const result = updatePromptBlockNodeByIdWithStep(prompt, entry.id, updater);
	if (!result.step) return;
	onPromptChange(result.prompt, entry.id, [result.step]);
}
