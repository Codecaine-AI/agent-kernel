// Slice: list-item row rendering + inline item editor with the Notion keyboard map.
"use client";

import { Plus } from "lucide-react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type { PromptEditorTreeEntry } from "@codecaine-ai/prompt-kit/ui";

import { LINE_HEIGHT_PX } from "../../../shared/editor-surface";
import {
	insertListItemStep,
	nestListItemStep,
	removeListItemStep,
	setListItemContentStep,
	unnestListItemStep,
} from "../list-item-steps";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../xml-line-model";
import { GrowTextArea } from "./GrowTextArea";
import {
	editorValueForLine,
	findUnnestLocation,
	itemContentText,
	listMarker,
} from "./node-mutations";

/**
 * One list-item row. The marker ("1." / "-") is always rendered as a fixed,
 * non-editable prefix; the content area to its right either displays the item
 * text or hosts the inline editor. This guarantees the marker persists during
 * editing and the layout never shifts. When the item is the last in its list, a
 * hover-only "+ item" affordance appears at the list end.
 */
export function ItemRow({
	line,
	entry,
	editing,
	prompt,
	onPromptChange,
	onStartEdit,
	onEndEdit,
	onEditItem,
	onAddItem,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	editing: boolean;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onStartEdit: () => void;
	onEndEdit: () => void;
	onEditItem: (nodeId: string, itemIndex: number) => void;
	onAddItem: () => void;
}) {
	const node = line.node;
	const itemIndex = line.itemIndex ?? 0;
	const marker = listMarker(node, itemIndex);
	const isLast =
		(node.type === "bulletList" || node.type === "orderedList") &&
		itemIndex === node.items.length - 1;

	return (
		<div className="flex min-w-0 items-start" style={{ textIndent: 0 }}>
			<span
				className="shrink-0 select-none pr-1 tabular-nums text-muted-foreground/80"
				style={{ lineHeight: `${LINE_HEIGHT_PX}px` }}
			>
				{marker}
			</span>
			<div className="relative min-w-0 flex-1">
				{editing ? (
					<ItemEditor
						line={line}
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onEndEdit={onEndEdit}
						onEditItem={onEditItem}
					/>
				) : (
					<div
						className="cursor-text whitespace-pre-wrap break-words"
						style={{ lineHeight: `${LINE_HEIGHT_PX}px` }}
						onClick={(event) => {
							event.stopPropagation();
							onStartEdit();
						}}
					>
						{itemContentText(node, itemIndex) || " "}
					</div>
				)}
				{isLast && !editing && (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onAddItem();
						}}
						title="Add item"
						aria-label="Add list item"
						className="mt-px flex h-4 items-center gap-1 rounded-[2px] px-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground/0 transition-colors hover:text-foreground group-hover:text-muted-foreground/70"
					>
						<Plus size={9} /> item
					</button>
				)}
			</div>
		</div>
	);
}

/**
 * Inline editor for one list item with the Notion-style keyboard model. Text
 * commits live (per keystroke) through setListItemContentStep, so each of the
 * structural keys below is a single additional step / one undo unit.
 *
 * Keyboard map:
 *   Enter        commit + insert empty item BELOW, focus it.
 *   Enter (on an already-empty trailing item) → remove it, exit editing
 *                 ("escape the list").
 *   Backspace    (in an empty item) → remove it, focus previous item's end.
 *   Tab          nest under previous item.
 *   Shift+Tab    un-nest (best-effort; see report).
 *   Escape       cancel edit (blur) — inherited from GrowTextArea.
 */
function ItemEditor({
	line,
	entry,
	prompt,
	onPromptChange,
	onEndEdit,
	onEditItem,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onEndEdit: () => void;
	onEditItem: (nodeId: string, itemIndex: number) => void;
}) {
	const node = entry.node;
	const listId = line.nodeId;
	const itemIndex = line.itemIndex ?? 0;
	const value = editorValueForLine(node, line);
	const itemCount =
		node.type === "bulletList" || node.type === "orderedList"
			? node.items.length
			: 0;
	const isEmpty = value.trim().length === 0;
	const isTrailing = itemIndex === itemCount - 1;

	const commit = (next: string) => {
		const result = setListItemContentStep(prompt, listId, itemIndex, next);
		if (result.step) onPromptChange(result.prompt, listId, [result.step]);
	};

	function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			// Enter on an empty trailing item escapes the list.
			if (isEmpty && isTrailing) {
				const result = removeListItemStep(prompt, listId, itemIndex);
				if (result.step) onPromptChange(result.prompt, listId, [result.step]);
				onEndEdit();
				return;
			}
			const result = insertListItemStep(prompt, listId, itemIndex + 1);
			if (result.step) onPromptChange(result.prompt, listId, [result.step]);
			onEditItem(listId, result.focusItemIndex ?? itemIndex + 1);
			return;
		}
		if (event.key === "Enter" && event.shiftKey) {
			// Single-line item model: Shift+Enter can't insert a literal newline.
			event.preventDefault();
			return;
		}
		if (event.key === "Backspace" && isEmpty && itemCount > 1) {
			event.preventDefault();
			const result = removeListItemStep(prompt, listId, itemIndex);
			if (result.step) onPromptChange(result.prompt, listId, [result.step]);
			const focus = result.focusItemIndex ?? Math.max(0, itemIndex - 1);
			onEditItem(listId, focus);
			return;
		}
		if (event.key === "Tab" && !event.shiftKey) {
			event.preventDefault();
			// Nest under the previous item (no-op for the first item).
			const result = nestListItemStep(prompt, listId, itemIndex);
			if (result.step) onPromptChange(result.prompt, listId, [result.step]);
			return;
		}
		if (event.key === "Tab" && event.shiftKey) {
			event.preventDefault();
			// Un-nest hoists this item out of its parent list. Resolvable only
			// when we can locate the outer list + parent item for this nested
			// list (see report for the addressing limitation).
			const location = findUnnestLocation(prompt, listId, itemIndex);
			if (location) {
				const result = unnestListItemStep(
					prompt,
					location.outerListId,
					location.parentItemIndex,
					itemIndex,
				);
				if (result.step) {
					onPromptChange(result.prompt, location.outerListId, [result.step]);
				}
			}
			return;
		}
	}

	return (
		<GrowTextArea
			value={value}
			autoFocus
			onChange={commit}
			onBlur={onEndEdit}
			onKeyDown={handleKeyDown}
		/>
	);
}
