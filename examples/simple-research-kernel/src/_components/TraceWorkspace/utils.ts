import type { KernelTraceSessionSummary } from "@agent-kernel/viewer-core";

function shortId(value: string): string {
	return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function isActiveTrace(status: string): boolean {
	return status === "active" || status === "queued" || status === "running";
}

export function sessionLabelOf(trace: KernelTraceSessionSummary): string {
	const metadataSlug = trace.metadata?.sessionSlug;
	return typeof metadataSlug === "string" && metadataSlug.length > 0
		? metadataSlug
		: shortId(trace.containerId);
}
