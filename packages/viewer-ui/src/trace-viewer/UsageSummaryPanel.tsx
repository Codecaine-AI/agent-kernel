/**
 * UsageSummaryPanel — the token/cost rollup surface for one trace.
 *
 * A summary layer beside the span tree: a totals strip, a per-run table, and a
 * per-agent breakdown, all folded from the trace detail's runs + container by
 * the pure helpers in usage-summary.ts.
 *
 * Design-system contract (matches the trace-card system):
 *   - mono type at the three trace sizes (label 13 / body 13 / meta 11);
 *   - agent names wear the orchestration accent (violet, text-trace-orchestration);
 *   - run status uses lifecycle gray for the healthy terminal "done" state and
 *     the RESERVED diagnostic hues only for trouble: amber for the warning-like
 *     "turn-limit", red for "error"/"aborted". Nothing else reaches amber/red.
 */
import type { FC } from "react";

import cn from "classnames";

import type {
	AgentRun,
	KernelContainerSummary,
	PiAgentSession,
} from "@agent-kernel/viewer-core";

import {
	formatCost,
	formatDuration,
	formatTokens,
	summarizeUsage,
	type AgentUsageRollup,
	type RunUsageRow,
	type UsageTotals,
} from "./usage-summary";

export interface UsageSummaryPanelProps {
	container?: KernelContainerSummary | null;
	runs: AgentRun[];
	sessions?: PiAgentSession[];
	className?: string;
	/**
	 * When set, each run row becomes a button reporting the run. The workspace
	 * selects the run's `run:<id>` span, falling back to its `pi:<session>` span
	 * when the run has no standalone wrapper (single-run sessions).
	 */
	onRunSelect?: (row: RunUsageRow) => void;
}

const LABEL = "font-mono text-[13px] leading-[16px]";
const META = "font-mono text-[11px] leading-[14px]";

/** Status → the reserved diagnostic treatment, or neutral lifecycle for healthy. */
function statusChipClass(status: string): string {
	const s = status.toLowerCase();
	if (s === "error" || s === "aborted") {
		return "border-destructive/50 bg-destructive/10 text-destructive";
	}
	if (s === "turn-limit") {
		return "border-status-warning-border bg-status-warning-fill text-status-warning";
	}
	// done / running / anything else: neutral lifecycle gray (never green-assistant).
	return "border-status-neutral-border bg-status-neutral-fill text-status-neutral";
}

const StatChip: FC<{ label: string; value: string; accent?: boolean }> = ({
	label,
	value,
	accent,
}) => (
	<div className="flex min-w-0 flex-col gap-0.5 rounded-[2px] border border-border bg-card/60 px-2.5 py-1.5">
		<span
			className={cn(META, "uppercase tracking-[0.12em] text-muted-foreground")}
		>
			{label}
		</span>
		<span
			className={cn(
				LABEL,
				"font-semibold tabular-nums",
				accent ? "text-trace-orchestration" : "text-foreground",
			)}
		>
			{value}
		</span>
	</div>
);

export const TotalsStrip: FC<{ totals: UsageTotals }> = ({ totals }) => (
	<div className="flex flex-wrap gap-1.5">
		<StatChip label="Input" value={formatTokens(totals.inputTokens)} />
		<StatChip label="Output" value={formatTokens(totals.outputTokens)} />
		{totals.cacheRead > 0 && (
			<StatChip label="Cache read" value={formatTokens(totals.cacheRead)} />
		)}
		{totals.cacheWrite > 0 && (
			<StatChip label="Cache write" value={formatTokens(totals.cacheWrite)} />
		)}
		<StatChip label="Cost" value={formatCost(totals.cost)} />
		<StatChip label="Runs" value={formatTokens(totals.runCount)} />
		<StatChip label="Duration" value={formatDuration(totals.durationMs)} />
	</div>
);

export const AgentBreakdown: FC<{ byAgent: AgentUsageRollup[] }> = ({ byAgent }) => {
	if (byAgent.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<span
				className={cn(META, "uppercase tracking-[0.12em] text-muted-foreground")}
			>
				By agent
			</span>
			<div className="flex flex-col gap-px overflow-hidden rounded-[2px] border border-border">
				{byAgent.map((agent) => (
					<div
						key={agent.agentName}
						className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-card/60 px-2.5 py-1"
					>
						<span
							className={cn(LABEL, "truncate font-semibold text-trace-orchestration")}
							title={agent.agentName}
						>
							{agent.agentName}
						</span>
						<span className={cn(META, "tabular-nums text-muted-foreground")}>
							{agent.runCount} {agent.runCount === 1 ? "run" : "runs"} ·{" "}
							{formatTokens(agent.inputTokens + agent.outputTokens)} tok
						</span>
					</div>
				))}
			</div>
		</div>
	);
};

const RUN_ROW_GRID =
	"grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px_64px_60px] items-center gap-2";

export const RunsTable: FC<{
	runs: RunUsageRow[];
	onRunSelect?: (row: RunUsageRow) => void;
}> = ({ runs, onRunSelect }) => {
	if (runs.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<span
				className={cn(META, "uppercase tracking-[0.12em] text-muted-foreground")}
			>
				Runs
			</span>
			<div className="overflow-hidden rounded-[2px] border border-border">
				<div
					className={cn(
						META,
						RUN_ROW_GRID,
						"border-b border-border bg-card/80 px-2.5 py-1 uppercase tracking-[0.1em] text-muted-foreground",
					)}
				>
					<span>Agent</span>
					<span>Trigger</span>
					<span className="text-right">In</span>
					<span className="text-right">Out</span>
					<span className="text-right">Dur</span>
				</div>
				<div className="flex flex-col">
					{runs.map((run) => {
						const rowClass = cn(
							RUN_ROW_GRID,
							"border-b border-border/60 px-2.5 py-1 text-left last:border-b-0",
							onRunSelect &&
								"cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border",
						);
						const cells = (
							<>
								<span className="flex min-w-0 items-center gap-1.5">
								<span
									className={cn(
										LABEL,
										"truncate font-semibold text-trace-orchestration",
									)}
									title={run.agentName}
								>
									{run.agentName}
								</span>
								<span
									className={cn(
										META,
										"shrink-0 rounded-[2px] border px-1 py-px uppercase leading-none",
										statusChipClass(run.status),
									)}
								>
									{run.status}
								</span>
							</span>
							<span className={cn(META, "truncate text-muted-foreground")} title={run.trigger}>
								{run.trigger}
							</span>
							<span className={cn(META, "text-right tabular-nums text-foreground")}>
								{formatTokens(run.inputTokens)}
							</span>
							<span className={cn(META, "text-right tabular-nums text-foreground")}>
								{formatTokens(run.outputTokens)}
							</span>
							<span className={cn(META, "text-right tabular-nums text-muted-foreground")}>
								{formatDuration(run.durationMs)}
							</span>
						</>
					);
					return onRunSelect ? (
						<button
							key={run.id}
							type="button"
							onClick={() => onRunSelect(run)}
							className={rowClass}
						>
							{cells}
						</button>
					) : (
						<div key={run.id} className={rowClass}>
							{cells}
						</div>
					);
				})}
				</div>
			</div>
		</div>
	);
};

export const UsageSummaryPanel: FC<UsageSummaryPanelProps> = ({
	container,
	runs,
	sessions,
	className,
	onRunSelect,
}) => {
	const summary = summarizeUsage({ container, runs, sessions });

	if (runs.length === 0) {
		return (
			<div
				className={cn(
					META,
					"px-3 py-4 text-center text-muted-foreground",
					className,
				)}
			>
				No runs recorded for this trace.
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col gap-3 p-3", className)}>
			<TotalsStrip totals={summary.totals} />
			<AgentBreakdown byAgent={summary.byAgent} />
			<RunsTable runs={summary.runs} onRunSelect={onRunSelect} />
		</div>
	);
};
