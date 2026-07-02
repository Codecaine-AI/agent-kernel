import { newSpanId, type TraceEventIds } from "@agent-kernel/protocol";

import {
	createSpawnLifecycleEmitter,
	type LifecycleEmitter,
	type KernelLoggerLike,
} from "../../events";
import { runContextStore, traceIdsOf } from "../../run-context";
import type { TraceWriterSink } from "../../subagents/types";

export type { LifecycleEmitter, KernelLoggerLike };

export interface ResolveLifecycleEmitterOptions {
	traceWriter?: TraceWriterSink;
	/**
	 * Envelope identity for the spawn being traced. When omitted, identity is
	 * read from the ambient run context (currentTraceIds semantics).
	 */
	ids?: TraceEventIds;
	logger?: KernelLoggerLike;
}

export function resolveLifecycleEmitter(
	agentName: string,
	opts: ResolveLifecycleEmitterOptions = {},
): LifecycleEmitter | null {
	const store = runContextStore.getStore();
	const traceWriter = opts.traceWriter ?? store?.traceWriter;
	const ids = opts.ids ?? (store ? traceIdsOf(store) : undefined);
	if (!traceWriter || !ids) return null;
	return createSpawnLifecycleEmitter({
		ids,
		agentName,
		traceWriter,
		spawnSpanId: newSpanId(),
		logger: opts.logger,
	});
}
