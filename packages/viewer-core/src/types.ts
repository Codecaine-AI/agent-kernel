import type {
	AgentRunEndData,
	AgentRunStartData,
	AgentSessionEndData,
	AgentSessionStartData,
	AssistantMessageData,
	ContainerEndData,
	ContainerStartData,
	ContextBuildCompletedData,
	ContextBuildStartedData,
	ContextInputResolvedData,
	EventData,
	EventType,
	ErrorData,
	PhaseEndData,
	PhaseStartData,
	PostToolHookData,
	PreToolHookData,
	SystemPromptResolvedData,
	ToolCallEndData,
	ToolCallStartData,
	TraceLevel,
	TraceSource,
	UIAskAnsweredData,
	UIAskRequestedData,
	UserMessageData,
	WarningData,
} from "@agent-kernel/protocol";

export { EventType, TraceLevel } from "@agent-kernel/protocol";
export type {
	AgentRunEndData,
	AgentRunStartData,
	AgentSessionEndData,
	AgentSessionStartData,
	AssistantMessageData,
	ContainerEndData,
	ContainerStartData,
	ContextBuildCompletedData,
	ContextBuildStartedData,
	ContextInputResolvedData,
	ErrorData,
	PhaseEndData,
	PhaseStartData,
	PostToolHookData,
	PreToolHookData,
	SystemPromptResolvedData,
	ToolCallEndData,
	ToolCallStartData,
	TraceSource,
	UIAskAnsweredData,
	UIAskRequestedData,
	UserMessageData,
	WarningData,
} from "@agent-kernel/protocol";

export type JsonObject = Record<string, unknown>;

export interface KernelContainerSummary {
	id: string;
	parentContainerId?: string | null;
	label: string;
	status: string;
	workingDir?: string | null;
	worktreePath?: string | null;
	phase?: string | null;
	phaseVocabulary: string[];
	metadata: JsonObject;
	startedAt?: string | null;
	completedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TraceEventRow {
	id: string;
	eventId: string;
	appSessionId: string;
	containerId?: string | null;
	userId: string;
	type: EventType;
	source: TraceSource;
	traceLevel: TraceLevel | number;
	eventData: EventData | JsonObject | null;
	spanId?: string | null;
	parentEventId?: string | null;
	timestamp: string;
	piSessionId?: string | null;
	agentId?: string | null;
}

export type TraceEvent = TraceEventRow;

export interface PiAgentSession {
	id: string;
	appSessionId?: string | null;
	parentId?: string | null;
	agentName: string;
	model: string;
	modelAlias?: string | null;
	status: string;
	phase?: string | null;
	containerId?: string | null;
	displayLabel?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PiAgentSessionRow extends PiAgentSession {
	app_session_slug: string | null;
	app_session_topic: string | null;
	eventCount: number;
}

export interface AgentRun {
	id: string;
	piSessionId: string;
	runNumber: number;
	agentName: string;
	status: string;
	parentRunId?: string | null;
	containerId?: string | null;
	phase?: string | null;
	displayLabel?: string | null;
	parentToolUseId?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TraceSessionMeta {
	id: string;
	containerId?: string | null;
	appSessionSlug: string;
	topic: string | null;
	status: string;
	appSessionType: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface KernelTraceSessionSummary {
	id: string;
	containerId: string;
	label: string;
	appSessionSlug: string;
	topic: string | null;
	status: string;
	appSessionType: string | null;
	phase: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	piSessionCount: number;
	eventCount: number;
	latestEventAt: string | null;
	metadata: JsonObject;
}

export interface KernelTraceUnlinkedSummary {
	piSessionCount: number;
	eventCount: number;
	latestEventAt: string | null;
}

export interface KernelTraceSessionListResponse {
	trace_sessions: KernelTraceSessionSummary[];
	unlinked: KernelTraceUnlinkedSummary | null;
}

export interface PiSessionWithCount extends PiAgentSession {
	eventCount: number;
}

export interface KernelTraceSessionDetail {
	session: TraceSessionMeta;
	container?: KernelContainerSummary | null;
	containers?: KernelContainerSummary[];
	pi_sessions: PiSessionWithCount[];
	agent_runs: AgentRun[];
	events: TraceEventRow[];
}

export interface RegisteredKernelSummary {
	kernelId: string;
	displayName: string;
	workingDir: string;
	piSessionsDir: string;
	appBaseUrl?: string | null;
	appTraceUrlTemplate?: string | null;
	genericTraceUrlTemplate?: string | null;
	lastSeenAt: string;
	metadata: JsonObject;
}

export interface RegisteredKernelDetail extends RegisteredKernelSummary {
	markerConfig: {
		sessionBinding: string;
		lifecycle: string;
		subagentLink: string;
	};
	registeredAt: string;
	createdAt: string;
	updatedAt: string;
}

export interface RegisteredKernelListResponse {
	kernels: RegisteredKernelSummary[];
}
