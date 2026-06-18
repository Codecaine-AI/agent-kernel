import {
	SYSTEM_USER_ID,
	createAgentRunEndEvent,
	createAgentRunStartEvent,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";

export function emitAgentRunStart(
	traceWriter: TraceWriterSink,
	appSessionId: string,
	agentName: string,
	runId: string,
	parentRunId?: string,
	piSessionUuid?: string,
	containerId?: string,
	phase?: string,
	parentToolUseId?: string,
	displayLabel?: string,
): void {
	traceWriter.submit(
		createAgentRunStartEvent(appSessionId, SYSTEM_USER_ID, agentName, runId, {
			parentRunId,
			piSessionUuid,
			containerId,
			phase,
			parentToolUseId,
			displayLabel,
		}),
	);
}

export function emitAgentRunEnd(
	traceWriter: TraceWriterSink,
	appSessionId: string,
	agentName: string,
	runId: string,
	status: "ok" | "error",
	errorMessage?: string,
	piSessionUuid?: string,
): void {
	traceWriter.submit(
		status === "error"
			? createAgentRunEndEvent(appSessionId, SYSTEM_USER_ID, agentName, runId, "error", {
					errorMessage: errorMessage ?? "",
					piSessionUuid,
				})
			: createAgentRunEndEvent(appSessionId, SYSTEM_USER_ID, agentName, runId, "ok", {
					piSessionUuid,
				}),
	);
}

export const _test_emitAgentRunEnd = emitAgentRunEnd;
