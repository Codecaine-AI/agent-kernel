// Slice: pointer-drag physics + overlays — ghost, insertion line, drop flash.
//
// Native HTML5 drag-and-drop cannot render a scaled, semi-transparent
// multi-line ghost that we control frame-by-frame (setDragImage only accepts a
// static snapshot taken at dragstart and cannot be restyled), and it gives no
// reliable pointer coordinates on all platforms. So the drag layer is built on
// pointer events: we own the ghost, the insertion line, and the drop flash.
// The actual reorder still routes through moveNear → movePromptBlockNodeByIdWithStep.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptEditorTreeEntry } from "@codecaine-ai/prompt-kit/ui";

import { EDITOR_COLORS, editorTypeStyle, LINE_HEIGHT_PX } from "../../../shared/editor-surface";
import { hasXmlTags, highlightXmlLine } from "../../../shared/xml-highlight";
import { samePath } from "../PromptFlowShared";
import type { XmlLine } from "../xml-line-model";
import { INDENT_CH } from "./node-geometry";

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

export interface XmlDragApi {
	draggingId: string | null;
	drag: DragState | null;
	dropTarget: DropTargetState | null;
	flashNodeId: string | null;
	startDrag: (event: React.PointerEvent<HTMLElement>, nodeId: string) => void;
}

export function useXmlDrag({
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
export function DragGhost({ drag }: { drag: XmlDragApi }) {
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
export function DropIndicator({
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
