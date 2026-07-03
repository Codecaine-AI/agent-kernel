"use client";

import cn from "classnames";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	type PromptBlockNodeType,
	type PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import {
	EDITOR_COLORS,
	editorRuleBackground,
	editorTypeStyle,
	LINE_HEIGHT_PX,
} from "../../shared/editor-surface";
import { hasXmlTags, highlightXmlLine } from "../../shared/xml-highlight";
import {
	EmptyFlow,
	InsertPalette,
	samePath,
	updateNode,
	usePromptFlowInteractions,
} from "./PromptFlowShared";
import type { PromptFlowViewProps } from "./types";
import { buildXmlLineModel, type XmlLine } from "./xml-line-model";

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
// Width of one indent level in the rendered text, in `ch`. prompt-kit indents
// with two spaces per level; guides/landmarks are positioned against this.
const INDENT_CH = 2;

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
	const [editTarget, setEditTarget] = useState<InlineEditTarget | null>(null);

	const entriesById = useMemo(() => {
		const map = new Map<string, PromptEditorTreeEntry>();
		for (const entry of model.tree) map.set(entry.id, entry);
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
									prompt={prompt}
									onPromptChange={onPromptChange}
									onHoverNode={() => {
										if (drag.draggingId) return;
										setHoverNodeId(line.nodeId);
										setHoverGapIndex(null);
									}}
									onHoverGap={() => {
										if (drag.draggingId) return;
										setHoverGapIndex(index);
										setHoverNodeId(null);
									}}
									onSelect={() => {
										onSelectNode(line.nodeId);
										setEditTarget(null);
									}}
									onStartEdit={() => {
										if (!line.editable) return;
										onSelectNode(line.nodeId);
										setEditTarget({
											nodeId: line.nodeId,
											itemIndex: line.itemIndex,
										});
									}}
									onEndEdit={() => setEditTarget(null)}
									onOpenInsert={() =>
										flow.setInsertAfterId((current) =>
											current === line.nodeId ? null : line.nodeId,
										)
									}
									onInsert={(type) => flow.insertBlock(type, line.nodeId)}
									onInsertChild={(type) =>
										flow.insertBlock(type, line.nodeId, "child")
									}
									onRemove={() => entry && flow.removeBlock(entry)}
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

interface XmlRowProps {
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
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onHoverNode: () => void;
	onHoverGap: () => void;
	onSelect: () => void;
	onStartEdit: () => void;
	onEndEdit: () => void;
	onOpenInsert: () => void;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onRemove: () => void;
	onDragHandleDown: (event: React.PointerEvent<HTMLElement>) => void;
}

function XmlRow({
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
	prompt,
	onPromptChange,
	onHoverNode,
	onHoverGap,
	onSelect,
	onStartEdit,
	onEndEdit,
	onOpenInsert,
	onInsert,
	onInsertChild,
	onRemove,
	onDragHandleDown,
}: XmlRowProps) {
	const isGap = line.role === "gap";
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

			{/* Hover / drag range wash sits behind the text across the whole block. */}
			{(inHighlight || flashing) && (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 z-0 transition-colors",
						flashing
							? "bg-status-success-fill/25"
							: active
								? "bg-status-success-fill/12"
								: "bg-muted/40",
					)}
				/>
			)}
			{/* git-diff change-bar: a 2px accent bar down the left edge spanning
			    exactly the highlighted block's rows. */}
			{inHighlight && (
				<div
					className={cn(
						"pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-[2px]",
						active ? "bg-status-success" : "bg-status-success/55",
					)}
					style={{
						borderTopLeftRadius: isHighlightStart ? 1 : 0,
						borderBottomLeftRadius: isHighlightEnd ? 1 : 0,
					}}
				/>
			)}

			{/* Gutter: fixed-width, right-aligned number. Background matches the
			    buffer so there's no hard seam/side line; drag handle overlays the
			    number on the block's first row on hover. */}
			<div
				className="sticky left-0 z-10 flex shrink-0 select-none items-start justify-end pr-3 text-right tabular-nums"
				style={{
					minWidth: gutterWidth,
					background: active
						? "rgb(var(--status-success-fill) / 0.35)"
						: EDITOR_COLORS.gutterBg,
				}}
			>
				{entry && !isGap && isRangeStart && (
					<button
						type="button"
						onPointerDown={(event) => {
							event.stopPropagation();
							onDragHandleDown(event);
						}}
						onClick={(event) => event.stopPropagation()}
						title={`Drag ${line.node.type}`}
						aria-label={`Drag ${line.node.type} block`}
						className="absolute left-1 top-0 flex w-3.5 shrink-0 cursor-grab touch-none items-center justify-center rounded-[2px] text-muted-foreground/70 opacity-0 hover:bg-white/10 hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
						style={{ height: LINE_HEIGHT_PX }}
					>
						<GripVertical size={12} />
					</button>
				)}
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
				) : editing && entry ? (
					<InlineEditor
						line={line}
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
						onEndEdit={onEndEdit}
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

			{/* Type chip + block controls, revealed on hover at the row end. */}
			{!isGap && isRangeStart && entry && (
				<div
					className="pointer-events-none absolute right-2 top-0 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
					style={{ height: LINE_HEIGHT_PX }}
				>
					<span className="pointer-events-auto rounded-[2px] bg-muted/70 px-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground/80">
						{line.node.type}
					</span>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onOpenInsert();
						}}
						title="Insert after"
						aria-label="Insert after"
						className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-[2px] text-muted-foreground/70 hover:bg-muted/70 hover:text-foreground"
					>
						<Plus size={11} />
					</button>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onRemove();
						}}
						title="Delete block"
						aria-label="Delete block"
						className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-[2px] text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
					>
						<Trash2 size={10} />
					</button>
				</div>
			)}
		</div>
	);
}

/** Rendered text for a non-editing row, with shared XML highlighting. */
function RowText({
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
function InlineEditor({
	line,
	entry,
	prompt,
	onPromptChange,
	onEndEdit,
}: {
	line: XmlLine;
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onEndEdit: () => void;
}) {
	const node = entry.node;

	const value = editorValueForLine(node, line);
	const commit = (next: string) =>
		commitEdit(prompt, entry, line, next, onPromptChange);

	return (
		<div className="flex min-w-0" style={{ textIndent: 0 }}>
			<GrowTextArea value={value} autoFocus onChange={commit} onBlur={onEndEdit} />
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

/**
 * Auto-growing textarea matching the row's mono metrics exactly (12px / 16px
 * line-height, no padding), so inline editing keeps the surface flush.
 */
function GrowTextArea({
	value,
	autoFocus,
	onChange,
	onBlur,
}: {
	value: string;
	autoFocus?: boolean;
	onChange: (value: string) => void;
	onBlur: () => void;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [value]);

	return (
		<textarea
			ref={ref}
			value={value}
			autoFocus={autoFocus}
			rows={1}
			spellCheck={false}
			onClick={(event) => event.stopPropagation()}
			onChange={(event) => onChange(event.target.value)}
			onBlur={onBlur}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}}
			className="m-0 min-h-4 w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono outline-none"
				style={{ ...editorTypeStyle, minHeight: LINE_HEIGHT_PX, color: EDITOR_COLORS.fg }}
		/>
	);
}

// ---------------------------------------------------------------------------
// Drag physics (pointer-event based)
//
// Native HTML5 drag-and-drop cannot render a scaled, semi-transparent
// multi-line ghost that we control frame-by-frame (setDragImage only accepts a
// static snapshot taken at dragstart and cannot be restyled), and it gives no
// reliable pointer coordinates on all platforms. So the drag layer is built on
// pointer events: we own the ghost, the insertion line, and the drop flash.
// The actual reorder still routes through moveNear → movePromptBlockNodeByIdWithStep.
// ---------------------------------------------------------------------------

interface DragState {
	/** Node being dragged. */
	nodeId: string;
	/**
	 * Every rendered line of the block, so the floating ghost shows the WHOLE
	 * block ("you can see the overview"), react-beautiful-dnd style — not just
	 * the first few lines.
	 */
	ghostLines: string[];
	/** Total line count of the dragged block, for the "N lines" badge. */
	lineCount: number;
	/** Pixel width of the grabbed row, so the ghost matches the source width. */
	width: number;
	/** Current pointer position (viewport coords). */
	x: number;
	y: number;
	/** Pointer offset within the grabbed row, so the ghost tracks naturally. */
	offsetX: number;
	offsetY: number;
}

interface DropTargetState {
	/** Row index (in `lines`) the insertion line snaps above. */
	rowIndex: number;
	/** y position (viewport) of the insertion line. */
	y: number;
	/** Indent depth of the drop target, so into-a-section vs between-sections differ. */
	depth: number;
}

interface XmlDragApi {
	draggingId: string | null;
	drag: DragState | null;
	dropTarget: DropTargetState | null;
	flashNodeId: string | null;
	startDrag: (event: React.PointerEvent<HTMLElement>, nodeId: string) => void;
}

function useXmlDrag({
	lines,
	nodeRanges,
	entriesById,
	rowsRef,
	scrollRef,
	moveNear,
}: {
	lines: readonly XmlLine[];
	nodeRanges: Map<string, { start: number; end: number }>;
	entriesById: Map<string, PromptEditorTreeEntry>;
	rowsRef: React.RefObject<HTMLDivElement | null>;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	moveNear: (sourceId: string, targetId: string, side: "before" | "after") => void;
}): XmlDragApi {
	const [drag, setDrag] = useState<DragState | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
	const [flashNodeId, setFlashNodeId] = useState<string | null>(null);

	// Live refs so the window-level pointer handlers always read current data
	// without re-subscribing on every render.
	const dragRef = useRef<DragState | null>(null);
	const dropRef = useRef<DropTargetState | null>(null);
	dragRef.current = drag;
	dropRef.current = dropTarget;

	const linesRef = useRef(lines);
	const rangesRef = useRef(nodeRanges);
	const entriesRef = useRef(entriesById);
	linesRef.current = lines;
	rangesRef.current = nodeRanges;
	entriesRef.current = entriesById;

	/**
	 * Given a pointer y, find the valid insertion boundary: the row gap between
	 * two sibling blocks of the dragged node's parent. Only siblings are legal
	 * targets (moveNear enforces same parentPath), so the insertion line only
	 * appears over reorderable boundaries.
	 */
	const computeDrop = useCallback(
		(clientY: number): DropTargetState | null => {
			const source = dragRef.current;
			const rowsEl = rowsRef.current;
			if (!source || !rowsEl) return null;
			const sourceEntry = entriesRef.current.get(source.nodeId);
			if (!sourceEntry) return null;

			// Siblings that share the dragged block's parent path, in order.
			const siblings = [...entriesRef.current.values()]
				.filter((entry) => samePath(entry.parentPath, sourceEntry.parentPath))
				.sort((a, b) => a.index - b.index);
			if (siblings.length === 0) return null;

			// Build candidate insertion points: before each sibling and after the
			// last one. Each maps to a moveNear(target, side) that is a real move.
			// y is read live from the boundary row's rect so wrapped rows and
			// scroll position never desync the insertion line.
			type Candidate = { rowIndex: number; y: number; depth: number };
			const rowRect = (rowIndex: number): DOMRect | null => {
				const el = rowsEl.querySelector<HTMLElement>(
					`[data-row-index="${rowIndex}"]`,
				);
				return el ? el.getBoundingClientRect() : null;
			};

			const candidates: Candidate[] = [];
			for (const sib of siblings) {
				const range = rangesRef.current.get(sib.id);
				const rect = range ? rowRect(range.start) : null;
				if (!range || !rect) continue;
				candidates.push({ rowIndex: range.start, y: rect.top, depth: sib.depth });
			}
			const last = siblings[siblings.length - 1];
			const lastRange = last ? rangesRef.current.get(last.id) : undefined;
			const lastRect = lastRange ? rowRect(lastRange.end) : null;
			if (last && lastRange && lastRect) {
				candidates.push({
					rowIndex: lastRange.end + 1,
					y: lastRect.bottom,
					depth: last.depth,
				});
			}

			// Snap to the nearest boundary the pointer is closest to.
			let best: Candidate | null = null;
			let bestDist = Number.POSITIVE_INFINITY;
			for (const candidate of candidates) {
				const dist = Math.abs(candidate.y - clientY);
				if (dist < bestDist) {
					bestDist = dist;
					best = candidate;
				}
			}
			return best;
		},
		[rowsRef],
	);

	/** Resolve a drop boundary to a moveNear(target, side) and execute it. */
	const commitDrop = useCallback(
		(target: DropTargetState, sourceId: string) => {
			const sourceEntry = entriesRef.current.get(sourceId);
			if (!sourceEntry) return;
			const siblings = [...entriesRef.current.values()]
				.filter((entry) => samePath(entry.parentPath, sourceEntry.parentPath))
				.sort((a, b) => a.index - b.index);

			// Which sibling starts at (or owns the boundary just before) this row?
			const before = siblings.find((sib) => {
				const range = rangesRef.current.get(sib.id);
				return range?.start === target.rowIndex;
			});
			if (before) {
				moveNear(sourceId, before.id, "before");
				return;
			}
			// Boundary after the last sibling.
			const last = siblings[siblings.length - 1];
			if (last) moveNear(sourceId, last.id, "after");
		},
		[moveNear],
	);

	const startDrag = useCallback(
		(event: React.PointerEvent<HTMLElement>, nodeId: string) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const range = rangesRef.current.get(nodeId);
			if (!range) return;
			const rowsEl = rowsRef.current;
			const rowEl = rowsEl?.querySelector<HTMLElement>(
				`[data-row-index="${range.start}"]`,
			);
			const rect = rowEl?.getBoundingClientRect();
			// The whole block, in order, so the ghost is a faithful overview.
			const ghostLines = linesRef.current
				.slice(range.start, range.end + 1)
				.map((line) => (line.text.length === 0 ? " " : line.text));

			setDrag({
				nodeId,
				ghostLines,
				lineCount: range.end - range.start + 1,
				width: rect ? rect.width : 320,
				x: event.clientX,
				y: event.clientY,
				offsetX: rect ? event.clientX - rect.left : 12,
				offsetY: rect ? event.clientY - rect.top : 8,
			});
			setDropTarget(null);
		},
		[rowsRef],
	);

	// Window-level pointer tracking while a drag is active. Registered only
	// while `drag` is set so it never runs at rest.
	useEffect(() => {
		if (!drag) return;

		function onMove(event: PointerEvent) {
			const current = dragRef.current;
			if (!current) return;
			setDrag({ ...current, x: event.clientX, y: event.clientY });
			setDropTarget(computeDrop(event.clientY));

			// Auto-scroll when the pointer nears the viewport edges of the list.
			const scroller = scrollRef.current;
			if (scroller) {
				const rect = scroller.getBoundingClientRect();
				const edge = 28;
				if (event.clientY < rect.top + edge) scroller.scrollTop -= 8;
				else if (event.clientY > rect.bottom - edge) scroller.scrollTop += 8;
			}
		}

		function onUp() {
			const source = dragRef.current;
			const target = dropRef.current;
			if (source && target) {
				commitDrop(target, source.nodeId);
				// ~200ms background flash on the moved block's new range.
				setFlashNodeId(source.nodeId);
				window.setTimeout(() => setFlashNodeId(null), 220);
			}
			setDrag(null);
			setDropTarget(null);
		}

		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setDrag(null);
				setDropTarget(null);
			}
		}

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("keydown", onKey);
		};
	}, [drag, computeDrop, commitDrop, scrollRef]);

	return {
		draggingId: drag?.nodeId ?? null,
		drag,
		dropTarget,
		flashNodeId,
		startDrag,
	};
}

/**
 * Floating ghost of the dragged block that follows the cursor. Renders the
 * WHOLE block at slight scale/transparency so the drag reads as lifting the
 * entire object out (react-beautiful-dnd feel). Only when a block is taller
 * than ~60% of the viewport is the ghost capped, with the bottom edge faded so
 * it's obvious more content continues below.
 */
function DragGhost({ drag }: { drag: XmlDragApi }) {
	if (!drag.drag) return null;
	const state = drag.drag;
	const maxHeight = Math.round(window.innerHeight * 0.6);
	const capped = state.ghostLines.length * LINE_HEIGHT_PX + 12 > maxHeight;
	return (
		<div
			className="pointer-events-none fixed z-50 origin-top-left font-mono"
			style={{
				...editorTypeStyle,
				left: state.x - state.offsetX,
				top: state.y - state.offsetY,
				width: state.width,
				transform: "scale(0.97)",
				opacity: 0.85,
			}}
		>
			<div
				className="relative overflow-hidden rounded-[3px] border border-status-success/45 py-1 pl-3 pr-6 shadow-xl"
				style={{
					background: EDITOR_COLORS.bg,
					color: EDITOR_COLORS.fg,
					...(capped ? { maxHeight } : {}),
				}}
			>
				{state.ghostLines.map((text, index) => (
					<div key={index} className="overflow-hidden whitespace-pre text-ellipsis">
						{hasXmlTags(text) ? highlightXmlLine(text) : text}
					</div>
				))}
				{/* Fade the bottom edge only when the block is capped, signalling
				    that more lines continue past the ghost. */}
				{capped && (
					<div
						className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
						style={{
							background: `linear-gradient(to bottom, transparent, ${EDITOR_COLORS.bg})`,
						}}
					/>
				)}
				<span className="absolute -right-2 -top-2 rounded-full bg-status-success px-1.5 py-px text-[9px] font-medium text-background shadow">
					{state.lineCount} {state.lineCount === 1 ? "line" : "lines"}
				</span>
			</div>
		</div>
	);
}

/**
 * Full-width 2px accent insertion line snapping to a valid boundary. Its left
 * edge is indented to the target nesting depth, so dropping into a section
 * reads differently from dropping between top-level sections.
 */
function DropIndicator({
	drag,
	gutterWidth,
}: {
	drag: XmlDragApi;
	gutterWidth: string;
}) {
	const target = drag.dropTarget;
	if (!drag.drag || !target) return null;
	return (
		<div
			className="pointer-events-none fixed z-40 flex items-center"
			style={{
				left: 0,
				right: 0,
				top: target.y - 1,
			}}
		>
			<div
				className="h-[2px] flex-1 bg-status-success"
				style={{
					marginLeft: `calc(${gutterWidth} + ${target.depth * INDENT_CH + 0.5}ch)`,
				}}
			/>
		</div>
	);
}

function editorValueForLine(node: PromptBlockNode, line: XmlLine): string {
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

function commitEdit(
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

interface NodeRange {
	start: number;
	end: number;
}

/** First and last row index (in `lines`) owned by each node id. */
function computeNodeRanges(lines: readonly XmlLine[]): Map<string, NodeRange> {
	const ranges = new Map<string, NodeRange>();
	lines.forEach((line, index) => {
		if (line.role === "gap") return;
		const existing = ranges.get(line.nodeId);
		if (!existing) ranges.set(line.nodeId, { start: index, end: index });
		else existing.end = index;
	});
	return ranges;
}

interface Guide {
	nodeId: string;
	start: number;
	end: number;
	depth: number;
}

/**
 * One bracket-style indent guide per container node (section / example /
 * contextUsage): a hairline from its open-tag row to its close-tag row at the
 * container's own indent level (VS Code bracket-guide idiom). Nested containers
 * are included — they are cheap and reinforce structure.
 */
function computeGuides(
	lines: readonly XmlLine[],
	ranges: Map<string, NodeRange>,
): Guide[] {
	const guides: Guide[] = [];
	const seen = new Set<string>();
	lines.forEach((line) => {
		if (line.role !== "open") return;
		if (seen.has(line.nodeId)) return;
		seen.add(line.nodeId);
		const range = ranges.get(line.nodeId);
		if (!range || range.end <= range.start) return;
		guides.push({
			nodeId: line.nodeId,
			start: range.start,
			end: range.end,
			depth: line.depth,
		});
	});
	return guides;
}

/**
 * Row indices that open a TOP-LEVEL section-like container. These get the
 * faint landmark tint so section starts scan at a glance.
 */
function computeLandmarks(lines: readonly XmlLine[]): Set<number> {
	const rows = new Set<number>();
	lines.forEach((line, index) => {
		if (line.role === "open" && line.depth === 0) rows.add(index);
	});
	return rows;
}

interface RowMetric {
	/** Offset of the row's top, relative to the rows container. */
	top: number;
	/** Rendered height of the row (one line-height, or more when wrapped). */
	height: number;
}

/**
 * Measures each row's top/height relative to the rows container. Rows sit on a
 * strict line grid at rest but grow when their content wraps, so overlays that
 * span multiple rows (indent guides, drop insertion line) must read real
 * offsets rather than multiplying an index by a fixed pitch. Re-measures on
 * mount, on line-count change, and whenever the container resizes.
 */
function useRowMetrics(
	rowsRef: React.RefObject<HTMLDivElement | null>,
	lineCount: number,
): RowMetric[] {
	const [metrics, setMetrics] = useState<RowMetric[]>([]);

	useLayoutEffect(() => {
		const container = rowsRef.current;
		if (!container) return;

		const measure = () => {
			const rows = container.querySelectorAll<HTMLElement>("[data-row-index]");
			const next: RowMetric[] = new Array(rows.length);
			rows.forEach((row) => {
				const index = Number(row.dataset.rowIndex);
				if (Number.isNaN(index)) return;
				next[index] = { top: row.offsetTop, height: row.offsetHeight };
			});
			setMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [rowsRef, lineCount]);

	return metrics;
}

function sameMetrics(a: RowMetric[], b: RowMetric[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (!x || !y) {
			if (x !== y) return false;
			continue;
		}
		if (x.top !== y.top || x.height !== y.height) return false;
	}
	return true;
}

function leadingIndent(text: string): number {
	const match = text.match(/^ */);
	return match ? match[0].length : 0;
}
