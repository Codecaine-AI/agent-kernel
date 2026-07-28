"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import {
	SpanDetailPanel,
	DetailBlocksProvider,
	TraceIconSettingsProvider,
	TraceViewerApiContext,
	TreeView,
	collectSpanIds,
	filterSpansByTraceLevel,
	findSpanInTree,
	type DetailBlockProvider,
	type SpanCardViewOptions,
	type TraceViewerApiContextValue,
	type UsageContext,
} from "@agent-kernel/viewer-ui";

import { TraceLevelSlider, type TraceLevelInfo } from "./TraceLevelSlider";

const TRACE_LEVELS: readonly TraceLevelInfo[] = [
	{
		marker: "L0",
		name: "Conversation",
		description:
			"High-level conversation: user messages, assistant replies, and ask prompts.",
	},
	{
		marker: "L1",
		name: "Tools",
		description: "Adds tool calls and their results.",
	},
	{
		marker: "L2",
		name: "Full",
		description: "Adds system prompts, context, and processing detail.",
	},
	{
		marker: "L3",
		name: "Debug",
		description:
			"Adds low-level internal and lifecycle events for deep debugging.",
	},
];

export interface KernelViewerPlugins {
	containerHeader?: ReactNode;
	treeToolbarTrailing?: ReactNode;
	emptyState?: ReactNode;
	detailPlaceholder?: ReactNode;
	/**
	 * When present AND no span is selected, this node takes over the detail
	 * column (in place of the placeholder). The workspace uses it to surface the
	 * full usage summary when the usage strip is toggled; selecting any span
	 * clears the override and returns to span detail.
	 */
	detailOverride?: ReactNode;
	/**
	 * Rich-detail extension point: called for the selected span; a non-null
	 * result takes over the detail column (canvas uses it for the transcript
	 * tool-call inspector). Null falls back to the standard SpanDetailPanel.
	 */
	renderSpanDetail?: (span: TraceSpan) => ReactNode | null;
}

export interface KernelTraceViewerProps {
	spans: TraceSpan[];
	className?: string;
	initialTraceLevel?: number;
	selectedId?: string | null;
	onSelectedIdChange?: (id: string | null) => void;
	plugins?: KernelViewerPlugins;
	/**
	 * Workspace usage data forwarded to the detail panel so container / phase /
	 * agent-session / run spans render a usage aggregate instead of dead-ending.
	 */
	usageContext?: UsageContext;
	/**
	 * Which outer edge the per-span scannability chip abuts, and its treatment
	 * (hollow outline vs. accent-filled solid). Forwarded to every SpanCard.
	 */
	iconSide?: SpanCardViewOptions["iconSide"];
	iconStyle?: SpanCardViewOptions["iconStyle"];
	/**
	 * Base URL of the kernel trace read API. When set, detail renderers that
	 * reference content-addressed payloads (e.g. pi_request_snapshot) can fetch
	 * blobs / per-turn context on demand; when absent they degrade to their
	 * offline summaries.
	 */
	apiBase?: string;
	/** Additive, data-only blocks merged into the standard detail body. */
	detailBlockProvider?: DetailBlockProvider;
}

export function KernelTraceViewer({
	spans,
	className,
	initialTraceLevel = 2,
	selectedId: controlledSelectedId,
	onSelectedIdChange,
	plugins,
	usageContext,
	iconSide,
	iconStyle,
	apiBase,
	detailBlockProvider,
}: KernelTraceViewerProps) {
	const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
	const [expandedSpansIds, setExpandedSpansIds] = useState<string[]>([]);
	const [level, setLevel] = useState<number>(initialTraceLevel);
	const didInitExpand = useRef(false);

	// Tree/detail split. The tree is mostly short labels; the detail panel is
	// where reading happens, so it gets the majority by default (40/60). The
	// divider is draggable within sane bounds.
	const [treePct, setTreePct] = useState(40);
	const splitRef = useRef<HTMLDivElement | null>(null);

	const handleDividerMouseDown = useCallback((event: ReactMouseEvent) => {
		event.preventDefault();
		const container = splitRef.current;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const onMove = (e: MouseEvent) => {
			if (rect.width <= 0) return;
			const pct = ((e.clientX - rect.left) / rect.width) * 100;
			setTreePct(Math.min(65, Math.max(25, pct)));
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	const selectedId = controlledSelectedId ?? internalSelectedId;
	const setSelectedId = (id: string | null) => {
		setInternalSelectedId(id);
		onSelectedIdChange?.(id);
	};

	useEffect(() => {
		if (didInitExpand.current || spans.length === 0) return;
		didInitExpand.current = true;
		// Expand the entire tree (recursively) on first load.
		setExpandedSpansIds(collectSpanIds(spans));
	}, [spans]);

	const filteredSpans = useMemo(
		() => filterSpansByTraceLevel(spans, level),
		[spans, level],
	);

	const allExpanded = useMemo(() => {
		const total = collectSpanIds(filteredSpans).length;
		return total > 0 && expandedSpansIds.length >= total;
	}, [expandedSpansIds, filteredSpans]);

	const selectedSpan = useMemo(
		() => (selectedId ? findSpanInTree(filteredSpans, selectedId) : null),
		[filteredSpans, selectedId],
	);

	const apiContextValue = useMemo<TraceViewerApiContextValue>(
		() => ({ apiBase: apiBase ?? null }),
		[apiBase],
	);

	const spanCardViewOptions = useMemo<SpanCardViewOptions | undefined>(
		() =>
			iconSide === undefined && iconStyle === undefined
				? undefined
				: { iconSide, iconStyle },
		[iconSide, iconStyle],
	);

	const toggleExpandAll = () => {
		if (allExpanded) {
			setExpandedSpansIds([]);
		} else {
			setExpandedSpansIds(collectSpanIds(filteredSpans));
		}
	};

	if (spans.length === 0) {
		return (
			<div className={className}>
				{plugins?.containerHeader}
				{plugins?.emptyState ?? (
					<div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
						No events yet
					</div>
				)}
			</div>
		);
	}

	return (
		// The detail panel's message cards wear the same cap treatment as the tree
		// (see viewer-ui icon-settings), so the style rail's choice is provided
		// once here for BOTH panes instead of only reaching SpanCard.
		<TraceIconSettingsProvider side={iconSide} style={iconStyle}>
			<div className={className}>
				{plugins?.containerHeader}
				<div ref={splitRef} className="flex min-h-0 flex-1 font-mono">
					<div
						className="flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-border bg-card"
						style={{ width: `${treePct}%` }}
					>
						<div // Shared panel-header surface: bg-background over border-b border-border (the detail header's original dark base surface) —
						// the SAME token pair the workspace drill-in header uses (and the
						// detail panel header should adopt) so panel tops color-match.
						className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-3">
							<TraceLevelSlider
								levels={TRACE_LEVELS}
								value={level}
								onChange={setLevel}
							/>
							{plugins?.treeToolbarTrailing}
							<button
								type="button"
								onClick={toggleExpandAll}
								className="ml-auto rounded-[2px] border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-status-success-border hover:text-status-success"
							>
								{allExpanded ? "Collapse All" : "Expand All"}
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<TreeView
								spans={filteredSpans}
								selectedSpan={selectedSpan ?? undefined}
								onSpanSelect={(span) => setSelectedId(span.id)}
								expandedSpansIds={expandedSpansIds}
								onExpandSpansIdsChange={setExpandedSpansIds}
								spanCardViewOptions={spanCardViewOptions}
							/>
						</div>
					</div>
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize tree and detail panels"
						title="Drag to resize"
						onMouseDown={handleDividerMouseDown}
						className="group flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
					>
						<div className="w-px bg-border transition-colors group-hover:bg-status-info-border group-active:bg-status-info-border" />
					</div>
					<div className="min-w-0 flex-1 overflow-hidden rounded-[3px] border border-border bg-card">
						<TraceViewerApiContext.Provider value={apiContextValue}>
							<DetailBlocksProvider provider={detailBlockProvider ?? null}>
								{selectedSpan ? (
									(plugins?.renderSpanDetail?.(selectedSpan) ?? (
										<SpanDetailPanel span={selectedSpan} usageContext={usageContext} />
									))
								) : (
									plugins?.detailOverride ??
									plugins?.detailPlaceholder ?? <SpanDetailPanel span={null} />
								)}
							</DetailBlocksProvider>
						</TraceViewerApiContext.Provider>
					</div>
				</div>
			</div>
		</TraceIconSettingsProvider>
	);
}
