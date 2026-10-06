import { useMemo } from "react";
import {
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import type { KernelTraceViewerProps } from "@agent-kernel/viewer-shell";

import type { ResearchHarnessInfo, ResearchRunSummary } from "@/shared/types";
import type { TraceIconSettings } from "@/shared/style-settings";
import "./styles.css";
import { RunHeader } from "./_components/RunHeader";
import { RunForm } from "./_components/RunForm";
import { RunDetails } from "./_components/RunDetails";
import { LiveTrace } from "./_components/LiveTrace";
import { runErrorFromDetail } from "./utils";

export type ResearchWorkspaceProps = {
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
		return runErrorFromDetail(activeDetail);
	}, [activeDetail, activeRun?.error]);

	return (
		<section className="research-run-grid grid h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] min-w-0 overflow-hidden rounded border border-border bg-card">
			<aside className="flex min-h-0 min-w-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
				<RunHeader
					agentCount={info?.agents.length ?? 0}
					traceCount={traceSessions.length}
					selectedTrace={selectedTrace}
				/>
				<RunForm startingRun={startingRun} onStartRun={onStartRun} />
				<RunDetails
					info={info}
					selectedTrace={selectedTrace}
					activeRun={activeRun}
					activeRunError={activeRunError}
					canOpenTrace={Boolean(activeDetail)}
					onOpenTrace={onOpenTrace}
				/>
			</aside>

			<LiveTrace
				loading={loading}
				hasActiveRun={Boolean(activeRun)}
				hasActiveDetail={Boolean(activeDetail)}
				spans={spans}
				traceIcons={traceIcons}
			/>
		</section>
	);
}
