/**
 * `@codecaine-ai/agent-kernel/archon-provider`: an Archon agent provider that
 * runs a kernel bundle as an AI node. A node selects it with
 * `provider: agent-kernel` and names the bundle as its `model`.
 *
 * Archon makes a new provider for each node attempt, so the kernels live in a
 * module-scope cache keyed by root and settings. Every provider for one root
 * shares one database handle and one kernel id, providers with equal settings
 * share one kernel, and each node attempt runs in its own `archon-node`
 * container under the run's `archon-run` container.
 *
 * A node with `nodeConfig.model_node` is an extract or decide node of the
 * fork. It runs in the same containers, through `./model-nodes.ts`: an
 * extract on the kernel of its pack, a decide on the base kernel.
 *
 * The Archon provider shape lives in `./contract.ts`, the file the
 * subpath's `types` condition names.
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
import type { CallEngine } from "../model-nodes/types";
import {
	AGENT_KERNEL_CAPABILITIES,
	type AgentKernelChunk,
	type AgentKernelProvider,
	type AgentKernelSendQueryOptions,
	type ProviderFailureClass,
} from "./contract";
import type * as contract from "./contract";
import {
	loadPackCallEngine,
	matchOutputFormat,
	parseModelNode,
	runDecide,
	runExtract,
	type ModelNodeConfig,
	type ModelNodeScope,
	type PackCalls,
} from "./model-nodes";

export {
	AGENT_KERNEL_CAPABILITIES,
	type AgentKernelCapabilities,
	type AgentKernelChunk,
	type AgentKernelProvider,
	type AgentKernelSendQueryOptions,
	type DecideModelNode,
	type DecideResult,
	type ExtractModelNode,
	type ModelNodeConfig,
	type ProviderFailureClass,
} from "./contract";
export { loadPackCallEngine } from "./model-nodes";

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

const databases = new Map<string, Promise<KernelDatabase>>();
/** Base kernels by root and settings, and pack kernels by root, settings and pack folder. */
const kernels = new Map<string, Promise<ArchonKernelEntry>>();

/** The one database handle of `root`, on `<root>/.agent-kernel/trace.db`. A failed open is not cached. */
function archonDatabase(root: string): Promise<KernelDatabase> {
	let entry = databases.get(root);
	if (!entry) {
		entry = (async () => {
			const { db } = openKernelDatabase({ path: kernelDatabasePath(root) });
			await ensureKernelObservabilitySchema(db);
			return db;
		})();
		entry.catch(() => databases.delete(root));
		databases.set(root, entry);
	}
	return entry;
}

/**
 * The cached kernel of `root` and the settings in `assistantConfig`. Equal
 * settings share one kernel. Different settings get their own kernel, on the
 * same database handle, kernel id and state root. A failed build is not cached.
 */
export function archonKernel(
	root: string,
	assistantConfig: Record<string, unknown> | undefined,
): Promise<ArchonKernelEntry> {
	return cachedKernel(root, assistantConfig, null, async () => undefined);
}

/**
 * The cached kernel of the pack at `packDir`: the base kernel's id, database
 * handle, state root, aliases and Pi agent dir, with the call engine that
 * `loadEngine` builds from the pack on first use. `createKernel` takes its
 * call engine once, so each pack needs its own kernel. A failed build is not cached.
 */
export function archonPackKernel(
	root: string,
	assistantConfig: Record<string, unknown> | undefined,
	packDir: string,
	loadEngine: (packDir: string) => Promise<CallEngine<PackCalls>> = loadPackCallEngine,
): Promise<ArchonKernelEntry> {
	return cachedKernel(root, assistantConfig, packDir, () => loadEngine(packDir));
}

function cachedKernel(
	root: string,
	assistantConfig: Record<string, unknown> | undefined,
	packDir: string | null,
	loadEngine: () => Promise<CallEngine<PackCalls> | undefined>,
): Promise<ArchonKernelEntry> {
	const settings = parseAgentKernelSettings(assistantConfig);
	const aliases = Object.entries(settings.aliases).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const key = JSON.stringify([root, settings.catalogRoots, aliases, settings.piAgentDir ?? null, packDir]);
	let entry = kernels.get(key);
	if (!entry) {
		entry = Promise.all([archonDatabase(root), loadEngine()]).then(([db, engine]) => ({
			kernel: createArchonKernel({ root, db, settings, ...(engine !== undefined && { calls: { engine } }) }),
			db,
			settings,
		}));
		entry.catch(() => kernels.delete(key));
		kernels.set(key, entry);
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

/**
 * The node prompt with its output_format schema and the instruction to answer
 * with that JSON only, worded close to Archon's Pi provider. The bundle has no
 * structured_output tool, so the JSON reply is the only way to answer.
 */
function promptWithOutputFormat(prompt: string, schema: Record<string, unknown>): string {
	return `${prompt}

---

Deliver your final answer as your last message: reply with just one JSON object that matches the schema below, without prose or markdown code fences.

Schema:
${JSON.stringify(schema, null, 2)}`;
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
	let modelNode: ModelNodeConfig | undefined;
	try {
		modelNode = parseModelNode(options.nodeConfig?.model_node);
	} catch (error) {
		throw new ProviderError("misconfigured", error instanceof Error ? error.message : String(error));
	}
	const bundle = options.model ?? "";
	if (modelNode === undefined) {
		if (!bundle) throw new ProviderError("misconfigured", "the node names no bundle as its model");
		if ((await kernel.registry()).tryGet(bundle) === null) {
			throw new ProviderError("misconfigured", `no bundle named '${bundle}' in assistants.agent-kernel.catalogRoots`);
		}
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

	if (modelNode !== undefined) {
		yield* runModelNode(root, db, kernel, modelNode, { containerId: node.id, traceTags: tags, prompt }, options);
		return;
	}

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
	// A cancelled node never starts, and a node cancelled while it ran has no result, as in Archon's Pi provider.
	const cancelled = () => options.abortSignal?.aborted === true;
	const input = options.outputFormat ? promptWithOutputFormat(prompt, options.outputFormat.schema) : prompt;
	const spawn = (cancelled() ? Promise.resolve(null) : kernel.spawnAgent(bundle, input, null, {
			workingDir: cwd,
			// The Pi session's working directory. With it, the transcript lands in the kernel's piSessionsDir.
			sessionDir: cwd,
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
		}))
		.then(
			(result) => {
				flush();
				if (result === null || result.aborted || cancelled()) {
					status = "aborted";
					failed = new Error("Query aborted");
					return;
				}
				status = "done";
				const chunk: AgentKernelChunk = { type: "result", text: result.responseText };
				if (result.piSessionId !== undefined) chunk.sessionId = result.piSessionId;
				if (options.outputFormat) {
					const parsed = lastJsonObject(result.responseText);
					const structured = parsed && matchOutputFormat(parsed, options.outputFormat.schema);
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
					// The consumer can cancel between the end of the spawn and this read.
					if (failed === undefined && cancelled()) {
						status = "aborted";
						failed = new Error("Query aborted");
					}
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

/**
 * Runs an extract or decide node in its `archon-node` container and yields
 * its result, with the typed object as the structured output. Flushes the
 * trace writer of the kernel that ran the node and closes the container.
 */
async function* runModelNode(
	root: string,
	db: KernelDatabase,
	base: KernelInstance,
	modelNode: ModelNodeConfig,
	scope: ModelNodeScope,
	options: AgentKernelSendQueryOptions,
): AsyncGenerator<AgentKernelChunk> {
	const cancelled = () => options.abortSignal?.aborted === true;
	const signal = options.abortSignal;
	let ran = base;
	let status: ContainerStatus = "error";
	try {
		if (cancelled()) throw new Error("Query aborted");
		let structured: Record<string, unknown>;
		if (modelNode.kind === "extract") {
			const packDir = options.env?.PACK_DIR;
			if (!packDir) {
				throw new ProviderError(
					"misconfigured",
					"the extract node has an empty PACK_DIR: put the workflow in a pack whose root holds baml_src and the generated baml_client",
				);
			}
			if (!options.outputFormat) throw new ProviderError("misconfigured", "the extract node has no output_format");
			ran = (await archonPackKernel(root, options.assistantConfig, packDir)).kernel;
			structured = await runExtract(ran, modelNode, options.outputFormat.schema, { ...scope, ...(signal && { signal }) });
		} else {
			structured = { ...(await runDecide(base, modelNode, { ...scope, ...(signal && { signal }) })) };
		}
		if (cancelled()) throw new Error("Query aborted");
		status = "done";
		yield { type: "result", text: JSON.stringify(structured), structuredOutput: structured };
	} catch (error) {
		if (cancelled()) status = "aborted";
		throw error;
	} finally {
		await ran.traceWriter.flush();
		await updateContainerStatus(db, scope.containerId, status, { endedAt: new Date().toISOString() });
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

createAgentKernelProvider satisfies typeof contract.createAgentKernelProvider;
