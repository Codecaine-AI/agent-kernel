import type { RunContext, RunStateManagerLike, RunTrigger } from "../../run-context";
import type { TraceWriterSink } from "../../subagents/types";

export interface BuildRunContextOptions {
	containerId: string;
	trigger: RunTrigger;
	traceWriter?: TraceWriterSink;
	parentRunId?: string;
	sessionDir?: string;
	piSessionsDir?: string;
	phase?: string;
	userId?: string;
}

export function buildRunContext(
	name: string,
	opts: BuildRunContextOptions,
	workingDir: string,
	stateManager: RunStateManagerLike | null,
	runId: string,
	piSessionUuid?: string,
): RunContext | null {
	if (!opts.traceWriter) return null;
	return {
		containerId: opts.containerId,
		runId,
		trigger: opts.trigger,
		parentRunId: opts.parentRunId,
		agentName: name,
		traceWriter: opts.traceWriter,
		sessionDir: opts.sessionDir,
		piSessionsDir: opts.piSessionsDir,
		workingDir,
		stateManager,
		piSessionUuid,
		userId: opts.userId,
		phase: opts.phase,
	};
}
