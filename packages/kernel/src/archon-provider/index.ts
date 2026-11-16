/**
 * `@codecaine-ai/agent-kernel/archon-provider`: an Archon agent provider that
 * runs a kernel bundle as an AI node. A node selects it with
 * `provider: agent-kernel` and names the bundle as its `model`.
 *
 * Archon makes a new provider for each node attempt, so the kernels live in a
 * module-scope cache keyed by root. Every provider for one root shares one
 * kernel, one database handle and one kernel id, and each node attempt runs in
 * its own `archon-node` container under the run's `archon-run` container.
 *
 * The Archon provider shape is written here as local structural types,
 * because `@archon/provider-contract` is not on npm. The fork's registration
 * checks the provider with `satisfies IAgentProvider`, so a drift fails its
 * type check.
 */
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	updateContainerStatus,
	type ContainerStatus,
	type KernelDatabase,
} from "@codecaine-ai/agent-kernel-db";
import { TRACE_TAGS, type TraceTags } from "@codecaine-ai/agent-kernel-protocol";

import { createKernel, type KernelCallsConfig, type KernelInstance } from "../index";

/** The one kernel id of every Archon kernel. Container ids derive from it, so it never changes. */
export const ARCHON_KERNEL_ID = "archon-provider-agent-kernel";

/** The container kinds this provider owns. */
export const ARCHON_RUN_KIND = "archon-run";
export const ARCHON_NODE_KIND = "archon-node";

/** The `assistants.agent-kernel` block of Archon's config, after parsing. */
export interface AgentKernelSettings {
	catalogRoots: string[];
	/** Model aliases, such as `fast`, `standard` and `strong`. */
	aliases: Record<string, string>;
	piAgentDir?: string;
}

// ---------------------------------------------------------------------------
// Local structural copy of the Archon provider contract (the parts used here).
// ---------------------------------------------------------------------------

export type ProviderFailureClass =
	| "auth"
	| "quota_exhausted"
	| "budget_exceeded"
	| "misconfigured"
	| "rate_limited"
	| "overloaded"
	| "transient"
	| "unknown";

export type AgentKernelChunk =
	| { type: "agent_message_chunk"; text: string }
	| {
			type: "result";
			sessionId?: string;
			text?: string;
			structuredOutput?: unknown;
			isError?: boolean;
			errors?: string[];
			failure?: { class: ProviderFailureClass; evidence: string };
	  }
	| { type: "settled" };

export interface AgentKernelSendQueryOptions {
	model?: string;
	abortSignal?: AbortSignal;
	outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
	env?: Record<string, string>;
	assistantConfig?: Record<string, unknown>;
}

export interface AgentKernelCapabilities {
	backgroundWork: "reported" | "none" | "unobserved";
	sessionResume: boolean;
	sessionFork?: boolean;
	mcp: boolean;
	hooks: boolean;
	skills: boolean;
	plugins: boolean;
	agents: boolean;
	toolRestrictions: boolean;
	structuredOutput: "enforced" | "best-effort" | false;
	requiresAllPropertiesRequired: boolean;
	envInjection: boolean;
	costControl: boolean;
	costReporting: boolean;
	effortControl: boolean;
	fallbackModel: boolean;
	sandbox: boolean;
	settingSources: boolean;
	nativeTools: boolean;
	containerExec: boolean;
}

export interface AgentKernelProvider {
	checkCredential(request: unknown): Promise<{ state: "not_checked"; source: "native" }>;
	sendQuery(
		prompt: string,
		cwd: string,
		resumeSessionId?: string,
		options?: AgentKernelSendQueryOptions,
	): AsyncGenerator<AgentKernelChunk>;
	getType(): string;
	getCapabilities(): AgentKernelCapabilities;
}

/**
 * `structuredOutput: 'enforced'`: Archon re-asks only a best-effort provider,
 * so a bundle answer that misses the node's schema fails the node with no
 * re-ask. The bundle owns its own tools, state and model, so every
 * Archon-side feature flag is off.
 */
export const AGENT_KERNEL_CAPABILITIES: AgentKernelCapabilities = {
	backgroundWork: "none",
	sessionResume: false,
	mcp: false,
	hooks: false,
	skills: false,
	plugins: false,
	agents: false,
	toolRestrictions: false,
	structuredOutput: "enforced",
	requiresAllPropertiesRequired: false,
	envInjection: true,
	costControl: false,
	costReporting: false,
	effortControl: false,
	fallbackModel: false,
	sandbox: false,
	settingSources: false,
	nativeTools: false,
	containerExec: false,
};

// ---------------------------------------------------------------------------
// Settings and kernels
// ---------------------------------------------------------------------------

class ProviderError extends Error {
	constructor(
		readonly failureClass: ProviderFailureClass,
		message: string,
	) {
		super(message);
	}
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((v) => typeof v === "string")
	);
}

/** Reads `assistants.agent-kernel`. Archon's strict schema already refused bad config at load. */
export function parseAgentKernelSettings(raw: Record<string, unknown> | undefined): AgentKernelSettings {
	const { catalogRoots, aliases, piAgentDir } = raw ?? {};
	if (
		!Array.isArray(catalogRoots) ||
		catalogRoots.length === 0 ||
		!catalogRoots.every((root) => typeof root === "string")
	) {
		throw new ProviderError(
			"misconfigured",
			"assistants.agent-kernel.catalogRoots must list at least one bundle folder",
		);
	}
	if (aliases !== undefined && !isStringRecord(aliases)) {
		throw new ProviderError("misconfigured", "assistants.agent-kernel.aliases must map names to model refs");
	}
	if (piAgentDir !== undefined && typeof piAgentDir !== "string") {
		throw new ProviderError("misconfigured", "assistants.agent-kernel.piAgentDir must be a path");
	}
	return {
		catalogRoots,
		aliases: aliases ?? {},
		...(piAgentDir !== undefined && { piAgentDir }),
	};
}

export interface CreateArchonKernelOptions<TCalls = unknown> {
	root: string;
	db: KernelDatabase;
	settings: AgentKernelSettings;
	/** A call engine for `kernel.call`, such as the BAML engine of a pack. */
	calls?: KernelCallsConfig<TCalls>;
}

/**
 * The kernel every Archon kernel shares the shape of: the fixed kernel id,
 * state under `root`, Pi sessions under `<root>/.agent-kernel/pi-sessions`,
 * and the catalog roots, aliases and Pi agent dir of the settings.
 */
export function createArchonKernel<TCalls = unknown>(
	opts: CreateArchonKernelOptions<TCalls>,
): KernelInstance<unknown, TCalls> {
	return createKernel<unknown, TCalls>({
		id: ARCHON_KERNEL_ID,
		db: opts.db,
		catalog: { roots: opts.settings.catalogRoots },
		models: { aliases: opts.settings.aliases },
		stateRoot: opts.root,
		piSessionsDir: join(opts.root, ".agent-kernel", "pi-sessions"),
		...(opts.settings.piAgentDir !== undefined && { piAgentDir: opts.settings.piAgentDir }),
		...(opts.calls !== undefined && { calls: opts.calls }),
	});
}

export interface ArchonKernelEntry {
	kernel: KernelInstance;
	db: KernelDatabase;
	settings: AgentKernelSettings;
}

const kernels = new Map<string, Promise<ArchonKernelEntry>>();

/**
 * The cached kernel of `root`. The first call opens `<root>/.agent-kernel/trace.db`
 * and builds the kernel from `assistantConfig`; later calls reuse it and ignore
 * their `assistantConfig`. A failed build is not cached.
 */
export function archonKernel(
	root: string,
	assistantConfig: Record<string, unknown> | undefined,
): Promise<ArchonKernelEntry> {
	let entry = kernels.get(root);
	if (!entry) {
		entry = (async () => {
			const settings = parseAgentKernelSettings(assistantConfig);
			const { db } = openKernelDatabase({ path: kernelDatabasePath(root) });
			await ensureKernelObservabilitySchema(db);
			return { kernel: createArchonKernel({ root, db, settings }), db, settings };
		})();
		entry.catch(() => kernels.delete(root));
		kernels.set(root, entry);
	}
	return entry;
}

// ---------------------------------------------------------------------------
// sendQuery
// ---------------------------------------------------------------------------

/** The trace tags of the node attempt, from the `TRACE_*` variables Archon sets. An empty value is unset. */
export function traceTagsFromEnv(env: Record<string, string | undefined>): TraceTags {
	const tags: TraceTags = {};
	for (const { tag, env: name } of TRACE_TAGS) {
		const value = env[name];
		if (value) tags[tag] = value;
	}
	return tags;
}

/** The last JSON object in `text`, or undefined when it holds none. */
export function lastJsonObject(text: string): Record<string, unknown> | undefined {
	const end = text.lastIndexOf("}");
	for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
		try {
			const value: unknown = JSON.parse(text.slice(start, end + 1));
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				return value as Record<string, unknown>;
			}
		} catch {
			// Not a whole object from this brace; try the one before it.
		}
		if (start === 0) break;
	}
	return undefined;
}

/** A small push queue that an async generator drains. */
function chunkQueue() {
	const items: AgentKernelChunk[] = [];
	let wake: (() => void) | null = null;
	return {
		push(chunk: AgentKernelChunk) {
			items.push(chunk);
			wake?.();
		},
		take(): AgentKernelChunk[] {
			return items.splice(0);
		},
		wait(): Promise<void> {
			return items.length > 0 ? Promise.resolve() : new Promise((resolve) => (wake = resolve));
		},
		clearWake() {
			wake = null;
		},
	};
}

async function* runNode(
	root: string,
	prompt: string,
	cwd: string,
	options: AgentKernelSendQueryOptions,
): AsyncGenerator<AgentKernelChunk> {
	const { kernel, db } = await archonKernel(root, options.assistantConfig);

	const tags = traceTagsFromEnv(options.env ?? {});
	const { run_id: runId, invocation_id: invocationId, attempt_id: attemptId } = tags;
	if (!runId || !invocationId || !attemptId) {
		throw new ProviderError(
			"misconfigured",
			"the node environment has no TRACE_RUN, TRACE_INVOCATION or TRACE_ATTEMPT",
		);
	}
	const bundle = options.model;
	if (!bundle) throw new ProviderError("misconfigured", "the node names no bundle as its model");
	if ((await kernel.registry()).tryGet(bundle) === null) {
		throw new ProviderError("misconfigured", `no bundle named '${bundle}' in assistants.agent-kernel.catalogRoots`);
	}

	const run = await kernel.container({
		kind: ARCHON_RUN_KIND,
		key: [runId],
		traceTags: { ...(tags.engine !== undefined && { engine: tags.engine }), run_id: runId },
	});
	const node = await kernel.container({
		kind: ARCHON_NODE_KIND,
		key: [runId, invocationId, attemptId],
		parent: run,
		...(tags.node_path !== undefined && { label: tags.node_path }),
		workingDir: cwd,
		traceTags: tags,
	});

	// Deltas coalesce into whole blocks, sent at a tool start, a turn end and the end.
	const queue = chunkQueue();
	let block = "";
	const flush = () => {
		if (block !== "") queue.push({ type: "agent_message_chunk", text: block });
		block = "";
	};
	let status: ContainerStatus = "error";
	let outcome: AgentKernelChunk | undefined;
	let failed: unknown;
	const spawn = kernel
		.spawnAgent(bundle, prompt, null, {
			workingDir: cwd,
			containerId: node.id,
			traceTags: tags,
			phase: tags.node_path,
			...(options.abortSignal !== undefined && { signal: options.abortSignal }),
			onTextDelta: (delta) => {
				block += delta;
			},
			onToolActivity: (activity) => {
				if (activity.type === "start") flush();
			},
			onTurnEnd: flush,
		})
		.then(
			(result) => {
				flush();
				if (result.aborted) {
					status = "aborted";
					failed = new Error("the node was cancelled");
					return;
				}
				status = "done";
				const chunk: AgentKernelChunk = { type: "result", text: result.responseText };
				if (result.piSessionId !== undefined) chunk.sessionId = result.piSessionId;
				if (options.outputFormat) {
					const structured = lastJsonObject(result.responseText);
					if (structured !== undefined) chunk.structuredOutput = structured;
				}
				outcome = chunk;
			},
			(error: unknown) => {
				flush();
				status = options.abortSignal?.aborted ? "aborted" : "error";
				failed = error;
			},
		)
		.finally(() => queue.push({ type: "settled" }));

	try {
		while (true) {
			await queue.wait();
			queue.clearWake();
			for (const chunk of queue.take()) {
				if (chunk.type === "settled") {
					await spawn;
					if (failed !== undefined) throw failed;
					if (outcome) yield outcome;
					return;
				}
				yield chunk;
			}
		}
	} finally {
		await spawn;
		await kernel.traceWriter.flush();
		await updateContainerStatus(db, node.id, status, { endedAt: new Date().toISOString() });
	}
}

function failureResult(error: unknown): AgentKernelChunk {
	const message = (error instanceof Error ? error.message : String(error)) || "agent-kernel node failed";
	return {
		type: "result",
		isError: true,
		errors: [message],
		failure: {
			class: error instanceof ProviderError ? error.failureClass : "unknown",
			evidence: message,
		},
	};
}

/**
 * The Archon provider over the kernel of `root`. Archon's factory passes its
 * home folder, so every node of every run writes to `<root>/.agent-kernel/trace.db`.
 */
export function createAgentKernelProvider({ root }: { root: string }): AgentKernelProvider {
	return {
		async checkCredential() {
			// Each bundle's model credentials live in its Pi agent dir, not in Archon.
			return { state: "not_checked", source: "native" };
		},
		async *sendQuery(prompt, cwd, _resumeSessionId, options = {}) {
			try {
				yield* runNode(root, prompt, cwd, options);
			} catch (error) {
				// Cancellation throws, as Archon's providers do: a cancelled turn never settles.
				if (options.abortSignal?.aborted) throw error;
				yield failureResult(error);
			}
			yield { type: "settled" };
		},
		getType: () => "agent-kernel",
		getCapabilities: () => AGENT_KERNEL_CAPABILITIES,
	};
}
