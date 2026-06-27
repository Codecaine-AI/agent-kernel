import type { PromptDocument } from "@codecaine-ai/prompt-kit";

export interface AgentVariableDeclaration {
	default: unknown;
	description?: string | null;
}

export interface AgentRenderedPrompt {
	content: string;
	timestamp?: string | null;
	resolvedVariables?: Record<string, unknown>;
	toolsAllowlist?: string[];
	toolsDisallowlist?: string[];
}

export interface AgentContextInputSummary {
	loaderKind: string;
	inputRef: string;
	status: "ok" | "empty" | "error" | string;
	bytes: number;
}

export interface AgentContextPreview {
	modulePath: string | null;
	inputs: AgentContextInputSummary[];
	renderedContext?: string | null;
	timestamp?: string | null;
}

export interface AgentViewerDefinition {
	name: string;
	description: string;
	model: string;
	source?: "typed" | "markdown";
	prompt?: PromptDocument | null;
	tools: string[];
	disallowedTools: string[];
	extensions: true | string[] | false;
	canSpawnSubagent: boolean;
	variables: Record<string, AgentVariableDeclaration>;
	maxTurns: number | null;
	runInBackground: boolean;
	thinking: string | null;
	body: string;
	agentFile: string;
	contextModulePath: string | null;
	warnings: string[];
	group?: string | null;
	renderedPrompt?: AgentRenderedPrompt | null;
	context?: AgentContextPreview | null;
}
