import type { KernelTraceSessionSummary } from "@agent-kernel/viewer-core";

import { traceStatusClass } from "@/shared/trace-ui";

export type RunHeaderProps = {
	agentCount: number;
	traceCount: number;
	selectedTrace: KernelTraceSessionSummary | null;
};

/** The run column's header: the panel title, the catalog counts and the run's trace status. */
export function RunHeader({ agentCount, traceCount, selectedTrace }: RunHeaderProps) {
	return (
		<div className="flex min-h-[var(--research-header-height)] items-center border-b border-border px-4">
			<div className="flex w-full items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="font-display text-reading font-bold leading-title text-ink">Research Run</h2>
					<p className="mt-1 text-ui-xs text-muted-foreground">
						{agentCount} agents · {traceCount} traces
					</p>
				</div>
				{selectedTrace && (
					<span
						className={`shrink-0 rounded border px-1.5 py-0.5 text-ui-2xs font-bold ${traceStatusClass(
							selectedTrace.status
						)}`}
					>
						{selectedTrace.status}
					</span>
				)}
			</div>
		</div>
	);
}
