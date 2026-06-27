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
	canSpawnSubagent: boolean;
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
	appSessionId: string;
	appSessionSlug: string;
	containerId: string;
	prompt: string;
	kind: "dummy" | "user";
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
	dummySession: {
		id: string;
		label: string;
		description: string;
	};
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
