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
	revisionDocument(name: string, hash: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/revisions/${encodeURIComponent(hash)}/document`;
	},
	revisionStats(name: string, hash: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/revisions/${encodeURIComponent(hash)}/stats`;
	},
	/** Rendered state document for one named fixture (the lab's State view). */
	agentFixtureStatePreview(name: string, fixtureId: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/fixtures/${encodeURIComponent(fixtureId)}/state-preview`;
	},
	// -- Annotation sidecar routes (kernel catalog-annotations-api.ts). GET
	// lists, POST adds; the :id mutations follow the 409 + { currentHash }
	// optimistic-concurrency idiom via expectedHash in the body.
	agentAnnotations(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations`;
	},
	agentAnnotation(name: string, annotationId: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations/${encodeURIComponent(annotationId)}`;
	},
	agentAnnotationReplies(name: string, annotationId: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations/${encodeURIComponent(annotationId)}/replies`;
	},
	agentAnnotationResolve(name: string, annotationId: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations/${encodeURIComponent(annotationId)}/resolve`;
	},
	agentAnnotationAgentRun(name: string, annotationId: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations/${encodeURIComponent(annotationId)}/agent-run`;
	},
	agentAnnotationsPrune(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/annotations/prune`;
	},
	/** Creates a prompt-edit session for the agent (201 { state }). */
	agentEditSessions(name: string): string {
		return `/kernel/catalog/agents/${encodeURIComponent(name)}/edit-sessions`;
	},
} as const;

/**
 * Routes owned by the kernel prompt-edit session API (Phase 2 review loop —
 * see packages/kernel/src/prompt-edit-session-api.ts). Session creation lives
 * under the catalog agent (KERNEL_CATALOG_PATHS.agentEditSessions); everything
 * after creation is keyed by session id here.
 */
export const KERNEL_PROMPT_EDIT_SESSION_PATHS = {
	list: "/kernel/prompt-edit-sessions",
	session(sessionId: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}`;
	},
	/** SSE stream: `session-state` hello, then every service stream event. */
	events(sessionId: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/events`;
	},
	/** POST: add a human request mid-session. */
	requests(sessionId: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/requests`;
	},
	accept(sessionId: string, alias: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(alias)}/accept`;
	},
	reject(sessionId: string, alias: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(alias)}/reject`;
	},
	undo(sessionId: string, alias: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(alias)}/undo`;
	},
	replies(sessionId: string, alias: string): string {
		return `/kernel/prompt-edit-sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(alias)}/replies`;
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
