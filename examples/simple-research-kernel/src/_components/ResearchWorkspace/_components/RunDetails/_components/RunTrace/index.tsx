import type { KernelTraceSessionSummary } from "@agent-kernel/viewer-core";

import { formatTraceDate } from "@/shared/trace-ui";
import type { ResearchRunSummary } from "@/shared/types";

export type RunTraceProps = {
	selectedTrace: KernelTraceSessionSummary | null;
	activeRun: ResearchRunSummary | null;
};

/** "Research Trace": the run's trace card, a starting notice, or the empty state. */
export function RunTrace({ selectedTrace, activeRun }: RunTraceProps) {
	return (
		<div>
			<div className="mb-2 text-ui-xs font-bold uppercase text-muted-foreground">Research Trace</div>
			{selectedTrace ? (
				<div className="rounded border border-border bg-background/25 px-3.5 py-3.5">
					<div className="line-clamp-2 text-ui-lg font-bold leading-[var(--ds-space-5)]">{selectedTrace.label}</div>
					<div className="mt-1 line-clamp-2 text-ui-xs leading-[var(--ds-space-5)] text-muted-foreground">
						{selectedTrace.topic ?? selectedTrace.containerId}
					</div>
					<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-ui-xs text-muted-foreground">
						<span>{selectedTrace.piSessionCount} sessions</span>
						<span>{selectedTrace.eventCount} events</span>
						<span>{formatTraceDate(selectedTrace.latestEventAt ?? selectedTrace.updatedAt)}</span>
					</div>
				</div>
			) : activeRun ? (
				<div className="rounded border border-status-info-border bg-status-info-fill px-3.5 py-3.5 text-ui-lg text-status-info">
					<div className="font-bold">Starting trace...</div>
					<div className="mt-1 line-clamp-2 text-ui-xs leading-[var(--ds-space-5)]">{activeRun.prompt}</div>
				</div>
			) : (
				<div className="rounded border border-border bg-background/25 px-3.5 py-3.5 text-ui-lg text-muted-foreground">
					No research run in progress.
				</div>
			)}
		</div>
	);
}
