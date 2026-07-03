// Slice: one section-surface block — indent frame, drop lines, drag/insert
// controls, and the selectable content well hosting RenderedBlock.
"use client";

import cn from "classnames";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	PromptBlockNodeType,
	PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import {
	canHaveChildren,
	DropLines,
	InsertPalette,
	PromptBlockControls,
} from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import { RenderedBlock } from "./RenderedBlock";

export function FlowBlock({
	entry,
	prompt,
	active,
	insertOpen,
	dragging,
	dropBefore,
	dropAfter,
	onSelectNode,
	onPromptChange,
	onOpenInsert,
	onInsert,
	onInsertChild,
	onRemove,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	active: boolean;
	insertOpen: boolean;
	dragging: boolean;
	dropBefore: boolean;
	dropAfter: boolean;
	onSelectNode: PromptFlowViewProps["onSelectNode"];
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onOpenInsert: () => void;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onRemove: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent<HTMLElement>) => void;
	onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
	const node = entry.node;
	const childInsert = canHaveChildren(node);

	return (
		<div
			className={cn("group relative", dragging && "opacity-45")}
			style={{ marginLeft: entry.depth * 22 }}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<DropLines dropBefore={dropBefore} dropAfter={dropAfter} />

			<div className="flex items-start gap-1 py-0.5">
				<PromptBlockControls
					entry={entry}
					onOpenInsert={onOpenInsert}
					onRemove={onRemove}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
				/>

				<div
					onClick={(event) => {
						event.stopPropagation();
						onSelectNode(entry.id);
					}}
					onFocusCapture={() => onSelectNode(entry.id)}
					className={cn(
						"min-w-0 flex-1 rounded-[3px] border px-2 py-1.5 transition-colors",
						active
							? "border-status-success-border bg-status-success-fill/10"
							: "border-transparent hover:bg-muted/20",
					)}
				>
					<RenderedBlock
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
					/>
				</div>
			</div>

			{insertOpen && (
				<div className="ml-[4.75rem] py-1">
					<InsertPalette
						canInsertChild={childInsert}
						onInsert={onInsert}
						onInsertChild={onInsertChild}
					/>
				</div>
			)}
		</div>
	);
}
