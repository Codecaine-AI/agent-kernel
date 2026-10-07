/**
 * The per-kernel context every model-node factory receives
 * (`createCall(ctx)`, `createDecide(ctx)`, `createStep(ctx)`,
 * `createGate(ctx)`). `createKernel` builds exactly one per kernel instance;
 * tests build their own with `createModelNodeContext` (for example to inject
 * a wall clock).
 */
import type { KernelDatabase } from "@agent-kernel/db";
import type { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { ModelPriceTable } from "../emitter";
import { createNodeClock, type NodeClock } from "./scope";
import {
	DEFAULT_NODE_STALE_AFTER_MS,
	KernelNodeError,
	type KernelCallsConfig,
	type KernelDecideConfig,
} from "./types";

/** Structural twin of the kernel's `KernelLogger`. Model-node logs carry ids, names and kinds only (§4.7). */
export interface ModelNodeLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

/** One lazily built Pi ModelRuntime + ModelRegistry per kernel (see `createPiModels`). */
export interface PiModelsSource {
	runtime(): Promise<ModelRuntime>;
	registry(): Promise<ModelRegistry>;
}

export interface ModelNodeModels {
	aliases: Readonly<Record<string, string>>;
	prices?: ModelPriceTable;
	/** Default model refs (may be aliases). */
	defaults: { call?: string; decide?: string };
}

/** A same-requestId node running in this kernel (§4.6 in-process coalescing). */
export interface InFlightNode {
	kind: "call" | "decision";
	promise: Promise<unknown>;
}

/** Shared by every node kind. Call nodes receive a `CallNodeContext`, which adds the typed calls config. */
export interface ModelNodeContext {
	readonly kernelId: string;
	/** The kernel database; throws KernelNodeError("no-db") when the kernel has none. */
	db(): KernelDatabase;
	/** The kernel's lazy schema upgrade (runs once); await before the first write. */
	ensureSchema(): Promise<void>;
	readonly clock: NodeClock;
	readonly logger?: ModelNodeLogger;
	readonly models: ModelNodeModels;
	/** As passed to createKernel; undefined when the caller configured no decide. */
	readonly decide?: KernelDecideConfig;
	/** The kernel's Pi models (built on first use from piAgentDir). */
	piModels(): PiModelsSource;
	/** Freshness window for a running node run written without deadline_at. */
	readonly staleAfterMs: number;
	/** Keyed by node session id (deterministic from requestId). */
	readonly inFlight: Map<string, InFlightNode>;
}

export interface CallNodeContext<TCalls = unknown> extends ModelNodeContext {
	/** As passed to createKernel; undefined when the caller configured no calls. */
	readonly calls?: KernelCallsConfig<TCalls>;
}

export interface CreateModelNodeContextOptions<TCalls = unknown> {
	kernelId: string;
	db?: KernelDatabase | (() => KernelDatabase | undefined);
	ensureSchema?: () => Promise<void>;
	/** Wall clock behind the node clock. Default Date.now. */
	now?: () => number;
	logger?: ModelNodeLogger;
	models?: { aliases?: Record<string, string>; prices?: ModelPriceTable; defaults?: { call?: string; decide?: string } };
	calls?: KernelCallsConfig<TCalls>;
	decide?: KernelDecideConfig;
	piModels?: () => PiModelsSource;
	staleAfterMs?: number;
}

export function createModelNodeContext<TCalls = unknown>(
	opts: CreateModelNodeContextOptions<TCalls>,
): CallNodeContext<TCalls> {
	const resolveDb = typeof opts.db === "function" ? opts.db : () => opts.db as KernelDatabase | undefined;
	const piModels =
		opts.piModels ??
		(() => {
			throw new KernelNodeError("no-engine", "this kernel has no Pi models source");
		});
	return {
		kernelId: opts.kernelId,
		db() {
			const db = resolveDb();
			if (!db) {
				throw new KernelNodeError("no-db", "model nodes require a database — pass `db` to createKernel");
			}
			return db;
		},
		ensureSchema: opts.ensureSchema ?? (async () => {}),
		clock: createNodeClock(opts.now),
		...(opts.logger !== undefined && { logger: opts.logger }),
		models: {
			aliases: { ...(opts.models?.aliases ?? {}) },
			...(opts.models?.prices !== undefined && { prices: opts.models.prices }),
			defaults: { ...(opts.models?.defaults ?? {}) },
		},
		...(opts.calls !== undefined && { calls: opts.calls }),
		...(opts.decide !== undefined && { decide: opts.decide }),
		piModels,
		staleAfterMs: opts.staleAfterMs ?? DEFAULT_NODE_STALE_AFTER_MS,
		inFlight: new Map(),
	};
}

/** Resolves a model ref through the kernel's aliases, one level, as spawn does (`spawn-config.ts`). */
export function resolveModelAlias(ref: string, aliases: Readonly<Record<string, string>>): string {
	return aliases[ref] ?? ref;
}
