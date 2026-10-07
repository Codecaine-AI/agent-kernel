/**
 * createKernel (Phase 4b) — one config object absorbs the former
 * eight-adapter spawn bundle. The kernel builds the agent registry from
 * catalog roots at first use (async, cached), constructs the spawn pipeline
 * internally, and exposes the standard runtime surface: spawnAgent,
 * container(), agentManager, traceWriter, readApiService, doctor(),
 * dispose(). Genuinely app-shaped injections remain as functions:
 * appContext, loaders, sharedTools, createSessionBinding, logger.
 */
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { upgradeKernelObservabilitySchema, type KernelDatabase } from "@agent-kernel/db";

import {
	buildRegistry,
	registerPromptRevisions,
	syncAgentPromptFromDisk,
	type AgentRegistry,
	type CatalogRootSpec,
} from "./agent-registry";
import {
	createKernelCatalogService,
	type CreateKernelCatalogServiceOptions,
	type KernelCatalogService,
} from "./catalog-service";
import { createContainerApi, type KernelContainerApi } from "./containers";
import {
	createDefaultCatalog,
	type AppSessionData,
	type Loader,
	type LoaderCatalog,
} from "./context";
import { runTraceDoctor, type DoctorReport } from "./doctor";
import type { ModelPriceTable } from "./emitter";
import { createModelNodeContext, createModelNodes } from "./model-nodes";
import { createPiModels, type PiModelsHandle } from "./model-nodes/pi-models";
import type {
	CallArgs,
	DecisionOutcome,
	DecisionQuestion,
	DecisionState,
	FnName,
	GateCheckSpec,
	GateResult,
	KernelCallOptions,
	KernelCallResult,
	KernelCallsConfig,
	KernelDecideConfig,
	KernelDecideOptions,
	KernelGateOptions,
	KernelNodesConfig,
	KernelStepOptions,
	StepSpan,
} from "./model-nodes/types";
import { createContainerReadService, type KernelReadApiService } from "./read-service";
import type { RunStateManagerLike } from "./run-context";
import { resolveSpawnConfig } from "./spawn-config";
import {
	createSpawnAgent,
	type KernelSpawnAgent,
	type KernelSpawnAgentResult,
	type KernelSpawnOptions,
} from "./spawn-pipeline/spawn-agent";
import type { AgentConfig } from "./spawn-pipeline/types";
import type { SessionBindingInput } from "./spawn-pipeline/pi-session-factory";
import { AgentManager, bindSpawnerTools, type AgentSpawnResult } from "./subagents";
import { createDbTraceWriter, type KernelTraceWriter } from "./trace-writer";

export const DEFAULT_MAX_BACKGROUND_AGENTS = 4;
export const DEFAULT_SESSION_BINDING_CUSTOM_TYPE = "agent-kernel:session-binding";

export interface KernelConcurrencyConfig {
	maxBackgroundAgents?: number;
}

export interface ResolvedKernelConcurrencyConfig {
	maxBackgroundAgents: number;
}

export interface KernelModelsConfig {
	/**
	 * Model aliases resolved at spawn: manifest (or variant) model strings are
	 * looked up here and the RESOLVED model lands on the session row and in
	 * events. Fleet-wide retargeting is one config edit.
	 */
	aliases?: Record<string, string>;
	/** Prices per resolved model string — powers per-turn costEstimate. */
	prices?: ModelPriceTable;
	/** Default model refs for model nodes. Values may be aliases. Not listed as agent models. */
	defaults?: { call?: string; decide?: string };
}

export interface KernelLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

/** Per-spawn app-shaped context returned by the `appContext` injection. */
export interface KernelAppContext {
	/** Becomes RunContext.stateManager for the spawned run. */
	stateManager?: RunStateManagerLike | null;
	/** Forwarded to context loaders via SpawnContext.sessionData. */
	sessionData?: AppSessionData | null;
}

export interface KernelAppContextInput {
	agentName: string;
	/** Effective working directory for the spawn, when resolvable. */
	cwd?: string;
	options: KernelSpawnOptions;
}

export interface CreateKernelConfig<TToolRuntime = unknown, TCalls = unknown> {
	id?: string;
	/**
	 * Kernel trace database handle (SQLite by default — see
	 * @agent-kernel/db openKernelDatabase). Required for container(),
	 * traceWriter, readApiService, doctor(), and spawnAgent.
	 */
	db?: KernelDatabase;
	/**
	 * Agent catalog roots scanned for agent.json bundles at first use. A root
	 * may be `{ path, listed: false }` to keep its agents spawnable and directly
	 * addressable while hiding them from catalog browsing. Strings stay listed.
	 */
	catalog?: { roots: CatalogRootSpec[] };
	models?: KernelModelsConfig;
	/** Named tool bundles referenced by manifest `toolProfiles`. */
	toolProfiles?: Record<string, string[]>;
	/** App loaders registered into the default context-loader catalog. */
	loaders?: Loader[];
	/** Shared tool factories appended to every spawned session. */
	sharedTools?: (config: AgentConfig) => ExtensionFactory[];
	/** Runtime handle passed to each agent's private tools.ts register fn. */
	toolRuntime?: TToolRuntime;
	/** Per-spawn app context (stateManager / sessionData injection). */
	appContext?: (input: KernelAppContextInput) => KernelAppContext | undefined;
	/** Default Pi session JSONL directory for spawns that don't override it. */
	piSessionsDir?: string;
	/** Default Pi agent dir (auth/models/settings) for spawned sessions. */
	piAgentDir?: string;
	/**
	 * Filesystem root the state.json tree hangs off — snapshots land at
	 * `<stateRoot>/.agent-kernel/state/<containerId>/<agentName>/state.json`.
	 * Defaults per-spawn to the spawn's working directory. Only agents with an
	 * active state extension write anything (D88).
	 */
	stateRoot?: string;
	/** Default actor correlation stamped onto emitted events. */
	defaultUserId?: string;
	concurrency?: KernelConcurrencyConfig;
	/**
	 * JSONL session-binding marker factory. Defaults to the standard
	 * "agent-kernel:session-binding" marker carrying sessionDir + phase (the
	 * pipeline always merges containerId + runId into the payload).
	 */
	createSessionBinding?: (opts: KernelSpawnOptions) => SessionBindingInput | undefined;
	/** Custom type for Pi lifecycle JSONL entries (backfill parity). */
	piLifecycleCustomType?: string;
	/** Custom type for parent-session subagent link entries. */
	subagentLinkCustomType?: string;
	/**
	 * Capture per-turn pi_request_snapshot events (system prompt + sanitized
	 * context messages into trace_blobs) for every spawn. Default true;
	 * per-spawn `opts.captureRequestSnapshots` overrides.
	 */
	captureRequestSnapshots?: boolean;
	logger?: KernelLogger;
	/** Typed model calls (`kernel.call`) through a CallEngine, e.g. the BAML engine. */
	calls?: KernelCallsConfig<TCalls>;
	/** Decisions (`kernel.decide`) through Pi classify(). */
	decide?: KernelDecideConfig;
	/** Model-node lifecycle settings. */
	nodes?: KernelNodesConfig;
}

export interface KernelInstance<TToolRuntime = unknown, TCalls = unknown> {
	readonly id: string;
	readonly concurrency: ResolvedKernelConcurrencyConfig;
	readonly db: KernelDatabase | undefined;
	/** Subagent manager wired over this kernel's spawn pipeline. */
	readonly agentManager: AgentManager;
	/** Default trace sink writing into the kernel db (submit + flush). */
	readonly traceWriter: KernelTraceWriter;
	/** Container-backed default read service for createKernelTraceReadApi. */
	readonly readApiService: KernelReadApiService;
	/**
	 * Catalog service for createKernelCatalogApi (Phase 5): registry listing,
	 * agent detail, prompt saves, revision history, per-revision run stats.
	 * The save path mutates catalog files on disk — pass `allowWrites: true`
	 * only when the kernel runs in dev mode; production harnesses ship
	 * read-only catalogs (the PUT route answers 403).
	 */
	catalogApiService(opts?: {
		allowWrites?: boolean;
		toolsPreview?: CreateKernelCatalogServiceOptions["toolsPreview"];
	}): KernelCatalogService;
	/**
	 * Spawn a catalog agent. Builds the registry from catalog.roots on first
	 * use. `opts.variant` selects a manifest variant; model aliases resolve
	 * before the session is created.
	 */
	spawnAgent(
		name: string,
		prompt: string,
		ctx?: ExtensionContext | null,
		opts?: KernelSpawnOptions,
	): Promise<KernelSpawnAgentResult>;
	/**
	 * Deterministic, idempotent container upsert: same (kind, key) always
	 * resolves to the same container id. Requires `db` in the kernel config.
	 */
	container: KernelContainerApi;
	/** The agent registry (built and cached on first call). */
	registry(): Promise<AgentRegistry>;
	/** Run the trace doctor over the kernel db (flushes pending writes first). */
	doctor(): Promise<DoctorReport>;
	/** One typed model call through `config.calls.engine`, traced as a call node (plan §3.4). */
	call<K extends FnName<TCalls>>(
		name: K,
		args: CallArgs<TCalls, K>,
		opts?: KernelCallOptions,
	): Promise<KernelCallResult<TCalls, K>>;
	/** One classification through Pi classify(), traced as a decision node (plan §3.5). */
	decide<Q extends Record<string, DecisionQuestion>>(
		name: string,
		state: DecisionState,
		opts: KernelDecideOptions<Q>,
	): Promise<DecisionOutcome<Q>>;
	/** A traced span around deterministic harness code (plan §3.6). */
	step<T>(name: string, opts: KernelStepOptions<T>, fn: (span: StepSpan) => T | Promise<T>): Promise<T>;
	/** Ordered step/decide checks combined into one verdict (plan §3.6). */
	gate(name: string, opts: KernelGateOptions, checks: readonly GateCheckSpec[]): Promise<GateResult>;
	setMaxBackgroundAgents(limit: number): void;
	dispose(): void;
}

export function normalizeBackgroundAgentLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_MAX_BACKGROUND_AGENTS;
	if (!Number.isFinite(limit)) return DEFAULT_MAX_BACKGROUND_AGENTS;
	return Math.max(1, Math.floor(limit));
}

function defaultSessionBinding(opts: KernelSpawnOptions): SessionBindingInput {
	return {
		customType: DEFAULT_SESSION_BINDING_CUSTOM_TYPE,
		data: {
			...(opts.sessionDir !== undefined && { sessionDir: opts.sessionDir }),
			...(opts.phase !== undefined && { phase: opts.phase }),
		},
	};
}

export function createKernel<TToolRuntime = unknown, TCalls = unknown>(
	config: CreateKernelConfig<TToolRuntime, TCalls> = {},
): KernelInstance<TToolRuntime, TCalls> {
	const id = config.id ?? "agent-kernel";
	let maxBackgroundAgents = normalizeBackgroundAgentLimit(
		config.concurrency?.maxBackgroundAgents,
	);

	function requireDb(feature: string): KernelDatabase {
		if (!config.db) {
			throw new Error(
				`kernel.${feature} requires a database — pass \`db\` to createKernel`,
			);
		}
		return config.db;
	}

	// Lazy, once per kernel: additive columns an older database lacks, before
	// the first write (spawnAgent, call, decide, step, gate). A read-only or
	// failing upgrade only warns; readers stay compatible (read-compat.ts).
	let schemaUpgrade: Promise<void> | null = null;
	function ensureSchema(): Promise<void> {
		const db = config.db;
		if (!db) return Promise.resolve();
		if (!schemaUpgrade) {
			schemaUpgrade = upgradeKernelObservabilitySchema(db).then(
				(report) => {
					if (report.readOnly) {
						config.logger?.warn("kernel schema upgrade skipped: database is read-only", {
							skipped: report.skipped,
						});
					}
				},
				(error: unknown) => {
					config.logger?.warn("kernel schema upgrade failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				},
			);
		}
		return schemaUpgrade;
	}

	let piModelsInstance: PiModelsHandle | null = null;
	const modelNodes = createModelNodes(
		createModelNodeContext<TCalls>({
			kernelId: id,
			db: () => config.db,
			ensureSchema,
			...(config.logger !== undefined && { logger: config.logger }),
			models: {
				...(config.models?.aliases !== undefined && { aliases: config.models.aliases }),
				...(config.models?.prices !== undefined && { prices: config.models.prices }),
				...(config.models?.defaults !== undefined && { defaults: config.models.defaults }),
			},
			...(config.calls !== undefined && { calls: config.calls }),
			...(config.decide !== undefined && { decide: config.decide }),
			piModels: () => {
				if (config.nodes?.piModels !== undefined) return config.nodes.piModels;
				piModelsInstance ??= createPiModels(
					config.piAgentDir !== undefined ? { piAgentDir: config.piAgentDir } : {},
				);
				return piModelsInstance;
			},
			...(config.nodes?.staleAfterMs !== undefined && { staleAfterMs: config.nodes.staleAfterMs }),
		}),
	);

	let traceWriterInstance: KernelTraceWriter | null = null;
	function traceWriter(): KernelTraceWriter {
		if (!traceWriterInstance) {
			traceWriterInstance = createDbTraceWriter(requireDb("traceWriter"), config.logger);
		}
		return traceWriterInstance;
	}

	let readServiceInstance: KernelReadApiService | null = null;
	function readApiService(): KernelReadApiService {
		if (!readServiceInstance) {
			readServiceInstance = createContainerReadService({
				db: requireDb("readApiService"),
				kernelId: id,
				beforeRead: () => traceWriter().flush(),
			});
		}
		return readServiceInstance;
	}

	interface KernelRuntime {
		registry: AgentRegistry;
		spawn: KernelSpawnAgent;
	}

	let runtimePromise: Promise<KernelRuntime> | null = null;
	function runtime(): Promise<KernelRuntime> {
		if (!runtimePromise) {
			runtimePromise = buildRuntime().catch((err) => {
				// Don't cache a failed boot: the next call retries (catalog fixes
				// land without restarting the process; hard errors just recur).
				runtimePromise = null;
				throw err;
			});
		}
		return runtimePromise;
	}

	// One loader-catalog factory for both consumers — the spawn pipeline and
	// the catalog service's context preview — so a declaration resolves the
	// same way in a preview as it does in a real spawn.
	function createContextLoaderCatalog(): LoaderCatalog {
		const catalog = createDefaultCatalog();
		for (const loader of config.loaders ?? []) catalog.register(loader);
		return catalog;
	}

	async function buildRuntime(): Promise<KernelRuntime> {
		const roots = config.catalog?.roots ?? [];
		if (roots.length === 0) {
			throw new Error(
				"kernel.spawnAgent requires an agent catalog — pass `catalog: { roots }` to createKernel",
			);
		}
		const registry = await buildRegistry({
			roots,
			toolProfiles: config.toolProfiles,
		});
		if (config.db) {
			await registerPromptRevisions(config.db, registry);
		}
		const spawn = createSpawnAgent({
			loadAgent: (name, opts) =>
				resolveSpawnConfig(registry.get(name), opts.variant, config.models?.aliases)
					.parsed,
			loadAgentResolver: async (name) => registry.get(name).contextResolver,
			loadAgentState: async (name) => {
				const def = registry.get(name);
				return {
					module: def.stateModule,
					window: def.stateConfig?.window ?? null,
				};
			},
			buildPrivateRegisterFactory: async (name) => {
				const privateTools = registry.get(name).privateTools;
				if (!privateTools) return null;
				// D77: spawner tools registered by tools.ts get their scoped
				// dispatch handle bound to this kernel's AgentManager here.
				return (pi) =>
					privateTools(
						bindSpawnerTools(pi, {
							agentManager,
							toolRuntime: config.toolRuntime,
							hasAgent: (agentName) => registry.tryGet(agentName) !== null,
						}),
						config.toolRuntime,
					);
			},
			buildToolFactories: (agentConfig) => config.sharedTools?.(agentConfig) ?? [],
			createContextCatalog: createContextLoaderCatalog,
			getDb: () => requireDb("spawnAgent"),
			modelPrices: config.models?.prices,
			createSessionBinding: config.createSessionBinding ?? defaultSessionBinding,
			piLifecycleCustomType: config.piLifecycleCustomType,
			logger: config.logger,
			lifecycleLogger: config.logger,
		});
		return { registry, spawn };
	}

	async function spawnAgent(
		name: string,
		prompt: string,
		ctx?: ExtensionContext | null,
		opts: KernelSpawnOptions = {},
	): Promise<KernelSpawnAgentResult> {
		await ensureSchema();
		const { registry, spawn } = await runtime();
		// Disk-freshness: a prompt.json rewritten out-of-band hot-swaps in (and
		// registers its disk-sync revision) before the spawn freezes a prompt.
		const def = await syncAgentPromptFromDisk(config.db ?? null, registry, name);
		// Validates the variant up front and resolves its display label; the
		// pipeline re-resolves the config through the same pure function.
		const resolved = resolveSpawnConfig(def, opts.variant, config.models?.aliases);
		const cwd = opts.workingDir ?? ctx?.cwd;
		const appCtx = config.appContext?.({
			agentName: name,
			...(cwd !== undefined && { cwd }),
			options: opts,
		});
		const mergedOpts: KernelSpawnOptions = {
			...opts,
			displayLabel: opts.displayLabel ?? resolved.displayLabel,
			piSessionsDir: opts.piSessionsDir ?? config.piSessionsDir,
			piAgentDir: opts.piAgentDir ?? config.piAgentDir,
			stateRoot: opts.stateRoot ?? config.stateRoot,
			userId: opts.userId ?? config.defaultUserId,
			traceWriter: opts.traceWriter ?? (config.db ? traceWriter() : undefined),
			captureRequestSnapshots:
				opts.captureRequestSnapshots ?? config.captureRequestSnapshots,
			stateManager: opts.stateManager ?? appCtx?.stateManager ?? null,
			sessionData: opts.sessionData ?? appCtx?.sessionData,
		};
		return spawn(name, prompt, ctx, mergedOpts);
	}

	const agentManager = new AgentManager(undefined, maxBackgroundAgents, undefined, {
		spawnAgent: (agentName, prompt, ctx, options) =>
			spawnAgent(
				agentName,
				prompt,
				ctx as unknown as ExtensionContext | null,
				options as KernelSpawnOptions,
			) as unknown as Promise<AgentSpawnResult>,
		...(config.db ? { traceWriter: traceWriter() } : {}),
		...(config.subagentLinkCustomType
			? { subagentLinkCustomType: config.subagentLinkCustomType }
			: {}),
	});

	const container = createContainerApi({ kernelId: id, db: config.db });

	return {
		id,
		get concurrency() {
			return { maxBackgroundAgents };
		},
		db: config.db,
		agentManager,
		get traceWriter() {
			return traceWriter();
		},
		get readApiService() {
			return readApiService();
		},
		catalogApiService(opts = {}) {
			return createKernelCatalogService({
				registry: () => runtime().then((r) => r.registry),
				db: () => requireDb("catalogApiService"),
				allowWrites: opts.allowWrites ?? false,
				modelAliases: () => Object.keys(config.models?.aliases ?? {}),
				contextCatalog: createContextLoaderCatalog,
				...(opts.toolsPreview !== undefined
					? { toolsPreview: opts.toolsPreview }
					: {}),
			});
		},
		spawnAgent,
		container,
		registry: () => runtime().then((r) => r.registry),
		async doctor() {
			const db = requireDb("doctor");
			if (traceWriterInstance) await traceWriterInstance.flush();
			return runTraceDoctor(db);
		},
		call: modelNodes.call,
		decide: modelNodes.decide,
		step: modelNodes.step,
		gate: modelNodes.gate,
		setMaxBackgroundAgents(limit: number) {
			maxBackgroundAgents = normalizeBackgroundAgentLimit(limit);
			agentManager.setMaxConcurrent(maxBackgroundAgents);
		},
		dispose() {
			agentManager.dispose();
		},
	};
}

export * from "./containers";
export * from "./doctor";
export * from "./run-context";
export * from "./subagents";
export * from "./context";
export * from "./events";
export * from "./agent-definition";
export * from "./agent-registry";
export * from "./state";
export * from "./spawn-pipeline";
export * from "./emitter";
export * from "./spawn-config";
export * from "./trace-writer";
export * from "./read-service";
export * from "./catalog-service";
export * from "./prompt-edit-session";
export * from "./model-nodes/types";
