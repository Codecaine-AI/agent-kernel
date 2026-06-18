/**
 * Async run scope carrying per-agent runtime identity and app-provided state.
 *
 * The kernel owns the scope shape. Apps may attach a state manager, trace
 * writer, paths, and app/workflow session identity through this generic
 * context, but those concepts stay adapter-provided.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceWriterSink } from "./subagents/types";

export interface RunStateManagerLike {
	state: Record<string, any>;
	setStatus(status: string): Promise<unknown>;
	setTopic(topic: string): Promise<unknown>;
	transitionToPhase(phase: string): Promise<unknown>;
}

export type RunContext = {
	/** Host application's workflow/session identity. */
	appSessionId?: string;
	appSessionSlug?: string;
	appSessionDir?: string;
	runId: string;
	parentRunId?: string;
	agentName: string;
	traceWriter: TraceWriterSink;
	piSessionsDir?: string;
	workingDir?: string;
	stateManager?: RunStateManagerLike | null;
	piSessionUuid?: string;
	containerId?: string;
	phase?: string;
};

export const runContextStore = new AsyncLocalStorage<RunContext>();

export function runWithContext<T>(
	ctx: RunContext,
	fn: () => Promise<T>,
): Promise<T> {
	return runContextStore.run(ctx, fn);
}

export function getRunContext(): RunContext {
	const ctx = runContextStore.getStore();
	if (!ctx) throw new Error("no run context - call inside spawnAgent");
	return ctx;
}
