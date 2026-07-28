"use client";

/**
 * KernelTraceWorkspace — the STANDARD trace-viewing workspace, shared by every
 * host app (extracted from simple-research-kernel's TraceWorkspace).
 *
 * Two modes, one component:
 *   LIST mode  — full-width trace/session rows (title + status badge + meta,
 *                optional per-row delete) with an app slot below the header.
 *   DRILL-IN   — a minimal header (back affordance · trace title · quiet
 *                status badge · overflow delete if the host allows deletes —
 *                nothing else) and 100% of the width serving the span tree +
 *                detail panel (KernelTraceViewer: 40/60 split, draggable
 *                divider). No workspace-level usage affordance: usage/runtime
 *                information lives in the detail side (per-event usage +
 *                timing in the header-toggled Details view).
 *
 * The app seam is pure data + slots (see KernelTraceWorkspaceProps): hosts
 * supply rows, detail metadata, spans, and handlers; labels and extras are
 * optional. Row → app-object matching, deletion rules, and fetching stay in
 * the host. LAYOUT-section geometry (--research-workspace-height /
 * -min-height / -header-height / layout padding) is consumed HERE with safe
 * fallbacks, so the style rail's LAYOUT tab is meaningful in every host.
 */
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import type {
	AgentRun,
	KernelContainerSummary,
	PiAgentSession,
} from "@agent-kernel/viewer-core";
import {
	findSpanInTree,
	type RunUsageRow,
	type DetailBlockProvider,
	type UsageContext,
	type SpanCardViewOptions,
} from "@agent-kernel/viewer-ui";

import { KernelTraceViewer } from "../KernelTraceViewer";

/** One list-mode row. Matching rows to app objects stays in the host. */
export interface TraceWorkspaceRow {
	id: string;
	title: string;
	subtitle?: string;
	status: string;
	/** Row delete button disabled (e.g. running traces). Needs onDelete. */
	deleteDisabled?: boolean;
	/** Row delete in flight — shows the busy affordance. */
	deleting?: boolean;
}

/** Drill-in header metadata for the currently open trace. */
export interface TraceWorkspaceDetail {
	/** Stable id — internal span/usage state resets when it changes. */
	id: string;
	title: string;
	status: string;
	subtitle?: string | null;
}

export interface TraceWorkspaceLabels {
	/** List header title. Default "Traces". */
	listTitle?: string;
	/** Count noun, singular. Default "trace". */
	countNoun?: string;
	/** First column header in the list. Default "Trace". */
	rowColumnLabel?: string;
	/** Drill-in back affordance. Default "All traces". */
	backLabel?: string;
}

/** Usage rollup data (strip + summary override). Omit to hide usage UI. */
export interface TraceWorkspaceUsageData {
	container: KernelContainerSummary | null;
	runs: AgentRun[];
	sessions?: PiAgentSession[];
}

export interface KernelTraceWorkspaceProps {
	rows: TraceWorkspaceRow[];
	/** The row currently open (host computes its own matching). */
	selectedRowId: string | null;
	detail: TraceWorkspaceDetail | null;
	spans: TraceSpan[];
	loading?: boolean;
	onSelect: (rowId: string) => void;
	/** Omit entirely to hide every delete affordance (list + overflow). */
	onDelete?: (rowId: string) => void;
	/** status → badge classes; defaults to the shared status mapping. */
	statusClass?: (status: string) => string;
	usageData?: TraceWorkspaceUsageData;
	apiBase?: string;
	iconSide?: SpanCardViewOptions["iconSide"];
	iconStyle?: SpanCardViewOptions["iconStyle"];
	initialTraceLevel?: number;
	labels?: TraceWorkspaceLabels;
	/** Below the list header (e.g. the research app's Doctor panel). */
	listExtras?: ReactNode;
	/** Rendered inside the workspace root (e.g. canvas's overlays). */
	overlays?: ReactNode;
	/** Rich detail takeover for a selected span (see KernelTraceViewer). */
	renderSpanDetail?: (span: TraceSpan, usageContext?: UsageContext) => ReactNode | null;
	/** Additive, data-only blocks merged into the standard detail body. */
	detailBlockProvider?: DetailBlockProvider;
}

/** The standard status→badge mapping (union of both hosts' vocabularies). */
export function defaultTraceStatusClass(status: string): string {
	if (status === "active" || status === "running" || status === "queued") {
		return "border-status-info-border bg-status-info-fill text-status-info";
	}
	if (status === "done" || status === "completed") {
		return "border-status-success-border bg-status-success-fill text-status-success";
	}
	if (status === "error" || status === "aborted" || status === "stopped") {
		return "border-destructive/40 bg-destructive/10 text-destructive";
	}
	return "border-status-neutral-border bg-status-neutral-fill text-status-neutral";
}

export function KernelTraceWorkspace({
	rows,
	selectedRowId,
	detail,
	spans,
	loading = false,
	onSelect,
	onDelete,
	statusClass = defaultTraceStatusClass,
	usageData,
	apiBase,
	iconSide,
	iconStyle,
	initialTraceLevel = 2,
	labels,
	listExtras,
	overlays,
	renderSpanDetail,
	detailBlockProvider,
}: KernelTraceWorkspaceProps) {
	// Drill-in state: the list is an explicit destination ("‹ All traces"),
	// not a persistent sidebar. Row selection itself stays in the host.
	const [listOpen, setListOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	// Reset per-trace so a fresh selection opens the new trace, not stale state.
	useEffect(() => {
		setSelectedSpanId(null);
		setMenuOpen(false);
	}, [detail?.id]);

	const handleSelectedIdChange = useCallback((id: string | null) => {
		setSelectedSpanId(id);
	}, []);

	// A run's own `run:<id>` span only exists when its pi session had >1 run;
	// fall back to the pi session span so the click always lands in the tree.
	const handleRunSelect = useCallback(
		(row: RunUsageRow) => {
			const runSpanId = `run:${row.id}`;
			const target = findSpanInTree(spans, runSpanId)
				? runSpanId
				: `pi:${row.piSessionId}`;
			setSelectedSpanId(target);
		},
		[spans],
	);

	const usageContext = useMemo<UsageContext | undefined>(
		() =>
			usageData
				? {
						runs: usageData.runs,
						container: usageData.container ?? null,
						onRunSelect: handleRunSelect,
					}
				: undefined,
		[usageData, handleRunSelect],
	);

	const handleListSelect = useCallback(
		(rowId: string) => {
			onSelect(rowId);
			setListOpen(false);
		},
		[onSelect],
	);

	const handleBack = useCallback(() => {
		setListOpen(true);
		setMenuOpen(false);
	}, []);

	const handleHeaderDelete = useCallback(() => {
		if (!detail || !onDelete) return;
		setMenuOpen(false);
		// Deleting the trace you are inside means you are done with it: return
		// to the list either way (the host's confirm may still cancel).
		setListOpen(true);
		onDelete(detail.id);
	}, [detail, onDelete]);

	const showList = listOpen || !detail;

	const listTitle = labels?.listTitle ?? "Traces";
	const countNoun = labels?.countNoun ?? "trace";
	const rowColumnLabel = labels?.rowColumnLabel ?? "Trace";
	const backLabel = labels?.backLabel ?? "All traces";

	const headerDeleteDisabled =
		loading ||
		rows.some((row) => row.deleting) ||
		(detail
			? (rows.find((row) => row.id === selectedRowId)?.deleteDisabled ?? false)
			: true);

	const rowGrid = onDelete
		? "grid-cols-[minmax(0,1fr)_90px_48px]"
		: "grid-cols-[minmax(0,1fr)_90px]";

	// usageData still feeds UsageContext (detail-side renderers show usage
	// aggregates with run→span click-through); no workspace-level usage UI.
	const viewerPlugins = useMemo(
		() => ({
			renderSpanDetail: renderSpanDetail
				? (span: TraceSpan) => renderSpanDetail(span, usageContext)
				: undefined,
		}),
		[renderSpanDetail, usageContext],
	);

	return (
		<section
			data-trace-workspace={showList ? "list" : "detail"}
			className="flex h-[var(--research-workspace-height,100%)] min-h-[var(--research-workspace-min-height,560px)] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
		>
			{showList ? (
				<>
					<div className="flex h-[var(--research-header-height,64px)] shrink-0 items-center border-b border-border px-4">
						<div className="flex w-full items-center justify-between gap-3">
							<div>
								<h2 className="font-display text-lg font-bold leading-tight">{listTitle}</h2>
								<p className="mt-1 text-xs text-muted-foreground">
									{rows.length} {countNoun}
									{rows.length === 1 ? "" : "s"}
								</p>
							</div>
							{loading && (
								<span className="rounded-[2px] border border-border px-2 py-1 text-xs text-muted-foreground">
									Loading
								</span>
							)}
						</div>
					</div>

					{listExtras && (
						<div className="shrink-0 border-b border-border px-3 py-2">{listExtras}</div>
					)}

					<div className="min-h-0 flex-1 overflow-y-auto">
						{rows.length === 0 && !loading ? (
							<div className="px-3 py-8 text-center text-sm text-muted-foreground">
								No traces found.
							</div>
						) : (
							<div className="min-w-0">
								<div
									className={`sticky top-0 z-10 grid ${rowGrid} gap-2 border-b border-border bg-card/95 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground`}
								>
									<span>{rowColumnLabel}</span>
									<span className="text-right">State</span>
									{onDelete && <span className="text-right">Del</span>}
								</div>
								{rows.map((row) => {
									const selected = row.id === selectedRowId;
									return (
										<div
											key={row.id}
											className={`relative grid w-full min-w-0 ${rowGrid} items-center gap-2 border-b border-border/70 text-left transition-colors ${
												selected
													? "bg-status-info-fill/30 text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-status-info-border"
													: "text-muted-foreground hover:bg-muted/35 hover:text-foreground"
											}`}
										>
											<button
												type="button"
												onClick={() => handleListSelect(row.id)}
												className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_90px] items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
											>
												<span className="min-w-0">
													<span className="block truncate text-[13px] font-bold leading-5">
														{row.title}
													</span>
													{row.subtitle && (
														<span className="block truncate text-[11px] leading-4 text-muted-foreground">
															{row.subtitle}
														</span>
													)}
												</span>
												<span
													className={`justify-self-end rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusClass(row.status)}`}
												>
													{row.status}
												</span>
											</button>
											{onDelete && (
												<button
													type="button"
													disabled={loading || row.deleting || row.deleteDisabled}
													onClick={() => onDelete(row.id)}
													aria-label={`Delete trace ${row.title}`}
													title={
														row.deleteDisabled
															? "Cannot delete this trace right now"
															: `Delete ${row.title}`
													}
													className="mr-2 h-7 w-8 justify-self-end rounded-[2px] border border-destructive/40 text-[10px] font-bold uppercase text-destructive transition-colors hover:border-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-60"
												>
													{row.deleting ? "..." : "Del"}
												</button>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				</>
			) : (
				<>
					{/* Minimal drill-in header: back · title · quiet status badge ·
					    overflow (delete hosts only). Nothing else rides this bar; it
					    sits on the shared panel-header surface: bg-background over
					    border-b border-border — the dark base surface. */}
					<div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
						<button
							type="button"
							onClick={handleBack}
							className="flex shrink-0 items-center gap-1.5 rounded-[2px] border border-border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
						>
							<span aria-hidden="true">‹</span>
							{backLabel}
						</button>
						<h2
							className="min-w-0 truncate text-sm font-bold leading-tight text-foreground"
							title={detail?.title}
						>
							{detail?.title}
						</h2>
						{detail && (
							<span
								className={`shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[10px] uppercase opacity-80 ${statusClass(detail.status)}`}
							>
								{detail.status}
							</span>
						)}
						<div className="ml-auto flex shrink-0 items-center gap-2">
							{onDelete && (
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
							)}
						</div>
						{menuOpen && onDelete && (
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
										disabled={headerDeleteDisabled}
										onClick={handleHeaderDelete}
										className="block w-full px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
									>
										Delete trace…
									</button>
								</div>
							</>
						)}
					</div>

					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{loading && spans.length === 0 ? (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								Loading kernel trace...
							</div>
						) : (
							<>
								<KernelTraceViewer
									className="flex min-h-0 flex-1 flex-col"
									spans={spans}
									initialTraceLevel={initialTraceLevel}
									apiBase={apiBase}
									selectedId={selectedSpanId}
									onSelectedIdChange={handleSelectedIdChange}
									usageContext={usageContext}
									plugins={viewerPlugins}
									iconSide={iconSide}
									iconStyle={iconStyle}
									detailBlockProvider={detailBlockProvider}
								/>
							</>
						)}
					</div>
				</>
			)}
			{overlays}
		</section>
	);
}
