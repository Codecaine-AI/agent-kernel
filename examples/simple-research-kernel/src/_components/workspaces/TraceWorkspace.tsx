import { useState } from "react";
import {
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import { DoctorPanel, UsageSummaryPanel } from "@agent-kernel/viewer-ui";
import { KernelTraceViewer, type KernelTraceViewerProps } from "@agent-kernel/viewer-shell";

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
	const [usageOpen, setUsageOpen] = useState(true);
	return (
		<section className="grid h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[380px_minmax(0,1fr)]">
			<aside className="flex min-h-0 min-w-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
				<div className="flex h-[var(--research-header-height)] items-center border-b border-border px-4">
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

				<div className="border-b border-border px-3 py-2">
					<DoctorPanel endpoint="/api/doctor" />
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{traceSessions.length === 0 && !loading ? (
						<div className="px-3 py-8 text-center text-sm text-muted-foreground">
							No traces found.
						</div>
					) : (
						<div className="min-w-0">
							<div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_76px_42px] gap-2 border-b border-border bg-card/95 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
								<span>Research</span>
								<span className="text-right">State</span>
								<span className="text-right">Del</span>
							</div>
							{traceSessions.map((trace) => {
								const selected = isSelectedTrace(trace, selectedTraceSessionId, detail);
								const researchTitle = trace.topic ?? trace.label;
								const metadataSlug = trace.metadata?.sessionSlug;
								const sessionLabel =
									typeof metadataSlug === "string" && metadataSlug.length > 0
										? metadataSlug
										: shortId(trace.containerId);
								const deleting = deletingTraceId === trace.id || deletingTraceId === trace.containerId;
								const deleteDisabled = loading || deleting || isActiveTrace(trace.status);

								return (
									<div
										key={`${trace.id}:${trace.containerId}`}
										className={`relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)_76px_42px] items-center gap-2 border-b border-border/70 text-left transition-colors ${
											selected
												? "bg-status-info-fill/30 text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-status-info-border"
												: "text-muted-foreground hover:bg-muted/35 hover:text-foreground"
										}`}
									>
										<button
											type="button"
											onClick={() => onTraceSelect(trace.id)}
											className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_76px] items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
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
											disabled={deleteDisabled}
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
			</aside>

			<div className="flex min-h-0 flex-col overflow-hidden">
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
						<div className="shrink-0 border-b border-border">
							<button
								type="button"
								onClick={() => setUsageOpen((open) => !open)}
								className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
								aria-expanded={usageOpen}
							>
								<span>Usage summary</span>
								<span>{usageOpen ? "▾" : "▸"}</span>
							</button>
							{usageOpen && (
								<div className="max-h-[42vh] overflow-y-auto border-t border-border/60">
									<UsageSummaryPanel
										container={detail.container ?? null}
										runs={detail.agent_runs}
										sessions={detail.pi_sessions}
									/>
								</div>
							)}
						</div>
						<KernelTraceViewer
							className="flex min-h-0 flex-1 flex-col"
							spans={spans}
							initialTraceLevel={2}
							iconSide={traceIcons.side}
							iconStyle={traceIcons.style}
						/>
					</>
				)}
			</div>
		</section>
	);
}
