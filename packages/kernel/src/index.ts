import type { KernelDatabase } from "@agent-kernel/db";

import { createContainerApi, type KernelContainerApi } from "./containers";

export const DEFAULT_MAX_BACKGROUND_AGENTS = 4;

export interface KernelConcurrencyConfig {
	maxBackgroundAgents?: number;
}

export interface ResolvedKernelConcurrencyConfig {
	maxBackgroundAgents: number;
}

export type KernelSpawnAdapter<
	TContext = unknown,
	TOptions = Record<string, unknown>,
	TResult = unknown,
> = (
	name: string,
	prompt: string,
	ctx?: TContext | null,
	opts?: TOptions,
) => Promise<TResult>;

export interface KernelAgentManagerLike {
	setMaxConcurrent?: (limit: number) => void;
	dispose?: () => void;
}

export interface CreateAgentManagerInput<
	TContext = unknown,
	TOptions = Record<string, unknown>,
	TResult = unknown,
> {
	kernelId: string;
	maxConcurrentBackgroundAgents: number;
	spawnAgent: KernelSpawnAdapter<TContext, TOptions, TResult>;
}

export interface KernelConfig<
	TContext = unknown,
	TOptions = Record<string, unknown>,
	TResult = unknown,
	TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> {
	id?: string;
	concurrency?: KernelConcurrencyConfig;
	/**
	 * Kernel trace database handle (SQLite by default — see
	 * @agent-kernel/db openKernelDatabase). Required for kernel.container().
	 */
	db?: KernelDatabase;
	spawnAgent: KernelSpawnAdapter<TContext, TOptions, TResult>;
	createAgentManager?: (
		input: CreateAgentManagerInput<TContext, TOptions, TResult>,
	) => TAgentManager;
}

export interface KernelInstance<
	TContext = unknown,
	TOptions = Record<string, unknown>,
	TResult = unknown,
	TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> {
	readonly id: string;
	readonly concurrency: ResolvedKernelConcurrencyConfig;
	readonly agentManager: TAgentManager;
	readonly db: KernelDatabase | undefined;
	spawnAgent: KernelSpawnAdapter<TContext, TOptions, TResult>;
	/**
	 * Deterministic, idempotent container upsert: same (kind, key) always
	 * resolves to the same container id. Requires `db` in the kernel config.
	 */
	container: KernelContainerApi;
	setMaxBackgroundAgents(limit: number): void;
	dispose(): void;
}

export function normalizeBackgroundAgentLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_MAX_BACKGROUND_AGENTS;
	if (!Number.isFinite(limit)) return DEFAULT_MAX_BACKGROUND_AGENTS;
	return Math.max(1, Math.floor(limit));
}

export function createKernel<
	TContext = unknown,
	TOptions = Record<string, unknown>,
	TResult = unknown,
	TAgentManager extends KernelAgentManagerLike | undefined = undefined,
>(
	config: KernelConfig<TContext, TOptions, TResult, TAgentManager>,
): KernelInstance<TContext, TOptions, TResult, TAgentManager> {
	const id = config.id ?? "agent-kernel";
	let maxBackgroundAgents = normalizeBackgroundAgentLimit(
		config.concurrency?.maxBackgroundAgents,
	);

	const spawnAgent: KernelSpawnAdapter<TContext, TOptions, TResult> = (
		name,
		prompt,
		ctx,
		opts,
	) => config.spawnAgent(name, prompt, ctx, opts);

	const agentManager = config.createAgentManager?.({
		kernelId: id,
		maxConcurrentBackgroundAgents: maxBackgroundAgents,
		spawnAgent,
	}) as TAgentManager;

	const container = createContainerApi({ kernelId: id, db: config.db });

	return {
		id,
		get concurrency() {
			return { maxBackgroundAgents };
		},
		agentManager,
		db: config.db,
		spawnAgent,
		container,
		setMaxBackgroundAgents(limit: number) {
			maxBackgroundAgents = normalizeBackgroundAgentLimit(limit);
			agentManager?.setMaxConcurrent?.(maxBackgroundAgents);
		},
		dispose() {
			agentManager?.dispose?.();
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
export * from "./spawn-pipeline";
export * from "./emitter";
