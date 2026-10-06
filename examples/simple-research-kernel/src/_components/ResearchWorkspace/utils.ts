import type { KernelTraceSessionDetail } from "@agent-kernel/viewer-core";

/** The error message of the run's last failed agent run, or null. */
export function runErrorFromDetail(activeDetail: KernelTraceSessionDetail): string | null {
	const errorEvent = [...activeDetail.events]
		.reverse()
		.find((event) => {
			if (event.type !== "agent_run_end") return false;
			const data = event.eventData as Record<string, unknown>;
			return data.status === "error" && typeof data.error_message === "string";
		});
	if (!errorEvent) return null;
	const data = errorEvent.eventData as Record<string, unknown>;
	return typeof data.error_message === "string" ? data.error_message : null;
}
