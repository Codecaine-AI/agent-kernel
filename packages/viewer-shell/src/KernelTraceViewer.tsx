"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import {
	SpanDetailPanel,
	TreeView,
	collectSpanIds,
	filterSpansByTraceLevel,
	findSpanInTree,
} from "@agent-kernel/viewer-ui";

const LEVEL_LABELS: readonly string[] = [
	"Conversation",
	"Tools",
	"Full",
	"Debug",
];

export interface KernelViewerPlugins {
	containerHeader?: ReactNode;
	treeToolbarTrailing?: ReactNode;
	emptyState?: ReactNode;
	detailPlaceholder?: ReactNode;
}

export interface KernelTraceViewerProps {
	spans: TraceSpan[];
	className?: string;
	initialTraceLevel?: number;
	selectedId?: string | null;
	onSelectedIdChange?: (id: string | null) => void;
	plugins?: KernelViewerPlugins;
}

export function KernelTraceViewer({
	spans,
	className,
	initialTraceLevel = 1,
	selectedId: controlledSelectedId,
	onSelectedIdChange,
	plugins,
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
		setExpandedSpansIds(spans.map((span) => span.id));
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
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						No events yet
					</div>
				)}
			</div>
		);
	}

	return (
		<div className={className}>
			{plugins?.containerHeader}
			<div className="flex min-h-0 flex-1 gap-3">
				<div className="flex w-[62.5%] min-h-0 flex-col overflow-hidden rounded-md border border-border/60">
					<div className="flex items-center gap-3 border-b border-border/60 px-3 py-2 text-[10px] font-display uppercase text-muted-foreground/80">
						{LEVEL_LABELS.map((label, idx) => (
							<span
								key={label}
								className={idx === level ? "text-foreground" : "text-muted-foreground/60"}
							>
								L{idx} {label}
							</span>
						))}
						<input
							type="range"
							min={0}
							max={3}
							step={1}
							value={level}
							onChange={(event) => setLevel(Number(event.target.value))}
							className="w-40 accent-foreground"
							aria-label="Trace level"
						/>
						{plugins?.treeToolbarTrailing}
						<button
							type="button"
							onClick={toggleExpandAll}
							className="ml-auto rounded border border-border/60 px-2 py-0.5 text-[10px] font-display uppercase text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
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
						/>
					</div>
				</div>
				<div className="w-[37.5%] overflow-hidden rounded-md border border-border/60">
					{selectedSpan ? (
						<SpanDetailPanel span={selectedSpan} />
					) : (
						plugins?.detailPlaceholder ?? <SpanDetailPanel span={null} />
					)}
				</div>
			</div>
		</div>
	);
}
