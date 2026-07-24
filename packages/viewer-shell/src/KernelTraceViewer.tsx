"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import {
	SpanDetailPanel,
	TraceViewerApiContext,
	TreeView,
	collectSpanIds,
	filterSpansByTraceLevel,
	findSpanInTree,
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
}: KernelTraceViewerProps) {
	const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
	const [expandedSpansIds, setExpandedSpansIds] = useState<string[]>([]);
	const [level, setLevel] = useState<number>(initialTraceLevel);
	const didInitExpand = useRef(false);

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
		<div className={className}>
			{plugins?.containerHeader}
			<div className="flex min-h-0 flex-1 gap-3 font-mono">
				<div className="flex w-[62.5%] min-h-0 flex-col overflow-hidden rounded-[3px] border border-border bg-card">
					<div className="flex h-[72px] shrink-0 items-center gap-4 border-b border-border bg-muted/30 px-3">
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
				<div className="w-[37.5%] overflow-hidden rounded-[3px] border border-border bg-card">
					<TraceViewerApiContext.Provider value={apiContextValue}>
						{selectedSpan ? (
							<SpanDetailPanel span={selectedSpan} usageContext={usageContext} />
						) : (
							plugins?.detailOverride ??
							plugins?.detailPlaceholder ?? <SpanDetailPanel span={null} />
						)}
					</TraceViewerApiContext.Provider>
				</div>
			</div>
		</div>
	);
}
