// Slice: list-item / block mutation helpers used by the interaction layer.
// All mutations route through the *WithStep helpers (directly or via
// list-item-steps) so they commit as invertible transactions.
"use client";

import type {
	BulletListNode,
	CodeBlockNode,
	FieldNode,
	OrderedListNode,
	ParagraphNode,
	PromptBlockNode,
	PromptDocument,
	RawNode,
} from "@codecaine-ai/prompt-kit";
import {
	editableTextToInline,
	inlineToEditableText,
	insertPromptBlockNodeWithStep,
	type PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import { insertListItemStep, removeListItemStep } from "../list-item-steps";
import { updateNode } from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../xml-line-model";

/** The rendered marker prefix for an item ("1." for ordered, "-" for bullet). */
export function listMarker(node: PromptBlockNode, itemIndex: number): string {
	if (node.type === "orderedList") return `${(node.start ?? 1) + itemIndex}.`;
	return "-";
}

/** Editable text of an item, without the marker. */
export function itemContentText(node: PromptBlockNode, itemIndex: number): string {
	if (node.type !== "bulletList" && node.type !== "orderedList") return "";
	const item = node.items[itemIndex];
	return item ? inlineToEditableText(item.content) : "";
}

/**
 * Registers nested lists (those inside list-item children, which the editor
 * tree does not walk) into the id→entry map so their items stay inline-editable
 * and item ops resolve by id. Recurses through any depth of item nesting.
 */
export function registerNestedLists(
	entry: PromptEditorTreeEntry,
	map: Map<string, PromptEditorTreeEntry>,
): void {
	const node = entry.node;
	if (node.type !== "bulletList" && node.type !== "orderedList") return;
	for (const item of node.items) {
		for (const child of item.children ?? []) {
			if (
				(child.type === "bulletList" || child.type === "orderedList") &&
				child.id &&
				!map.has(child.id)
			) {
				const synthetic: PromptEditorTreeEntry = {
					...entry,
					id: child.id,
					node: child,
				};
				map.set(child.id, synthetic);
				registerNestedLists(synthetic, map);
			}
		}
	}
}

/** Renames a section's tag (the "type name as header" menu action). */
export function retagSection(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	tag: string,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
): void {
	updateNode(prompt, entry, onPromptChange, (current) =>
		current.type === "section" ? { ...current, tag } : current,
	);
}

/** Appends a new empty item to the list this line belongs to, focusing it. */
export function appendListItem(
	prompt: PromptDocument,
	line: XmlLine,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
	focus: (itemIndex: number) => void,
): void {
	const node = line.node;
	if (node.type !== "bulletList" && node.type !== "orderedList") return;
	const result = insertListItemStep(prompt, line.nodeId, node.items.length);
	if (result.step) onPromptChange(result.prompt, line.nodeId, [result.step]);
	focus(result.focusItemIndex ?? node.items.length);
}

/**
 * Removes the item this line represents. When it's the only item in a
 * top-level list (which HAS a tree entry), the whole list block is removed
 * instead — an empty list would render nothing and orphan the block.
 */
export function removeListItemOrList(
	prompt: PromptDocument,
	line: XmlLine,
	entry: PromptEditorTreeEntry | undefined,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
	removeBlock: (entry: PromptEditorTreeEntry) => void,
): void {
	const node = line.node;
	if (node.type !== "bulletList" && node.type !== "orderedList") return;
	const itemIndex = line.itemIndex ?? 0;
	if (node.items.length <= 1 && entry) {
		removeBlock(entry);
		return;
	}
	const result = removeListItemStep(prompt, line.nodeId, itemIndex);
	if (result.step) onPromptChange(result.prompt, line.nodeId, [result.step]);
}

/** Inserts an empty paragraph after `targetId`, focusing it (Notion Enter). */
export function insertParagraphBelow(
	prompt: PromptDocument,
	targetId: string,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
	focus: (newId: string) => void,
): void {
	const paragraph: PromptBlockNode = { type: "paragraph", content: [""] };
	const result = insertPromptBlockNodeWithStep(prompt, targetId, paragraph, "after");
	if (!result.step) return;
	const newId = result.step.op === "insert" ? result.step.node.id : undefined;
	onPromptChange(result.prompt, newId, [result.step]);
	if (newId) focus(newId);
}

/**
 * Finds the outer list + parent-item that hold the nested list `nestedListId`,
 * so Shift+Tab can hoist an item out. Returns undefined when `nestedListId` is
 * a top-level list (nothing to un-nest from). Searches only one level of items,
 * which covers the nesting this surface can create.
 */
export function findUnnestLocation(
	prompt: PromptDocument,
	nestedListId: string,
	_itemIndex: number,
): { outerListId: string; parentItemIndex: number } | undefined {
	const walk = (
		nodes: readonly PromptBlockNode[],
	): { outerListId: string; parentItemIndex: number } | undefined => {
		for (const node of nodes) {
			if (node.type === "bulletList" || node.type === "orderedList") {
				for (let i = 0; i < node.items.length; i++) {
					const children = node.items[i]?.children ?? [];
					for (const child of children) {
						if (child.id === nestedListId && node.id) {
							return { outerListId: node.id, parentItemIndex: i };
						}
						if (child.type === "bulletList" || child.type === "orderedList") {
							const deeper = walk([child]);
							if (deeper) return deeper;
						}
					}
				}
			}
			if (node.type === "section" || node.type === "example") {
				const found = walk(node.children);
				if (found) return found;
			}
			if (node.type === "field") {
				const found = walk(node.children ?? []);
				if (found) return found;
			}
			if (node.type === "contextUsage") {
				const found = walk(node.instructions);
				if (found) return found;
			}
		}
		return undefined;
	};
	return walk(prompt.nodes);
}

export function editorValueForLine(node: PromptBlockNode, line: XmlLine): string {
	switch (node.type) {
		case "paragraph":
			return inlineToEditableText(node.content);
		case "field":
			return inlineToEditableText(node.value);
		case "raw":
			return node.value;
		case "codeBlock":
			return node.code;
		case "bulletList":
		case "orderedList": {
			const item = node.items[line.itemIndex ?? 0];
			return item ? inlineToEditableText(item.content) : "";
		}
		default:
			return line.text;
	}
}

export function commitEdit(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	line: XmlLine,
	nextValue: string,
	onPromptChange: PromptFlowViewProps["onPromptChange"],
): void {
	const node = entry.node;
	switch (node.type) {
		case "paragraph":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "paragraph"
					? ({ ...current, content: editableTextToInline(nextValue) } satisfies ParagraphNode)
					: current,
			);
			return;
		case "field":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "field"
					? ({ ...current, value: editableTextToInline(nextValue) } satisfies FieldNode)
					: current,
			);
			return;
		case "raw":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "raw" ? ({ ...current, value: nextValue } satisfies RawNode) : current,
			);
			return;
		case "codeBlock":
			updateNode(prompt, entry, onPromptChange, (current) =>
				current.type === "codeBlock"
					? ({ ...current, code: nextValue } satisfies CodeBlockNode)
					: current,
			);
			return;
		case "bulletList":
		case "orderedList": {
			const itemIndex = line.itemIndex ?? 0;
			updateNode(prompt, entry, onPromptChange, (current) => {
				if (current.type !== "bulletList" && current.type !== "orderedList") return current;
				const items = current.items.map((item, index) =>
					index === itemIndex
						? { ...item, content: editableTextToInline(nextValue) }
						: item,
				);
				return { ...current, items } as BulletListNode | OrderedListNode;
			});
			return;
		}
	}
}
