// Slice: the single left-edge [+][⋮⋮] affordance cluster pinned to a block.
"use client";

import cn from "classnames";
import { GripVertical, Plus } from "lucide-react";
import type { PromptBlockNode } from "@codecaine-ai/prompt-kit";
import type { PromptBlockNodeType } from "@codecaine-ai/prompt-kit/ui";

import { LINE_HEIGHT_PX } from "../../../shared/editor-surface";
import { BlockMenu } from "./BlockMenu";

/**
 * The single left-edge affordance cluster for a block, pinned at its first
 * line just inside the gutter. Holds [+] (insert-below → typed-insert menu) and
 * [⋮⋮] (drag handle whose CLICK opens a compact block menu). Consolidating both
 * here — and keeping it visible while the block is selected — replaces the old
 * scattered left-drag-bar / right-"SECTION + trash" arrangement.
 */
export function BlockCluster({
	node,
	gutterWidth,
	visible,
	menuOpen,
	canInsertChild,
	onOpenInsert,
	onToggleMenu,
	onCloseMenu,
	onDuplicate,
	onRetag,
	onRemove,
	onInsertChild,
	onDragHandleDown,
}: {
	node: PromptBlockNode;
	gutterWidth: string;
	visible: boolean;
	menuOpen: boolean;
	canInsertChild: boolean;
	onOpenInsert: () => void;
	onToggleMenu: () => void;
	onCloseMenu: () => void;
	onDuplicate: () => void;
	onRetag: (tag: string) => void;
	onRemove: () => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
	return (
		<div
			className={cn(
				"absolute top-0 z-20 flex items-center gap-0.5 transition-opacity",
				visible ? "opacity-100" : "opacity-0",
			)}
			style={{ left: `calc(${gutterWidth} - 0.25ch)`, height: LINE_HEIGHT_PX }}
			onClick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onOpenInsert();
				}}
				title="Insert block below"
				aria-label="Insert block below"
				className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-[2px] text-muted-foreground/70 hover:bg-white/10 hover:text-foreground"
			>
				<Plus size={12} />
			</button>
			<button
				type="button"
				onPointerDown={(event) => {
					// Pointer-down begins a drag; a click that never moves opens the
					// block menu (handled in onClick).
					event.stopPropagation();
					onDragHandleDown(event);
				}}
				onClick={(event) => {
					event.stopPropagation();
					onToggleMenu();
				}}
				title="Drag, or click for block menu"
				aria-label="Block handle and menu"
				className="pointer-events-auto flex w-4 cursor-grab touch-none items-center justify-center rounded-[2px] text-muted-foreground/70 hover:bg-white/10 hover:text-foreground active:cursor-grabbing"
				style={{ height: LINE_HEIGHT_PX }}
			>
				<GripVertical size={12} />
			</button>
			{menuOpen && (
				<BlockMenu
					node={node}
					canInsertChild={canInsertChild}
					onClose={onCloseMenu}
					onDuplicate={onDuplicate}
					onRetag={onRetag}
					onRemove={onRemove}
					onInsertChild={onInsertChild}
				/>
			)}
		</div>
	);
}
