import type { PromptDocument } from "@codecaine-ai/prompt-kit";

export type WorkspaceId = "research" | "trace" | "agents";

export type ResearchArtifactSummary = {
	path: string;
	bytes: number;
	updatedAt: string;
};

export type ResearchAgentSummary = {
	name: string;
	description: string;
	model: string;
	tools: string[];
	disallowedTools: string[];
	extensions: true | string[] | false;
	/** Spawner tool name → declared agent-name allowlist (D77). */
	spawnerTools: Record<string, string[]>;
	variables: Array<{
		name: string;
		defaultValue: unknown;
		description: string | null;
	}>;
	maxTurns: number | null;
	thinking: string | null;
	runInBackground: boolean;
	hasContext: boolean;
	contextModule: string | null;
	agentFile: string;
	source: "typed" | "markdown";
	promptDocument: PromptDocument | null;
	promptTemplate: string;
	warnings: string[];
};

export type ResearchRunSummary = {
	id: string;
	/** The session container (kind "session") this run's trace lives under. */
	containerId: string;
	sessionSlug: string;
	prompt: string;
	status: "running" | "completed" | "error";
	startedAt: string;
	completedAt: string | null;
	error: string | null;
};

export type ResearchHarnessInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	memoryDir: string;
	agents: ResearchAgentSummary[];
	activeRuns: ResearchRunSummary[];
	trace: {
		label: string;
		piSessionCount: number;
		eventCount: number;
		latestEventAt: string | null;
	};
	artifacts: {
		scoutReports: ResearchArtifactSummary[];
		reports: ResearchArtifactSummary[];
	};
	latestReport: string;
};

export type RenderedPromptSummary = {
	agentName: string;
	piSessionId: string | null;
	timestamp: string;
	renderedPrompt: string;
	toolsAllowlist: string[];
	toolsDisallowlist: string[];
	variablesResolved: Record<string, unknown>;
};

export type AgentContextPreviewSummary = {
	agentName: string;
	piSessionId: string | null;
	timestamp: string;
	inputs: Array<{
		loaderKind: string;
		inputRef: string;
		status: string;
		bytes: number;
	}>;
	renderedContext: string;
};

export type AgentRuntimeSummary = {
	sessionCount: number;
	runCount: number;
	completedRuns: number;
	runningRuns: number;
	eventCount: number;
	latestActivityAt: string | null;
};
