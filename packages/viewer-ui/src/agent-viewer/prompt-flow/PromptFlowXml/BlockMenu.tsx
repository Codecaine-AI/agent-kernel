// Slice: compact block menu (rename/duplicate/add-child/delete) + its rows.
"use client";

import cn from "classnames";
import { Copy, CornerDownRight, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PromptBlockNode } from "@codecaine-ai/prompt-kit";
import type { PromptBlockNodeType } from "@codecaine-ai/prompt-kit/ui";

/**
 * Compact block menu opened from the [⋮⋮] handle: type name as header,
 * Duplicate, Delete, and — for container blocks — Add child. For sections the
 * type header doubles as a rename field (edits the tag), matching "type name as
 * header".
 */
export function BlockMenu({
	node,
	canInsertChild,
	onClose,
	onDuplicate,
	onRetag,
	onRemove,
	onInsertChild,
}: {
	node: PromptBlockNode;
	canInsertChild: boolean;
	onClose: () => void;
	onDuplicate: () => void;
	onRetag: (tag: string) => void;
	onRemove: () => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
}) {
	const isSection = node.type === "section";
	const [tag, setTag] = useState(isSection ? node.tag : node.type);

	function commitTag() {
		if (isSection && tag.trim() && tag !== node.tag) onRetag(tag.trim());
	}

	return (
		<div
			className="absolute left-0 top-full z-30 mt-1 w-48 rounded-[4px] border border-border bg-card p-1 shadow-lg"
			onClick={(event) => event.stopPropagation()}
		>
			{/* Type name as header — editable (rename tag) for sections. */}
			<div className="flex items-center gap-1.5 border-b border-border/70 px-1.5 pb-1.5 pt-1">
				<Tag size={11} className="shrink-0 text-muted-foreground" />
				{isSection ? (
					<input
						value={tag}
						onChange={(event) => setTag(event.target.value)}
						onBlur={commitTag}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitTag();
								onClose();
							}
							if (event.key === "Escape") onClose();
						}}
						spellCheck={false}
						className="w-full rounded-[2px] border border-border bg-background px-1 py-0.5 text-[11px] text-foreground outline-none focus:border-status-success"
						// Autofocus so the header reads as "rename here".
						autoFocus
					/>
				) : (
					<span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
						{node.type}
					</span>
				)}
			</div>
			<MenuItem
				icon={Copy}
				label="Duplicate"
				onClick={() => {
					onDuplicate();
					onClose();
				}}
			/>
			{canInsertChild && (
				<MenuItem
					icon={CornerDownRight}
					label="Add child"
					onClick={() => {
						onInsertChild("paragraph");
						onClose();
					}}
				/>
			)}
			<MenuItem
				icon={Trash2}
				label="Delete"
				destructive
				onClick={() => {
					onRemove();
					onClose();
				}}
			/>
		</div>
	);
}

function MenuItem({
	icon: Icon,
	label,
	destructive,
	onClick,
}: {
	icon: typeof Copy;
	label: string;
	destructive?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={cn(
				"flex w-full items-center gap-2 rounded-[2px] px-1.5 py-1 text-left text-[12px]",
				destructive
					? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
			)}
		>
			<Icon size={12} />
			{label}
		</button>
	);
}
