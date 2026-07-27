import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import {
	DoctorPanel,
	UsageStrip,
	UsageSummaryPanel,
	findSpanInTree,
	type RunUsageRow,
	type UsageContext
} from "@agent-kernel/viewer-ui";
import { KernelTraceViewer, type KernelTraceViewerProps } from "@agent-kernel/viewer-shell";

import { KERNEL_TRACE_API_BASE } from "../../lib/api";
import type { TraceIconSettings } from "../../lib/style-settings";
import { isSelectedTrace, traceStatusClass } from "../../lib/trace-ui";

type TraceWorkspaceProps = {
	detail: KernelTraceSessionDetail | null;
	spans: KernelTraceViewerProps["spans"];
	traceSessions: KernelTraceSessionSummary[];
	selectedTraceSessionId: string | null;
	loading: boolean;
	deletingTraceId: string | null;
	onTraceSelect: (traceSessionId: string) => void;
	onTraceDelete: (traceSessionId: string) => void;
	traceIcons: TraceIconSettings;
};

function shortId(value: string): string {
	return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function isActiveTrace(status: string): boolean {
	return status === "active" || status === "queued" || status === "running";
}

/**
 * Trace workspace with drill-in navigation:
 *   - LIST mode: the full trace list (with per-trace delete + Doctor panel)
 *     owns the whole workspace width.
 *   - TRACE mode: one compact header bar ("‹ All traces" + title + state
 *     badge + overflow menu) and 100% of the remaining space serves the
 *     span tree + detail panel. Delete lives behind the "…" menu only.
 */
export function TraceWorkspace({
	detail,
	spans,
	traceSessions,
	selectedTraceSessionId,
	loading,
	deletingTraceId,
	onTraceSelect,
	onTraceDelete,
	traceIcons
}: TraceWorkspaceProps) {
	// Drill-in state: the list is an explicit destination ("‹ All traces"),
	// not a persistent sidebar. Trace selection itself stays in App.
	const [listOpen, setListOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	// Usage view lives in the detail column; selecting a span always wins over it.
	const [usageViewOpen, setUsageViewOpen] = useState(false);
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	// Reset per-trace so a fresh selection opens the new trace's traces, not stale.
	useEffect(() => {
		setSelectedSpanId(null);
		setUsageViewOpen(false);
		setMenuOpen(false);
	}, [detail?.session.id]);

	const handleSelectedIdChange = useCallback((id: string | null) => {
		setSelectedSpanId(id);
		if (id !== null) setUsageViewOpen(false);
	}, []);

	// A run's own `run:<id>` span only exists when its pi session had >1 run
	// (single-run sessions aren't wrapped); fall back to the pi session span so
	// the click always lands on the run's place in the tree.
	const handleRunSelect = useCallback(
		(row: RunUsageRow) => {
			const runSpanId = `run:${row.id}`;
			const target = findSpanInTree(spans, runSpanId)
				? runSpanId
				: `pi:${row.piSessionId}`;
			setSelectedSpanId(target);
			setUsageViewOpen(false);
		},
		[spans]
	);

	const toggleUsageView = useCallback(() => {
		setUsageViewOpen((open) => {
			const next = !open;
			if (next) setSelectedSpanId(null);
			return next;
		});
	}, []);

	const usageContext = useMemo<UsageContext | undefined>(
		() =>
			detail
				? {
						runs: detail.agent_runs,
						container: detail.container ?? null,
						onRunSelect: handleRunSelect
					}
				: undefined,
		[detail, handleRunSelect]
	);

	const selectedTrace = useMemo(
		() =>
			traceSessions.find((trace) =>
				isSelectedTrace(trace, selectedTraceSessionId, detail)
			) ?? null,
		[detail, selectedTraceSessionId, traceSessions]
	);

	const handleListSelect = useCallback(
		(traceSessionId: string) => {
			onTraceSelect(traceSessionId);
			setListOpen(false);
		},
		[onTraceSelect]
	);

	const handleBack = useCallback(() => {
		setListOpen(true);
		setMenuOpen(false);
	}, []);

	const handleHeaderDelete = useCallback(() => {
		if (!selectedTrace) return;
		setMenuOpen(false);
		// Deleting the trace you are inside means you are done with it: return
		// to the list either way (the confirm dialog may still cancel the
		// actual deletion in App).
		setListOpen(true);
		onTraceDelete(selectedTrace.id);
	}, [onTraceDelete, selectedTrace]);

	const showList = listOpen || !detail;

	const traceTitle = selectedTrace?.topic ?? selectedTrace?.label ?? "Trace";
	const traceStatus = selectedTrace?.status ?? detail?.session.status ?? "unknown";
	const metadataSlug = selectedTrace?.metadata?.sessionSlug;
	const traceSessionLabel =
		typeof metadataSlug === "string" && metadataSlug.length > 0
			? metadataSlug
			: selectedTrace
				? shortId(selectedTrace.containerId)
				: null;
	const deleteDisabled =
		loading || deletingTraceId !== null || isActiveTrace(traceStatus);

	return (
		<section className="flex h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
			{showList ? (
				<>
					<div className="flex h-[var(--research-header-height)] shrink-0 items-center border-b border-border px-4">
						<div className="flex w-full items-center justify-between gap-3">
							<div>
								<h2 className="font-display text-lg font-bold leading-tight">Traces</h2>
								<p className="mt-1 text-xs text-muted-foreground">
									{traceSessions.length} database {traceSessions.length === 1 ? "trace" : "traces"}
								</p>
							</div>
							{loading && (
								<span className="rounded-[2px] border border-border px-2 py-1 text-xs text-muted-foreground">
									Loading
								</span>
							)}
						</div>
					</div>

					<div className="shrink-0 border-b border-border px-3 py-2">
						<DoctorPanel endpoint="/api/doctor" />
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						{traceSessions.length === 0 && !loading ? (
							<div className="px-3 py-8 text-center text-sm text-muted-foreground">
								No traces found.
							</div>
						) : (
							<div className="min-w-0">
								<div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_90px_48px] gap-2 border-b border-border bg-card/95 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
									<span>Research</span>
									<span className="text-right">State</span>
									<span className="text-right">Del</span>
								</div>
								{traceSessions.map((trace) => {
									const selected = isSelectedTrace(trace, selectedTraceSessionId, detail);
									const researchTitle = trace.topic ?? trace.label;
									const rowSlug = trace.metadata?.sessionSlug;
									const sessionLabel =
										typeof rowSlug === "string" && rowSlug.length > 0
											? rowSlug
											: shortId(trace.containerId);
									const deleting = deletingTraceId === trace.id || deletingTraceId === trace.containerId;
									const rowDeleteDisabled = loading || deleting || isActiveTrace(trace.status);

									return (
										<div
											key={`${trace.id}:${trace.containerId}`}
											className={`relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)_90px_48px] items-center gap-2 border-b border-border/70 text-left transition-colors ${
												selected
													? "bg-status-info-fill/30 text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-status-info-border"
													: "text-muted-foreground hover:bg-muted/35 hover:text-foreground"
											}`}
										>
											<button
												type="button"
												onClick={() => handleListSelect(trace.id)}
												className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_90px] items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
											>
												<span className="min-w-0">
													<span className="block truncate text-[13px] font-bold leading-5">{researchTitle}</span>
													<span className="block truncate text-[11px] leading-4 text-muted-foreground">
														Session {sessionLabel}
													</span>
												</span>
												<span
													className={`justify-self-end rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase ${traceStatusClass(
														trace.status
													)}`}
												>
													{trace.status}
												</span>
											</button>
											<button
												type="button"
												disabled={rowDeleteDisabled}
												onClick={() => onTraceDelete(trace.id)}
												aria-label={`Delete trace ${researchTitle}`}
												title={
													isActiveTrace(trace.status)
														? "Cannot delete queued or running traces"
														: `Delete ${researchTitle}`
												}
												className="mr-2 h-7 w-8 justify-self-end rounded-[2px] border border-destructive/40 text-[10px] font-bold uppercase text-destructive transition-colors hover:border-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-60"
											>
												{deleting ? "..." : "Del"}
											</button>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</>
			) : (
				<>
					{/* Compact drill-in header: back + title + state. No trace list,
					    no prominent delete — the tree + detail own the width. */}
					<div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
						<button
							type="button"
							onClick={handleBack}
							className="flex shrink-0 items-center gap-1.5 rounded-[2px] border border-border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
						>
							<span aria-hidden="true">‹</span>
							All traces
						</button>
						<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
						<h2
							className="min-w-0 truncate text-sm font-bold leading-tight text-foreground"
							title={traceTitle}
						>
							{traceTitle}
						</h2>
						<span
							className={`shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase ${traceStatusClass(
								traceStatus
							)}`}
						>
							{traceStatus}
						</span>
						{traceSessionLabel && (
							<span className="hidden shrink-0 truncate text-[11px] text-muted-foreground md:inline">
								Session {traceSessionLabel}
							</span>
						)}
						<div className="ml-auto flex shrink-0 items-center gap-2">
							{loading && (
								<span className="rounded-[2px] border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
									Loading
								</span>
							)}
							<button
								type="button"
								onClick={() => setMenuOpen((open) => !open)}
								aria-label="Trace actions"
								aria-haspopup="menu"
								aria-expanded={menuOpen}
								className="rounded-[2px] border border-border px-2 py-1 text-[11px] font-bold leading-none text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
							>
								…
							</button>
						</div>
						{menuOpen && (
							<>
								<button
									type="button"
									aria-hidden="true"
									tabIndex={-1}
									onClick={() => setMenuOpen(false)}
									className="fixed inset-0 z-30 cursor-default"
								/>
								<div
									role="menu"
									className="absolute right-3 top-full z-40 mt-1 w-44 rounded-[3px] border border-border bg-card py-1 shadow-xl"
								>
									<button
										type="button"
										role="menuitem"
										disabled={deleteDisabled}
										onClick={handleHeaderDelete}
										title={
											isActiveTrace(traceStatus)
												? "Cannot delete queued or running traces"
												: undefined
										}
										className="block w-full px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
									>
										Delete trace…
									</button>
								</div>
							</>
						)}
					</div>

					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{loading && !detail ? (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								Loading kernel trace...
							</div>
						) : !detail ? (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								Select a trace.
							</div>
						) : (
							<>
								<UsageStrip
									className="shrink-0"
									container={detail.container ?? null}
									runs={detail.agent_runs}
									sessions={detail.pi_sessions}
									active={usageViewOpen}
									onToggle={toggleUsageView}
								/>
								<KernelTraceViewer
									className="flex min-h-0 flex-1 flex-col"
									spans={spans}
									initialTraceLevel={2}
									apiBase={KERNEL_TRACE_API_BASE}
									selectedId={selectedSpanId}
									onSelectedIdChange={handleSelectedIdChange}
									usageContext={usageContext}
									plugins={{
										detailOverride: usageViewOpen ? (
											<div className="flex h-full flex-col">
												<div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
													<span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
														Usage summary
													</span>
													<button
														type="button"
														onClick={toggleUsageView}
														className="rounded-[2px] border border-border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
													>
														Close
													</button>
												</div>
												<div className="min-h-0 flex-1 overflow-y-auto">
													<UsageSummaryPanel
														container={detail.container ?? null}
														runs={detail.agent_runs}
														sessions={detail.pi_sessions}
														onRunSelect={handleRunSelect}
													/>
												</div>
											</div>
										) : undefined
									}}
									iconSide={traceIcons.side}
									iconStyle={traceIcons.style}
								/>
							</>
						)}
					</div>
				</>
			)}
		</section>
	);
}
