// Slice: one buffer row — gutter, hover/selection washes, affordance mounts,
// and the body column that dispatches to gap / item / inline-editor / text.
"use client";

import cn from "classnames";
import { Plus, X } from "lucide-react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	PromptBlockNodeType,
	PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import { EDITOR_COLORS, LINE_HEIGHT_PX } from "../../../shared/editor-surface";
import { InsertPalette } from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import type { XmlLine } from "../xml-line-model";
import { BlockCluster } from "./BlockCluster";
import { InlineEditor, RowText } from "./InlineEditor";
import { ItemRow } from "./ItemRow";

// Hanging indent: continuation lines of a wrapped row align under the line's
// content start. paddingLeft holds the leading whitespace; text-indent pulls
// the first line back to flush.
function leadingIndent(text: string): number {
	const match = text.match(/^ */);
	return match ? match[0].length : 0;
}

export interface XmlRowProps {
	line: XmlLine;
	lineNumber: number;
	gutterWidth: string;
	entry: PromptEditorTreeEntry | undefined;
	active: boolean;
	inHighlight: boolean;
	isHighlightStart: boolean;
	isHighlightEnd: boolean;
	isRangeStart: boolean;
	isRangeEnd: boolean;
	isLandmark: boolean;
	dragging: boolean;
	flashing: boolean;
	editing: boolean;
	gapHovered: boolean;
	insertOpen: boolean;
	menuOpen: boolean;
	itemHovered: boolean;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onHoverNode: () => void;
	onHoverGap: () => void;
	onSelect: () => void;
	onStartEdit: () => void;
	onEndEdit: () => void;
	onEditItem: (nodeId: string, itemIndex: number) => void;
	onOpenInsert: () => void;
	onToggleMenu: () => void;
	onCloseMenu: () => void;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onDuplicate: () => void;
	onRetag: (tag: string) => void;
	onRemove: () => void;
	onAddItem: () => void;
	onRemoveItem: () => void;
	onEnterParagraph: () => void;
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
}

export function XmlRow({
	line,
	lineNumber,
	gutterWidth,
	entry,
	active,
	inHighlight,
	isHighlightStart,
	isHighlightEnd,
	isRangeStart,
	isRangeEnd,
	isLandmark,
	dragging,
	flashing,
	editing,
	gapHovered,
	insertOpen,
	menuOpen,
	itemHovered,
	prompt,
	onPromptChange,
	onHoverNode,
	onHoverGap,
	onSelect,
	onStartEdit,
	onEndEdit,
	onEditItem,
	onOpenInsert,
	onToggleMenu,
	onCloseMenu,
	onInsert,
	onInsertChild,
	onDuplicate,
	onRetag,
	onRemove,
	onAddItem,
	onRemoveItem,
	onEnterParagraph,
	onDragHandleDown,
}: XmlRowProps) {
	const isGap = line.role === "gap";
	const isItem = line.role === "item";
	const canInsertChild =
		line.node.type === "section" ||
		line.node.type === "example" ||
		line.node.type === "contextUsage" ||
		line.node.type === "field";
	// Hanging indent: continuation lines of a wrapped row align under the
	// line's content start rather than flush-left. paddingLeft holds the
	// leading whitespace; text-indent pulls the first line back to flush.
	const indentCh = leadingIndent(line.text);

	// Strict grid: every row is EXACTLY one line-height, except where content
	// genuinely wraps (then it grows in whole line-height steps via min-height,
	// VS Code word-wrap idiom) or the insert palette pops open.
	const rowGridStyle =
		insertOpen && isGap ? undefined : { minHeight: LINE_HEIGHT_PX };

	return (
		<div
			data-row-index={lineNumber - 1}
			className={cn(
				"group relative flex items-stretch transition-opacity",
				dragging && "opacity-30",
			)}
			style={rowGridStyle}
			onMouseEnter={isGap ? onHoverGap : onHoverNode}
		>
			{/* Landmark tint: a very faint full-width wash marking a top-level
			    section's opening line so section starts scan as landmarks. */}
			{isLandmark && (
				<div
					className="pointer-events-none absolute inset-0 z-0"
					style={{ background: EDITOR_COLORS.landmark }}
				/>
			)}

			{/* Range wash behind the text across the whole block. Selection reads
			    clearly stronger than hover: a solid accent tint vs. a faint muted
			    hover wash, so it's obvious which block is picked. */}
			{(inHighlight || flashing) && (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 z-0 transition-colors",
						flashing
							? "bg-status-success-fill/25"
							: active
								? "bg-status-success-fill/20"
								: "bg-muted/40",
					)}
				/>
			)}
			{/* Left accent bar. On hover it's a thin git-diff change-bar; on
			    SELECTION it's a persistent, full-opacity 2px accent that stays
			    even when the pointer leaves — the primary "this is selected" cue. */}
			{(inHighlight || active) && (
				<div
					className={cn(
						"pointer-events-none absolute bottom-0 left-0 top-0 z-10",
						active ? "w-[2px] bg-status-success" : "w-[2px] bg-status-success/55",
					)}
					style={{
						borderTopLeftRadius: isHighlightStart ? 1 : 0,
						borderBottomLeftRadius: isHighlightEnd ? 1 : 0,
					}}
				/>
			)}

			{/* Gutter: fixed-width, right-aligned number. Background matches the
			    buffer so there's no hard seam/side line. All block affordances now
			    live in ONE cluster (see BlockCluster) anchored at the gutter's
			    right edge, so hover/selection controls are in a single spot. */}
			<div
				className="sticky left-0 z-10 flex shrink-0 select-none items-start justify-end pr-3 text-right tabular-nums"
				style={{
					minWidth: gutterWidth,
					background: active
						? "rgb(var(--status-success-fill) / 0.35)"
						: EDITOR_COLORS.gutterBg,
				}}
			>
				<span
					style={{
						color: active
							? EDITOR_COLORS.lineNumberActive
							: EDITOR_COLORS.lineNumber,
					}}
				>
					{lineNumber}
				</span>
			</div>

			{/* ONE affordance cluster, Notion-style, pinned at the block's first
			    line just inside the gutter: [+] insert-below and [⋮⋮] drag +
			    block menu. Visible on block hover OR while selected. */}
			{!isGap && isRangeStart && entry && (
				<BlockCluster
					node={line.node}
					gutterWidth={gutterWidth}
					visible={inHighlight || active || menuOpen}
					menuOpen={menuOpen}
					canInsertChild={canInsertChild}
					onOpenInsert={onOpenInsert}
					onToggleMenu={onToggleMenu}
					onCloseMenu={onCloseMenu}
					onDuplicate={onDuplicate}
					onRetag={onRetag}
					onRemove={onRemove}
					onInsertChild={onInsertChild}
					onDragHandleDown={onDragHandleDown}
				/>
			)}

			{/* Body column. Hanging-indent via padding-left + negative text-indent. */}
			<div
				className="relative z-0 min-w-0 flex-1 pr-4 pl-3"
				style={
					isGap
						? undefined
						: { paddingLeft: `calc(0.75rem + ${indentCh}ch)`, textIndent: `-${indentCh}ch` }
				}
			>
				{isGap ? (
					<GapRow
						hovered={gapHovered}
						insertOpen={insertOpen}
						canInsertChild={canInsertChild}
						onOpenInsert={onOpenInsert}
						onInsert={onInsert}
						onInsertChild={onInsertChild}
					/>
				) : isItem && entry ? (
					// List items always render their "1." / "-" marker as a fixed,
					// non-editable prefix; only the content area toggles between
					// display and inline editing, so the marker never disappears
					// during editing and the layout never shifts.
					<ItemRow
						line={line}
						entry={entry}
						editing={editing}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onStartEdit={() => onEditItem(line.nodeId, line.itemIndex ?? 0)}
						onEndEdit={onEndEdit}
						onEditItem={onEditItem}
						onAddItem={onAddItem}
					/>
				) : editing && entry ? (
					<InlineEditor
						line={line}
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onEndEdit={onEndEdit}
						onEnterParagraph={onEnterParagraph}
					/>
				) : (
					<RowText
						line={line}
						editable={line.editable}
						onSelect={onSelect}
						onStartEdit={onStartEdit}
					/>
				)}
			</div>

			{/* Per-item affordance: a minimal × at the item row's right margin,
			    shown only while hovering that item, removing exactly that item. */}
			{isItem && (itemHovered || (editing && isItem)) && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onRemoveItem();
					}}
					title="Remove item"
					aria-label="Remove list item"
					className="absolute right-2 top-0 z-10 flex h-4 w-4 items-center justify-center rounded-[2px] text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
					style={{ marginTop: (LINE_HEIGHT_PX - 16) / 2 }}
				>
					<X size={11} />
				</button>
			)}
		</div>
	);
}

function GapRow({
	hovered,
	insertOpen,
	canInsertChild,
	onOpenInsert,
	onInsert,
	onInsertChild,
}: {
	hovered: boolean;
	insertOpen: boolean;
	canInsertChild: boolean;
	onOpenInsert: () => void;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
}) {
	if (insertOpen) {
		return (
			<div className="py-1">
				<InsertPalette
					canInsertChild={canInsertChild}
					onInsert={onInsert}
					onInsertChild={onInsertChild}
				/>
			</div>
		);
	}
	return (
		<div
			className="relative flex items-center"
			style={{ height: LINE_HEIGHT_PX }}
		>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onOpenInsert();
				}}
				className={cn(
					"flex h-4 items-center gap-1 rounded-[2px] px-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground/70 transition-opacity hover:bg-white/10 hover:text-foreground",
					hovered ? "opacity-100" : "opacity-0",
				)}
				title="Insert block here"
				aria-label="Insert block here"
			>
				<Plus size={10} />
				insert
			</button>
			<span
				className={cn(
					"pointer-events-none absolute left-16 right-0 top-1/2 h-px -translate-y-1/2 bg-status-success/40 transition-opacity",
					hovered ? "opacity-100" : "opacity-0",
				)}
			/>
		</div>
	);
}
