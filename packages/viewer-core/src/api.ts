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
	/** Content-addressed trace blob bytes (hash is "b1-<sha256hex>"). */
	blob(hash: string): string {
		return `/kernel/blobs/${encodeURIComponent(hash)}`;
	},
	/** Per-turn request snapshot context for one agent run. */
	runTurnContext(runId: string, turnNumber: number): string {
		return `/kernel/runs/${encodeURIComponent(runId)}/turns/${turnNumber}/context`;
	},
} as const;

/**
 * Routes owned by the kernel catalog API (Phase 5): registry listing, agent
 * detail (manifest + prompt + validation), prompt writes, revision history,
 * and per-revision run stats. The write route (`PUT .../prompt`) is only
 * mounted when the kernel runs in dev mode; the paths are defined here so
 * browser hosts and the server agree on the URL shape.
 */
export const KERNEL_CATALOG_PATHS = {
	listAgents: "/kernel/catalog/agents",
	agentDetail(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}`;
	},
	agentPrompt(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/prompt`;
	},
	agentManifest(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/manifest`;
	},
	agentRevisions(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/revisions`;
	},
	revisionStats(name: string, hash: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/revisions/${encodeURIComponent(hash)}/stats`;
	},
} as const;

/**
 * Cross-kernel observer routes (a viewer plane over many kernel manifests).
 * Container-first; the tailer-daemon routes are gone with D75 (transcript
 * recovery is a backfill tool, not a service).
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
