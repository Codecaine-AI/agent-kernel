import {
	createAgentRunEndEvent,
	createAgentRunStartEvent,
	type RunTraceEventIds,
	type TurnUsage,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";

export function emitAgentRunStart(
	traceWriter: TraceWriterSink,
	ids: RunTraceEventIds,
	agentName: string,
	opts?: {
		parentRunId?: string;
		phase?: string;
		parentToolUseId?: string;
		displayLabel?: string;
	},
): void {
	traceWriter.submit(
		createAgentRunStartEvent(ids, agentName, {
			parentRunId: opts?.parentRunId,
			phase: opts?.phase,
			parentToolUseId: opts?.parentToolUseId,
			displayLabel: opts?.displayLabel,
		}),
	);
}

export function emitAgentRunEnd(
	traceWriter: TraceWriterSink,
	ids: RunTraceEventIds,
	agentName: string,
	status: "ok" | "error",
	errorMessage?: string,
	usage?: TurnUsage,
): void {
	traceWriter.submit(
		status === "error"
			? createAgentRunEndEvent(ids, agentName, "error", {
					errorMessage: errorMessage ?? "",
					...(usage ? { usage } : {}),
				})
			: createAgentRunEndEvent(ids, agentName, "ok", usage ? { usage } : undefined),
	);
}

export const _test_emitAgentRunEnd = emitAgentRunEnd;
