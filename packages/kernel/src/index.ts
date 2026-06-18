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
	spawnAgent: KernelSpawnAdapter<TContext, TOptions, TResult>;
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

	return {
		id,
		get concurrency() {
			return { maxBackgroundAgents };
		},
		agentManager,
		spawnAgent,
		setMaxBackgroundAgents(limit: number) {
			maxBackgroundAgents = normalizeBackgroundAgentLimit(limit);
			agentManager?.setMaxConcurrent?.(maxBackgroundAgents);
		},
		dispose() {
			agentManager?.dispose?.();
		},
	};
}

export * from "./run-context";
export * from "./subagents";
export * from "./context";
export * from "./events";
export * from "./agent-registry";
export * from "./spawn-pipeline";
