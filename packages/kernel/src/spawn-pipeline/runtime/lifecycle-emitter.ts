import { newSpanId } from "@agent-kernel/protocol";

import {
	createSpawnLifecycleEmitter,
	type LifecycleEmitter,
	type KernelLoggerLike,
} from "../../events";
import { runContextStore } from "../../run-context";
import type { TraceWriterSink } from "../../subagents/types";

export type { LifecycleEmitter, KernelLoggerLike };

export function resolveLifecycleEmitter(
	agentName: string,
	explicitTraceWriter?: TraceWriterSink,
	explicitAppSessionId?: string,
	piSessionUuid?: string,
	logger?: KernelLoggerLike,
): LifecycleEmitter | null {
	const store = runContextStore.getStore();
	const traceWriter = explicitTraceWriter ?? store?.traceWriter;
	const appSessionId = explicitAppSessionId ?? store?.appSessionId;
	if (!traceWriter || !appSessionId) return null;
	return createSpawnLifecycleEmitter({
		appSessionId,
		agentName,
		traceWriter,
		spawnSpanId: newSpanId(),
		piSessionUuid,
		logger,
	});
}
