import type { RunContext, RunStateManagerLike } from "../../run-context";
import type { TraceWriterSink } from "../../subagents/types";

export interface BuildRunContextOptions {
	appSessionId?: string;
	appSessionSlug?: string;
	appSessionDir?: string;
	traceWriter?: TraceWriterSink;
	parentRunId?: string;
	piSessionsDir?: string;
	containerId?: string;
	phase?: string;
}

export function buildRunContext(
	name: string,
	opts: BuildRunContextOptions,
	workingDir: string,
	stateManager: RunStateManagerLike | null,
	runId: string,
	piSessionUuid?: string,
): RunContext | null {
	if (!opts.appSessionId || !opts.appSessionSlug || !opts.traceWriter) return null;
	return {
		appSessionId: opts.appSessionId,
		appSessionSlug: opts.appSessionSlug,
		appSessionDir: opts.appSessionDir,
		runId,
		parentRunId: opts.parentRunId,
		agentName: name,
		traceWriter: opts.traceWriter,
		piSessionsDir: opts.piSessionsDir,
		workingDir,
		stateManager,
		piSessionUuid,
		containerId: opts.containerId,
		phase: opts.phase,
	};
}
