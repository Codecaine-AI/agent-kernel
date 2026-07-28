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

import { KERNEL_TRACE_API_BASE } from "../../lib/api";
import type { TraceIconSettings } from "../../lib/style-settings";
import { isSelectedTrace, traceStatusClass } from "../../lib/trace-ui";

/**
 * Thin app binding over the SHARED KernelTraceWorkspace: this file only maps
 * the research app's data (trace sessions, detail, delete rules) onto the
 * workspace adapter contract. All list/drill-in/split UX lives in
 * @agent-kernel/viewer-shell.
 */
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

function sessionLabelOf(trace: KernelTraceSessionSummary): string {
	const metadataSlug = trace.metadata?.sessionSlug;
	return typeof metadataSlug === "string" && metadataSlug.length > 0
		? metadataSlug
		: shortId(trace.containerId);
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
