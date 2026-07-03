/**
 * UsageStrip — a one-line usage caption above the span tree.
 *
 * A quiet meta-styled summary of the trace's token/cost rollup: in/out tokens,
 * cost, run count, duration. It is a caption, not a header — mono META (11px),
 * muted, visually below the trace tree in the hierarchy. Clicking it toggles
 * the full usage view in the detail column (role=button + hover affordance),
 * so the aggregate is one tap away without stealing vertical space from the
 * traces.
 *
 * Design-system contract: mono META only; never reaches amber/red (usage is
 * not a diagnostic). The active state uses the neutral info fill, matching the
 * traces-list selection treatment.
 */
import type { FC } from "react";

import cn from "classnames";

import type {
	AgentRun,
	KernelContainerSummary,
	PiAgentSession,
} from "@agent-kernel/viewer-core";

import { formatCost, formatDuration, formatTokens, summarizeUsage } from "./usage-summary";

const META = "font-mono text-[11px] leading-[14px]";

export interface UsageStripProps {
	container?: KernelContainerSummary | null;
	runs: AgentRun[];
	sessions?: PiAgentSession[];
	/** Whether the detail-column usage view is currently open (active styling). */
	active?: boolean;
	onToggle?: () => void;
	className?: string;
}

const Sep: FC = () => <span className="text-muted-foreground/40">·</span>;

export const UsageStrip: FC<UsageStripProps> = ({
	container,
	runs,
	sessions,
	active,
	onToggle,
	className,
}) => {
	const { totals } = summarizeUsage({ container, runs, sessions });
	const runLabel = `${totals.runCount} ${totals.runCount === 1 ? "run" : "runs"}`;

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-pressed={active}
			className={cn(
				META,
				"flex w-full items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left tabular-nums tracking-[0.02em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border",
				active
					? "bg-status-info-fill/30 text-foreground"
					: "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
				className,
			)}
			title="Toggle usage summary"
		>
			<span className="uppercase tracking-[0.12em] text-muted-foreground/80">
				Usage
			</span>
			<span>
				{formatTokens(totals.inputTokens)} in / {formatTokens(totals.outputTokens)} out
			</span>
			<Sep />
			<span>{formatCost(totals.cost)}</span>
			<Sep />
			<span>{runLabel}</span>
			<Sep />
			<span>{formatDuration(totals.durationMs)}</span>
			<span className="ml-auto text-muted-foreground/60">{active ? "▾" : "▸"}</span>
		</button>
	);
};
