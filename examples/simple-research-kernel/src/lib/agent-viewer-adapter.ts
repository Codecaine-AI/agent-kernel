import type { AgentViewerDefinition } from "@agent-kernel/viewer-ui";

import type {
	AgentContextPreviewSummary,
	RenderedPromptSummary,
	ResearchAgentSummary
} from "./types";

export function toAgentViewerDefinitions(
	agents: ResearchAgentSummary[],
	renderedPrompts: Record<string, RenderedPromptSummary>,
	contextPreviews: Record<string, AgentContextPreviewSummary>
): AgentViewerDefinition[] {
	return agents.map((agent) => {
		const renderedPrompt = renderedPrompts[agent.name];
		const contextPreview = contextPreviews[agent.name];
		return {
			name: agent.name,
			description: agent.description,
			model: agent.model,
			source: agent.source,
			prompt: agent.promptDocument,
			tools: agent.tools,
			disallowedTools: agent.disallowedTools,
			extensions: agent.extensions,
			// Legacy viewer-ui field (pending the viewer spawner-rendering
			// follow-up): derived from the per-tool spawner map (D77).
			canSpawnSubagent: Object.keys(agent.spawnerTools).length > 0,
			variables: Object.fromEntries(
				agent.variables.map((variable) => [
					variable.name,
					{
						default: variable.defaultValue,
						description: variable.description
					}
				])
			),
			maxTurns: agent.maxTurns,
			runInBackground: agent.runInBackground,
			thinking: agent.thinking,
			body: agent.promptTemplate,
			agentFile: agent.agentFile,
			contextModulePath: agent.contextModule,
			warnings: agent.warnings,
			group: "research",
			renderedPrompt: renderedPrompt
				? {
						content: renderedPrompt.renderedPrompt,
						timestamp: renderedPrompt.timestamp,
						resolvedVariables: renderedPrompt.variablesResolved,
						toolsAllowlist: renderedPrompt.toolsAllowlist,
						toolsDisallowlist: renderedPrompt.toolsDisallowlist
					}
				: null,
			context: {
				modulePath: agent.contextModule,
				inputs: contextPreview?.inputs ?? [],
				renderedContext: contextPreview?.renderedContext ?? null,
				timestamp: contextPreview?.timestamp ?? null
			}
		};
	});
}
