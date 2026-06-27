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
			canSpawnSubagent: agent.canSpawnSubagent,
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
