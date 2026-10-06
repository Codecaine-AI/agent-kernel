import { useCallback, useMemo } from "react";
import {
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import { DoctorPanel } from "@agent-kernel/viewer-ui";
import {
	KernelTraceWorkspace,
	type KernelTraceViewerProps,
	type TraceWorkspaceRow
} from "@agent-kernel/viewer-shell";

import { KERNEL_TRACE_API_BASE } from "@/shared/api";
import type { TraceIconSettings } from "@/shared/style-settings";
import { isSelectedTrace, traceStatusClass } from "@/shared/trace-ui";
import { isActiveTrace, sessionLabelOf } from "./utils";

/**
 * Thin app binding over the SHARED KernelTraceWorkspace: this file only maps
 * the research app's data (trace sessions, detail, delete rules) onto the
 * workspace adapter contract. All list/drill-in/split UX lives in
 * @agent-kernel/viewer-shell.
 */
export type TraceWorkspaceProps = {
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
	const rows = useMemo<TraceWorkspaceRow[]>(
		() =>
			traceSessions.map((trace) => ({
				id: trace.id,
				title: trace.topic ?? trace.label,
				subtitle: `Session ${sessionLabelOf(trace)}`,
				status: trace.status,
				deleteDisabled: isActiveTrace(trace.status),
				deleting: deletingTraceId === trace.id || deletingTraceId === trace.containerId
			})),
		[deletingTraceId, traceSessions]
	);

	const selectedTrace = useMemo(
		() =>
			traceSessions.find((trace) =>
				isSelectedTrace(trace, selectedTraceSessionId, detail)
			) ?? null,
		[detail, selectedTraceSessionId, traceSessions]
	);

	const workspaceDetail = useMemo(
		() =>
			detail
				? {
						id: selectedTrace?.id ?? detail.session.id,
						title: selectedTrace?.topic ?? selectedTrace?.label ?? "Trace",
						status: selectedTrace?.status ?? detail.session.status ?? "unknown",
						subtitle: selectedTrace ? `Session ${sessionLabelOf(selectedTrace)}` : null
					}
				: null,
		[detail, selectedTrace]
	);

	const usageData = useMemo(
		() =>
			detail
				? {
						container: detail.container ?? null,
						runs: detail.agent_runs,
						sessions: detail.pi_sessions
					}
				: undefined,
		[detail]
	);

	const handleDelete = useCallback(
		(rowId: string) => onTraceDelete(rowId),
		[onTraceDelete]
	);

	return (
		<KernelTraceWorkspace
			rows={rows}
			selectedRowId={selectedTrace?.id ?? null}
			detail={workspaceDetail}
			spans={spans}
			loading={loading}
			onSelect={onTraceSelect}
			onDelete={handleDelete}
			statusClass={traceStatusClass}
			usageData={usageData}
			apiBase={KERNEL_TRACE_API_BASE}
			iconSide={traceIcons.side}
			iconStyle={traceIcons.style}
			labels={{ listTitle: "Traces", countNoun: "database trace", rowColumnLabel: "Research" }}
			listExtras={<DoctorPanel endpoint="/api/doctor" />}
		/>
	);
}
