import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import { KernelTraceViewer, type KernelTraceViewerProps } from "@agent-kernel/viewer-shell";

import { KERNEL_TRACE_API_BASE } from "../../lib/api";
import type { ResearchHarnessInfo, ResearchRunSummary } from "../../lib/types";
import type { TraceIconSettings } from "../../lib/style-settings";
import { formatTraceDate, traceStatusClass } from "../../lib/trace-ui";

type ResearchWorkspaceProps = {
	detail: KernelTraceSessionDetail | null;
	info: ResearchHarnessInfo | null;
	spans: KernelTraceViewerProps["spans"];
	traceSessions: KernelTraceSessionSummary[];
	selectedTraceSessionId: string | null;
	currentResearchRun: ResearchRunSummary | null;
	loading: boolean;
	startingRun: boolean;
	onStartRun: (prompt: string) => void | Promise<void>;
	onOpenTrace: () => void;
	traceIcons: TraceIconSettings;
};

export function ResearchWorkspace({
	detail,
	info,
	spans,
	traceSessions,
	selectedTraceSessionId,
	currentResearchRun,
	loading,
	startingRun,
	onStartRun,
	onOpenTrace,
	traceIcons
}: ResearchWorkspaceProps) {
	const [prompt, setPrompt] = useState(
		"Research the next step for turning this simple kernel into a richer agent experience."
	);
	const activeRun = useMemo(() => {
		if (currentResearchRun) return currentResearchRun;
		if (!info?.activeRuns.length) return null;
		return (
			info.activeRuns.find(
				(run) =>
					run.containerId === selectedTraceSessionId ||
					run.containerId === detail?.session.id
			) ?? info.activeRuns[0]
		);
	}, [currentResearchRun, detail?.session.id, info?.activeRuns, selectedTraceSessionId]);
	const selectedTrace = useMemo(() => {
		if (!activeRun) return null;
		return (
			traceSessions.find((trace) => trace.containerId === activeRun.containerId) ?? null
		);
	}, [activeRun, traceSessions]);
	const activeDetail = useMemo(() => {
		if (!activeRun || !detail) return null;
		const matchesRun =
			detail.session.id === activeRun.containerId ||
			detail.container?.id === activeRun.containerId;
		return matchesRun ? detail : null;
	}, [activeRun, detail]);
	const activeRunError = useMemo(() => {
		if (activeRun?.error) return activeRun.error;
		if (!activeDetail) return null;
		const errorEvent = [...activeDetail.events]
			.reverse()
			.find((event) => {
				if (event.type !== "agent_run_end") return false;
				const data = event.eventData as Record<string, unknown>;
				return data.status === "error" && typeof data.error_message === "string";
			});
		if (!errorEvent) return null;
		const data = errorEvent.eventData as Record<string, unknown>;
		return typeof data.error_message === "string" ? data.error_message : null;
	}, [activeDetail, activeRun?.error]);

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = prompt.trim();
		if (!trimmed || startingRun) return;
		void onStartRun(trimmed);
	}

	function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	return (
		<section className="grid h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card xl:grid-cols-[440px_minmax(0,1fr)]">
			<aside className="flex min-h-0 min-w-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
				<div className="flex h-[var(--research-header-height)] items-center border-b border-border px-4">
					<div className="flex w-full items-center justify-between gap-3">
						<div className="min-w-0">
							<h2 className="font-display text-lg font-bold leading-tight">Research Run</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								{info?.agents.length ?? 0} agents · {traceSessions.length} traces
							</p>
						</div>
						{selectedTrace && (
							<span
								className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${traceStatusClass(
									selectedTrace.status
								)}`}
							>
								{selectedTrace.status}
							</span>
						)}
					</div>
				</div>

				<form
					onSubmit={handleSubmit}
					aria-busy={startingRun}
					className="border-b border-border bg-background/35 p-4"
				>
					<div className="grid gap-3">
						<textarea
							aria-label="Research prompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							onKeyDown={handlePromptKeyDown}
							className="min-h-[116px] w-full min-w-0 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-agentprism-badge-chain-foreground"
							placeholder="Research prompt"
						/>
						<button
							type="submit"
							disabled={startingRun || prompt.trim().length === 0}
							className="flex h-10 w-full min-w-0 items-center justify-center rounded-md border border-agentprism-badge-chain-foreground/60 bg-accent px-3 text-sm font-bold leading-none text-accent-foreground transition-colors hover:border-agentprism-badge-chain-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agentprism-badge-chain-foreground disabled:cursor-not-allowed disabled:opacity-55"
						>
							{startingRun ? "Starting Run" : "Start Research Run"}
						</button>
					</div>
				</form>

				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="space-y-5">
						<div>
							<div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Research Trace</div>
							{selectedTrace ? (
								<div className="rounded-md border border-border bg-background/25 px-3.5 py-3.5">
									<div className="line-clamp-2 text-sm font-bold leading-5">{selectedTrace.label}</div>
									<div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
										{selectedTrace.topic ?? selectedTrace.containerId}
									</div>
									<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
										<span>{selectedTrace.piSessionCount} sessions</span>
										<span>{selectedTrace.eventCount} events</span>
										<span>{formatTraceDate(selectedTrace.latestEventAt ?? selectedTrace.updatedAt)}</span>
									</div>
								</div>
							) : activeRun ? (
								<div className="rounded-md border border-status-info-border bg-status-info-fill px-3.5 py-3.5 text-sm text-status-info">
									<div className="font-bold">Starting trace...</div>
									<div className="mt-1 line-clamp-2 text-xs leading-5">{activeRun.prompt}</div>
								</div>
							) : (
								<div className="rounded-md border border-border bg-background/25 px-3.5 py-3.5 text-sm text-muted-foreground">
									No research run in progress.
								</div>
							)}
						</div>

						{activeRun && (
							<div>
								<div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Active Run</div>
								<div
									className={`rounded-md border px-3.5 py-3.5 text-sm ${
										activeRun.status === "error"
											? "border-destructive/40 bg-destructive/10 text-destructive"
											: "border-status-info-border bg-status-info-fill text-status-info"
									}`}
								>
									<div className="flex items-center gap-2 font-bold">
										<span
											className={`h-1.5 w-1.5 rounded-full ${
												activeRun.status === "error" ? "bg-destructive" : "bg-status-info tk-pulse"
											}`}
											aria-hidden
										/>
										<span>{activeRun.status}</span>
									</div>
									<div className="mt-1 line-clamp-3 text-xs leading-5">{activeRun.prompt}</div>
									{activeRunError && (
										<div className="mt-2 rounded-md border border-current/25 bg-background/45 px-2 py-1.5 text-xs leading-5">
											{activeRunError}
										</div>
									)}
								</div>
							</div>
						)}

						<div>
							<div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Artifacts</div>
							<div className="grid grid-cols-2 gap-2 text-sm">
								<div className="rounded-md border border-border bg-background/25 px-3.5 py-3">
									<div className="text-base font-bold">{info?.artifacts.scoutReports.length ?? 0}</div>
									<div className="mt-0.5 text-xs text-muted-foreground">scout reports</div>
								</div>
								<div className="rounded-md border border-border bg-background/25 px-3.5 py-3">
									<div className="text-base font-bold">{info?.artifacts.reports.length ?? 0}</div>
									<div className="mt-0.5 text-xs text-muted-foreground">reports</div>
								</div>
							</div>
						</div>

						<button
							type="button"
							onClick={onOpenTrace}
							disabled={!activeDetail}
							className="flex h-10 w-full items-center justify-center rounded-md border border-border px-3 text-sm font-bold text-foreground transition-colors hover:border-agentprism-badge-chain-foreground hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agentprism-badge-chain-foreground disabled:cursor-not-allowed disabled:opacity-55"
						>
							Open Detailed Trace
						</button>
					</div>
				</div>
			</aside>

			<div className="min-h-0 overflow-hidden">
				{loading && activeRun && !activeDetail ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Loading live trace...
					</div>
				) : !activeRun ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Start a research run.
					</div>
				) : !activeDetail ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Waiting for live trace...
					</div>
				) : (
					<KernelTraceViewer
						className="flex h-full flex-col"
						spans={spans}
						initialTraceLevel={3}
						apiBase={KERNEL_TRACE_API_BASE}
						iconSide={traceIcons.side}
						iconStyle={traceIcons.style}
					/>
				)}
			</div>
		</section>
	);
}
