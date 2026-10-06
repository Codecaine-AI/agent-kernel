import type { KernelTraceSessionSummary } from "@agent-kernel/viewer-core";

import type { ResearchHarnessInfo, ResearchRunSummary } from "@/shared/types";
import { RunTrace } from "./_components/RunTrace";
import { ActiveRun } from "./_components/ActiveRun";
import { RunArtifacts } from "./_components/RunArtifacts";

export type RunDetailsProps = {
	info: ResearchHarnessInfo | null;
	selectedTrace: KernelTraceSessionSummary | null;
	activeRun: ResearchRunSummary | null;
	activeRunError: string | null;
	canOpenTrace: boolean;
	onOpenTrace: () => void;
};

/** The run column's scrolling body: the run's trace, the active run, the artifacts and Open Detailed Trace. */
export function RunDetails({
	info,
	selectedTrace,
	activeRun,
	activeRunError,
	canOpenTrace,
	onOpenTrace
}: RunDetailsProps) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<div className="space-y-5">
				<RunTrace selectedTrace={selectedTrace} activeRun={activeRun} />

				{activeRun && <ActiveRun activeRun={activeRun} activeRunError={activeRunError} />}

				<RunArtifacts
					scoutReportCount={info?.artifacts.scoutReports.length ?? 0}
					reportCount={info?.artifacts.reports.length ?? 0}
				/>

				<button
					type="button"
					onClick={onOpenTrace}
					disabled={!canOpenTrace}
					className="flex h-10 w-full items-center justify-center rounded border border-border px-3 text-ui-lg font-bold text-foreground transition-colors hover:border-accent hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
				>
					Open Detailed Trace
				</button>
			</div>
		</div>
	);
}
