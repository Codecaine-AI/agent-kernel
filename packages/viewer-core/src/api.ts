export const KERNEL_TRACE_READ_PATHS = {
	listTraceSessions: "/kernel/trace-sessions",
	traceSessionDetail(id: string): string {
		return `/kernel/trace-sessions/${encodeURIComponent(id)}`;
	},
	containerTrace(containerId: string): string {
		return `/kernel/containers/${encodeURIComponent(containerId)}/trace`;
	},
} as const;

export const KERNEL_OBSERVER_READ_PATHS = {
	listKernels: "/kernels",
	kernel(kernelId: string): string {
		return `/kernels/${encodeURIComponent(kernelId)}`;
	},
	kernelContainers(kernelId: string): string {
		return `/kernels/${encodeURIComponent(kernelId)}/containers`;
	},
	container(containerId: string): string {
		return `/containers/${encodeURIComponent(containerId)}`;
	},
	containerTrace(containerId: string): string {
		return `/containers/${encodeURIComponent(containerId)}/trace`;
	},
	listTailers: "/tailers",
	tailerHealth(tailerId: string): string {
		return `/tailers/${encodeURIComponent(tailerId)}/health`;
	},
	orphanEvents: "/events/orphans",
} as const;
