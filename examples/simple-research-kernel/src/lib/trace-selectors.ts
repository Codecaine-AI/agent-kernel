import type {
	ContextBuildCompletedData,
	KernelTraceSessionDetail,
	SystemPromptResolvedData
} from "@agent-kernel/viewer-core";

import type {
	AgentContextPreviewSummary,
	AgentRuntimeSummary,
	RenderedPromptSummary
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSystemPromptResolvedData(value: unknown): value is SystemPromptResolvedData {
	return (
		isRecord(value) &&
		typeof value.agent_name === "string" &&
		typeof value.rendered_prompt === "string" &&
		Array.isArray(value.tools_allowlist) &&
		Array.isArray(value.tools_disallowlist) &&
		isRecord(value.variables_resolved)
	);
}

function isContextBuildCompletedData(value: unknown): value is ContextBuildCompletedData {
	return (
		isRecord(value) &&
		Array.isArray(value.inputs) &&
		typeof value.rendered_context === "string" &&
		typeof value.total_bytes === "number"
	);
}

export function collectLatestRenderedPrompts(
	detail: KernelTraceSessionDetail | null
): Record<string, RenderedPromptSummary> {
	if (!detail) return {};

	const byAgent: Record<string, RenderedPromptSummary> = {};
	for (const event of detail.events) {
		if (event.type !== "system_prompt_resolved") continue;
		if (!isSystemPromptResolvedData(event.eventData)) continue;

		const agentName = event.eventData.agent_name;
		const existing = byAgent[agentName];
		if (existing && existing.timestamp >= event.timestamp) continue;

		byAgent[agentName] = {
			agentName,
			piSessionId: event.piSessionId ?? null,
			timestamp: event.timestamp,
			renderedPrompt: event.eventData.rendered_prompt,
			toolsAllowlist: event.eventData.tools_allowlist,
			toolsDisallowlist: event.eventData.tools_disallowlist,
			variablesResolved: event.eventData.variables_resolved
		};
	}

	return byAgent;
}

export function collectLatestContextPreviews(
	detail: KernelTraceSessionDetail | null
): Record<string, AgentContextPreviewSummary> {
	if (!detail) return {};

	const agentByPiSessionId = new Map(
		detail.pi_sessions.map((session) => [session.id, session.agentName])
	);
	const byAgent: Record<string, AgentContextPreviewSummary> = {};

	for (const event of detail.events) {
		if (event.type !== "context_build_completed") continue;
		if (!event.piSessionId) continue;
		if (!isContextBuildCompletedData(event.eventData)) continue;

		const agentName = agentByPiSessionId.get(event.piSessionId);
		if (!agentName) continue;

		const existing = byAgent[agentName];
		if (existing && existing.timestamp >= event.timestamp) continue;

		byAgent[agentName] = {
			agentName,
			piSessionId: event.piSessionId,
			timestamp: event.timestamp,
			inputs: event.eventData.inputs.map((input) => ({
				loaderKind: input.loader_kind,
				inputRef: input.input_ref,
				status: input.status,
				bytes: input.bytes
			})),
			renderedContext: event.eventData.rendered_context
		};
	}

	return byAgent;
}

export function summarizeAgentRuntime(
	detail: KernelTraceSessionDetail | null,
	agentName: string
): AgentRuntimeSummary {
	if (!detail) {
		return {
			sessionCount: 0,
			runCount: 0,
			completedRuns: 0,
			runningRuns: 0,
			eventCount: 0,
			latestActivityAt: null
		};
	}

	const sessionIds = new Set(
		detail.pi_sessions.filter((session) => session.agentName === agentName).map((session) => session.id)
	);
	const runs = detail.agent_runs.filter((run) => run.agentName === agentName);
	const events = detail.events.filter((event) => event.piSessionId && sessionIds.has(event.piSessionId));
	const latestEvent = events.at(-1);

	return {
		sessionCount: sessionIds.size,
		runCount: runs.length,
		completedRuns: runs.filter((run) => run.status === "completed").length,
		runningRuns: runs.filter((run) => run.status === "running").length,
		eventCount: events.length,
		latestActivityAt: latestEvent?.timestamp ?? runs.at(-1)?.updatedAt ?? null
	};
}
