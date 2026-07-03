// Slice: composition root for the Agent XML editing surface — layout + wiring
// only; row rendering, affordances, drag, and mutations live in siblings.
"use client";

import cn from "classnames";
import { useMemo, useRef, useState } from "react";
import type { PromptEditorTreeEntry } from "@codecaine-ai/prompt-kit/ui";

import {
	EDITOR_COLORS,
	editorRuleBackground,
	editorTypeStyle,
	LINE_HEIGHT_PX,
} from "../../../shared/editor-surface";
import { EmptyFlow, usePromptFlowInteractions } from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import { buildXmlLineModel, type XmlLine } from "../xml-line-model";
import { DragGhost, DropIndicator, useXmlDrag } from "./drag-controller";
import {
	computeGuides,
	computeLandmarks,
	computeNodeRanges,
	INDENT_CH,
	useRowMetrics,
} from "./node-geometry";
import {
	appendListItem,
	insertParagraphBelow,
	registerNestedLists,
	removeListItemOrList,
	retagSection,
} from "./node-mutations";
import { XmlRow } from "./XmlRow";

/**
 * Agent XML editing surface. At rest it renders continuous, dense,
 * syntax-colored XML on a STRICT single-line grid that visually matches the
 * read-only Raw view (same mono metrics, one cumulative line-number gutter,
 * shared highlighter). The editorial layer speaks the code editor's own
 * structural vocabulary — a rigid gutter, bracket-style indent guides, faint
 * section landmarks, git-diff change-bars on hover — and never card/box
 * chrome. Drag handles, insert affordances, and inline editing only appear on
 * hover / interaction, so toggling Raw ↔ editor feels like toggling
 * editability rather than opening a different document.
 *
 * Line numbers track Raw line-for-line because the row model comes from
 * buildXmlLineModel, whose concatenation is guaranteed (by test) to equal
 * renderXmlMarkdown — the exact string Raw shows.
 */

// Line-height / font metrics + palette live in the shared editor-surface
// module so this flow and the Raw view render on one grid with one palette.
const ROW_TEXT = "font-mono";

interface InlineEditTarget {
	nodeId: string;
	/** For list nodes, the item being edited. */
	itemIndex?: number;
}

export function PromptFlowXml({
	prompt,
	model,
	selectedNodeId,
	onSelectNode,
	onPromptChange,
}: PromptFlowViewProps) {
	const flow = usePromptFlowInteractions({
		prompt,
		model,
		selectedNodeId,
		onSelectNode,
		onPromptChange,
	});

	const lineModel = useMemo(
		() => buildXmlLineModel(prompt, { variables: undefined }),
		[prompt],
	);
	const lines = lineModel.lines;

	const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
	const [hoverGapIndex, setHoverGapIndex] = useState<number | null>(null);
	const [hoverItem, setHoverItem] = useState<{
		nodeId: string;
		itemIndex: number;
	} | null>(null);
	const [editTarget, setEditTarget] = useState<InlineEditTarget | null>(null);
	// The block menu ([⋮⋮] click) opens for one block at a time, anchored to its
	// first row so every block affordance stays in the one left cluster.
	const [menuNodeId, setMenuNodeId] = useState<string | null>(null);

	const entriesById = useMemo(() => {
		const map = new Map<string, PromptEditorTreeEntry>();
		for (const entry of model.tree) map.set(entry.id, entry);
		// Lists nested inside list items are NOT walked by the editor tree
		// (list items aren't block containers in the model), yet the line model
		// still renders their rows with real ids. Register lightweight entries
		// for those nested lists so their items stay inline-editable and item
		// ops (add/remove/nest) resolve by id. These synthetic entries carry no
		// meaningful tree path — item ops address the list by id, not path.
		for (const entry of model.tree) registerNestedLists(entry, map);
		return map;
	}, [model.tree]);

	// Ranges let hover/selection highlight the full block, not just one row.
	const nodeRanges = useMemo(() => computeNodeRanges(lines), [lines]);
	// Bracket-style indent guides: one hairline per top-level (and cheap
	// nested) container, spanning its open→close rows at the section indent.
	const guides = useMemo(() => computeGuides(lines, nodeRanges), [lines, nodeRanges]);
	// Rows that begin a top-level section — faint full-width landmark tint.
	const landmarkRows = useMemo(() => computeLandmarks(lines), [lines]);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<HTMLDivElement | null>(null);

	// Rows are one line-height at rest but grow when their content wraps, so
	// overlays (guides, landmark span, drop line) can't assume a fixed row
	// pitch — they read measured per-row offsets instead.
	const rowMetrics = useRowMetrics(rowsRef, lines.length);

	const drag = useXmlDrag({
		lines,
		nodeRanges,
		entriesById,
		rowsRef,
		scrollRef,
		moveNear: flow.moveNear,
	});

	const gutterWidth = useMemo(() => {
		const digits = Math.max(2, String(lines.length).length);
		return `${digits + 3}ch`;
	}, [lines.length]);

	const highlightNodeId = editTarget?.nodeId ?? drag.draggingId ?? hoverNodeId;
	const highlightRange = highlightNodeId
		? nodeRanges.get(highlightNodeId)
		: undefined;
	// The dragged / flashed block dims / flashes across its ENTIRE visual line
	// range (including nested child rows), so the whole object reads as lifted
	// out and the drop flash covers everything the ghost showed.
	const dragRange = drag.draggingId
		? nodeRanges.get(drag.draggingId)
		: undefined;
	const flashRange = drag.flashNodeId
		? nodeRanges.get(drag.flashNodeId)
		: undefined;

	return (
		<section
			className="flex h-full min-h-0 flex-1 flex-col font-mono"
			style={{ background: EDITOR_COLORS.bg, color: EDITOR_COLORS.fg }}
			onClick={() => {
				onSelectNode(undefined);
				setEditTarget(null);
				setMenuNodeId(null);
			}}
		>
			<div
				ref={scrollRef}
				data-prompt-flow-scroll="xml"
				className="min-h-0 flex-1 overflow-auto"
				style={{ background: EDITOR_COLORS.bg }}
			>
				{model.tree.length === 0 ? (
					<div className="p-4">
						<EmptyFlow onInsert={(type) => flow.insertBlock(type, null)} />
					</div>
				) : (
					<div
						ref={rowsRef}
						className={cn("relative w-full", ROW_TEXT)}
						style={{ ...editorTypeStyle, ...editorRuleBackground }}
						onMouseLeave={() => {
							setHoverNodeId(null);
							setHoverGapIndex(null);
							setHoverItem(null);
						}}
					>
						{lines.map((line, index) => {
							const entry = entriesById.get(line.nodeId);
							const range = nodeRanges.get(line.nodeId);
							const active = line.nodeId === flow.activeId;
							const inHighlight =
								highlightRange !== undefined &&
								index >= highlightRange.start &&
								index <= highlightRange.end &&
								line.role !== "gap";
							const isRangeStart = range?.start === index;
							const isRangeEnd = range?.end === index;
							const dragging =
								dragRange !== undefined &&
								index >= dragRange.start &&
								index <= dragRange.end;
							const flashing =
								flashRange !== undefined &&
								index >= flashRange.start &&
								index <= flashRange.end &&
								line.role !== "gap";

							return (
								<XmlRow
									key={`${line.nodeId}:${index}:${line.role}`}
									line={line}
									lineNumber={index + 1}
									gutterWidth={gutterWidth}
									entry={entry}
									active={active}
									inHighlight={inHighlight}
									isHighlightStart={inHighlight && highlightRange?.start === index}
									isHighlightEnd={inHighlight && highlightRange?.end === index}
									isRangeStart={isRangeStart}
									isRangeEnd={isRangeEnd}
									isLandmark={landmarkRows.has(index)}
									dragging={dragging}
									flashing={flashing}
									editing={
										editTarget?.nodeId === line.nodeId &&
										isEditingLine(editTarget, line)
									}
									gapHovered={line.role === "gap" && hoverGapIndex === index}
									insertOpen={flow.insertAfterId === line.nodeId && isRangeEnd}
									menuOpen={menuNodeId === line.nodeId && isRangeStart}
									itemHovered={
										line.role === "item" &&
										hoverItem?.nodeId === line.nodeId &&
										hoverItem.itemIndex === line.itemIndex
									}
									prompt={prompt}
									onPromptChange={onPromptChange}
									onHoverNode={() => {
										if (drag.draggingId) return;
										setHoverNodeId(line.nodeId);
										setHoverGapIndex(null);
										if (line.role === "item" && line.itemIndex !== undefined) {
											setHoverItem({
												nodeId: line.nodeId,
												itemIndex: line.itemIndex,
											});
										} else {
											setHoverItem(null);
										}
									}}
									onHoverGap={() => {
										if (drag.draggingId) return;
										setHoverGapIndex(index);
										setHoverNodeId(null);
										setHoverItem(null);
									}}
									onSelect={() => {
										onSelectNode(line.nodeId);
										setEditTarget(null);
										setMenuNodeId(null);
									}}
									onStartEdit={() => {
										if (!line.editable) return;
										onSelectNode(line.nodeId);
										setMenuNodeId(null);
										setEditTarget({
											nodeId: line.nodeId,
											itemIndex: line.itemIndex,
										});
									}}
									onEndEdit={() => setEditTarget(null)}
									onEditItem={(nodeId, itemIndex) => {
										onSelectNode(nodeId);
										setMenuNodeId(null);
										setEditTarget({ nodeId, itemIndex });
									}}
									onOpenInsert={() => {
										setMenuNodeId(null);
										flow.setInsertAfterId((current) =>
											current === line.nodeId ? null : line.nodeId,
										);
									}}
									onToggleMenu={() => {
										flow.setInsertAfterId(null);
										setMenuNodeId((current) =>
											current === line.nodeId ? null : line.nodeId,
										);
									}}
									onCloseMenu={() => setMenuNodeId(null)}
									onInsert={(type) => flow.insertBlock(type, line.nodeId)}
									onInsertChild={(type) =>
										flow.insertBlock(type, line.nodeId, "child")
									}
									onDuplicate={() => flow.duplicateBlock(line.nodeId)}
									onRetag={(tag) =>
										entry && retagSection(prompt, entry, tag, onPromptChange)
									}
									onRemove={() => entry && flow.removeBlock(entry)}
									onAddItem={() =>
										appendListItem(prompt, line, onPromptChange, (itemIndex) =>
											setEditTarget({ nodeId: line.nodeId, itemIndex }),
										)
									}
									onRemoveItem={() =>
										removeListItemOrList(
											prompt,
											line,
											entry,
											onPromptChange,
											flow.removeBlock,
										)
									}
									onEnterParagraph={() =>
										insertParagraphBelow(
											prompt,
											line.nodeId,
											onPromptChange,
											(newId) => setEditTarget({ nodeId: newId }),
										)
									}
									onDragHandleDown={(event) =>
										entry && drag.startDrag(event, line.nodeId)
									}
								/>
							);
						})}

						{/* Indent guides: thin bracket-style hairlines connecting a
						    container's open tag to its close tag. Positioned from
						    measured row offsets so wrapped rows don't misalign them. */}
						{guides.map((guide) => {
							const openRow = rowMetrics[guide.start];
							const closeRow = rowMetrics[guide.end];
							if (!openRow || !closeRow) return null;
							// Start just under the open tag's first line; stop at the
							// top of the close tag's line (bracket-guide idiom).
							const top = openRow.top + LINE_HEIGHT_PX;
							const bottom = closeRow.top;
							if (bottom <= top) return null;
							return (
								<div
									key={`guide:${guide.nodeId}:${guide.start}`}
									className="pointer-events-none absolute z-0 w-px"
									style={{
										top,
										height: bottom - top,
										left: `calc(${gutterWidth} + ${
											guide.depth * INDENT_CH + 0.55
										}ch)`,
										background: EDITOR_COLORS.guide,
									}}
								/>
							);
						})}
					</div>
				)}
			</div>

			<DragGhost drag={drag} />
			<DropIndicator drag={drag} gutterWidth={gutterWidth} />
		</section>
	);
}

function isEditingLine(target: InlineEditTarget, line: XmlLine): boolean {
	if (line.role === "item") return target.itemIndex === line.itemIndex;
	// Multi-line leaf nodes (raw/code) edit as a single textarea anchored on
	// their first content line.
	if (line.contentLineIndex !== undefined) return line.contentLineIndex === 0;
	return true;
}
