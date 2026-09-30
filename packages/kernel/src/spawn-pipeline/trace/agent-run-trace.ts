import {
	createAgentRunEndEvent,
	createAgentRunStartEvent,
	type RunTraceEventIds,
	type TurnUsage,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";

interface TraceEmissionLogger {
	warn(message: string, data?: Record<string, unknown>): void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

export function safeEmitAgentRunStart(
	traceWriter: TraceWriterSink,
	ids: RunTraceEventIds,
	agentName: string,
	logger: TraceEmissionLogger,
	opts?: {
		parentRunId?: string;
		phase?: string;
		parentToolUseId?: string;
		displayLabel?: string;
	},
): void {
	try {
		emitAgentRunStart(traceWriter, ids, agentName, opts);
	} catch (error) {
		logger.warn("emitAgentRunStart failed", {
			agent: agentName,
			error: errorMessage(error),
		});
	}
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

export function safeEmitAgentRunEnd(
	traceWriter: TraceWriterSink,
	ids: RunTraceEventIds,
	agentName: string,
	status: "ok" | "error",
	logger: TraceEmissionLogger,
	errorMessage?: string,
	usage?: TurnUsage,
): void {
	try {
		emitAgentRunEnd(traceWriter, ids, agentName, status, errorMessage, usage);
	} catch (error) {
		logger.warn("emitAgentRunEnd failed", {
			agent: agentName,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export const _test_emitAgentRunEnd = emitAgentRunEnd;
