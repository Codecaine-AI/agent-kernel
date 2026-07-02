/**
 * Routes owned by the kernel trace read API (see
 * packages/kernel/src/read-api.ts). Trace sessions are container-backed —
 * the detail route serves the container trace for a container of kind
 * "session"; the container route is the primary read.
 */
export const KERNEL_TRACE_READ_PATHS = {
	listTraceSessions: "/kernel/trace-sessions",
	traceSessionDetail(id: string): string {
		return `/kernel/trace-sessions/${encodeURIComponent(id)}`;
	},
	containerTrace(containerId: string): string {
		return `/kernel/containers/${encodeURIComponent(containerId)}/trace`;
	},
} as const;

/**
 * Cross-kernel observer routes (a viewer plane over many kernel manifests).
 * Container-first; the tailer daemon routes are gone with D75 (tailer is a
 * backfill tool, not a service).
 */
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
} as const;
