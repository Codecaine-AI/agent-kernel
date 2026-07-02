/**
 * Async run scope carrying per-agent runtime identity and app-provided state.
 *
 * The kernel owns the scope shape and stamps envelope identity from it:
 * `containerId` is the primary grouping identity (see
 * docs/10-system-design/15-identity-model.md), `runId` links every event to
 * the run that emitted it. Emit sites build TraceEventIds through
 * `currentTraceIds()` / `traceIdsOf()` — never by hand.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { RunTrigger } from "@agent-kernel/db";
import type { TraceEventIds } from "@agent-kernel/protocol";

import type { TraceWriterSink } from "./subagents/types";

export type { RunTrigger };

export interface RunStateManagerLike {
	state: Record<string, any>;
	setStatus(status: string): Promise<unknown>;
	setTopic(topic: string): Promise<unknown>;
	transitionToPhase(phase: string): Promise<unknown>;
}

export type RunContext = {
	/** Primary grouping identity — required on every event this run emits. */
	containerId: string;
	runId: string;
	/** What opened the run: operator | parent-tool | steer | resume | system. */
	trigger: RunTrigger;
	agentName: string;
	traceWriter: TraceWriterSink;
	parentRunId?: string;
	/** Session working directory for pipeline file layout (Pi session storage root). */
	sessionDir?: string;
	piSessionsDir?: string;
	workingDir?: string;
	stateManager?: RunStateManagerLike | null;
	piSessionUuid?: string;
	/** Optional actor correlation stamped onto envelope identity. */
	userId?: string;
	agentId?: string;
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

/** Envelope identity for a specific run context. */
export function traceIdsOf(ctx: RunContext): TraceEventIds & { runId: string } {
	return {
		containerId: ctx.containerId,
		runId: ctx.runId,
		...(ctx.userId !== undefined && { userId: ctx.userId }),
		...(ctx.agentId !== undefined && { agentId: ctx.agentId }),
		...(ctx.piSessionUuid !== undefined && { piSessionUuid: ctx.piSessionUuid }),
	};
}

/**
 * Envelope identity from the ambient async-local run context. Every emit
 * site builds its TraceEventIds here so identity comes from one place.
 * Throws when called outside a run scope.
 */
export function currentTraceIds(): TraceEventIds & { runId: string } {
	return traceIdsOf(getRunContext());
}
