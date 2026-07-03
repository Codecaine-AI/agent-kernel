// Slice: non-item row text — display (RowText) + in-place block editor.
"use client";

import cn from "classnames";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type { PromptEditorTreeEntry } from "@codecaine-ai/prompt-kit/ui";

import { LINE_HEIGHT_PX } from "../../../shared/editor-surface";
import { hasXmlTags, highlightXmlLine } from "../../../shared/xml-highlight";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../xml-line-model";
import { GrowTextArea } from "./GrowTextArea";
import { commitEdit, editorValueForLine } from "./node-mutations";

/** Rendered text for a non-editing row, with shared XML highlighting. */
export function RowText({
	line,
	editable,
	onSelect,
	onStartEdit,
}: {
	line: XmlLine;
	editable: boolean;
	onSelect: () => void;
	onStartEdit: () => void;
}) {
	const text = line.text;
	const display =
		text.length === 0 ? " " : hasXmlTags(text) ? highlightXmlLine(text) : text;

	return (
		<div
			className={cn(
				"whitespace-pre-wrap break-words",
				editable ? "cursor-text" : "cursor-pointer",
			)}
			style={{ lineHeight: `${LINE_HEIGHT_PX}px` }}
			onClick={(event) => {
				event.stopPropagation();
				if (editable) onStartEdit();
				else onSelect();
			}}
		>
			{display}
		</div>
	);
}

/**
 * In-place text editor. Uses identical mono metrics and the same left
 * indentation as the rendered line so opening it does not shift layout. Edits
 * flow through the same *WithStep mutation helpers as before (updateNode /
 * list-item patch), so drag/insert/edit all produce undoable steps.
 */
export function InlineEditor({
	line,
	entry,
	prompt,
	onPromptChange,
	onEndEdit,
	onEnterParagraph,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onEndEdit: () => void;
	onEnterParagraph: () => void;
}) {
	const node = entry.node;
	// Multi-line leaf content (raw / code) keeps Enter as a literal newline.
	const multiline = node.type === "raw" || node.type === "codeBlock";

	const value = editorValueForLine(node, line);
	const commit = (next: string) =>
		commitEdit(prompt, entry, line, next, onPromptChange);

	return (
		<div className="flex min-w-0" style={{ textIndent: 0 }}>
			<GrowTextArea
				value={value}
				autoFocus
				onChange={commit}
				onBlur={onEndEdit}
				onKeyDown={
					node.type === "paragraph"
						? (event) => {
								// Notion-style: Enter commits (already live) and adds a new
								// paragraph below, focusing it. Shift+Enter would be a literal
								// newline, but paragraph content is single-line in this model,
								// so Shift+Enter is a no-op here (see report).
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									onEnterParagraph();
								}
								if (event.key === "Enter" && event.shiftKey) {
									event.preventDefault(); // no-op: single-line paragraph model
								}
							}
						: undefined
				}
				allowEnter={multiline}
			/>
		</div>
	);
}
