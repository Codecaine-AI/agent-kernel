import type {
	KernelTraceSessionDetail,
	KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";

export function formatTraceDate(value: string | null | undefined): string {
	if (!value) return "No activity";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit"
	}).format(date);
}

export function traceStatusClass(status: string): string {
	if (status === "running" || status === "queued") {
		return "border-status-info-border bg-status-info-fill text-status-info";
	}
	if (status === "completed") {
		return "border-status-success-border bg-status-success-fill text-status-success";
	}
	if (status === "error" || status === "aborted" || status === "stopped") {
		return "border-destructive/40 bg-destructive/10 text-destructive";
	}
	return "border-status-neutral-border bg-status-neutral-fill text-status-neutral";
}

export function isSelectedTrace(
	trace: KernelTraceSessionSummary,
	selectedTraceSessionId: string | null,
	detail: KernelTraceSessionDetail | null
): boolean {
	return (
		trace.id === selectedTraceSessionId ||
		trace.containerId === selectedTraceSessionId ||
		trace.id === detail?.session.id ||
		trace.containerId === detail?.container?.id
	);
}
