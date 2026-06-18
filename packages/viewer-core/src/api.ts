export const KERNEL_TRACE_READ_PATHS = {
	listTraceSessions: "/kernel/trace-sessions",
	traceSessionDetail(id: string): string {
		return `/kernel/trace-sessions/${encodeURIComponent(id)}`;
	},
	containerTrace(containerId: string): string {
		return `/kernel/containers/${encodeURIComponent(containerId)}/trace`;
	},
} as const;
