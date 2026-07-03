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
	UserMessageData,
	WarningData,
} from "@agent-kernel/protocol";

export type JsonObject = Record<string, unknown>;

/**
 * ui_ask_requested/answered left the core protocol catalog (apps re-register
 * them as open-string event types); the viewer still knows how to pair and
 * render them when an app emits them.
 */
export const UI_ASK_REQUESTED = "ui_ask_requested";
export const UI_ASK_ANSWERED = "ui_ask_answered";

export interface UIAskRequestedData {
	kind?: string;
	tool_use_id?: string;
	payload?: unknown;
	[key: string]: unknown;
}

export interface UIAskAnsweredData {
	kind?: string;
	tool_use_id?: string;
	exchanges?: unknown;
	[key: string]: unknown;
}

/**
 * One container row as the viewer sees it — mirrors the kernel db
 * `containers` table (identity model: containers are the single grouping
 * primitive; a trace "session" is a container of kind "session").
 */
export interface KernelContainerSummary {
	id: string;
	kind: string;
	parentContainerId?: string | null;
	label: string | null;
	status: string;
	workingDir?: string | null;
	phase?: string | null;
	phaseVocabulary?: string[] | null;
	metadata?: JsonObject | null;
	createdAt: string;
	startedAt?: string | null;
	endedAt?: string | null;
	/** Container-level usage rollup (sum of the container subtree's runs). */
	usageInputTokens?: number;
	usageOutputTokens?: number;
	usageCacheRead?: number;
	usageCacheWrite?: number;
	/** Estimated cost in USD; null/absent when no price data is available. */
	usageCostEstimate?: number | null;
}

/**
 * One trace event row. `containerId` is the required grouping identity and
 * `runId` is the explicit run linkage stamped at emit time (preferred over
 * timestamp reconstruction wherever it is present).
 */
export interface TraceEventRow {
	eventId: string;
	containerId: string;
	runId?: string | null;
	piSessionId?: string | null;
	agentId?: string | null;
	userId?: string | null;
	type: EventType;
	source: TraceSource;
	traceLevel: TraceLevel | number;
	eventData: EventData | JsonObject | null;
	spanId?: string | null;
	parentEventId?: string | null;
	timestamp: string;
}

export type TraceEvent = TraceEventRow;

/** One Pi conversation — mirrors the kernel db `pi_agent_sessions` table. */
export interface PiAgentSession {
	id: string;
	containerId: string;
	parentSessionId?: string | null;
	parentToolUseId?: string | null;
	agentName: string;
	displayLabel?: string | null;
	model?: string | null;
	promptHash?: string | null;
	status: string;
	phase?: string | null;
	createdAt: string;
	endedAt?: string | null;
	/** Per-session token rollup (sum of this session's runs). */
	usageInputTokens?: number;
	usageOutputTokens?: number;
}

/** One processing loop (message in -> response out) — mirrors `agent_runs`. */
export interface AgentRun {
	id: string;
	piSessionId: string;
	containerId: string;
	parentRunId?: string | null;
	parentToolUseId?: string | null;
	agentName: string;
	trigger: string;
	inboundEventId?: string | null;
	outboundEventId?: string | null;
	displayLabel?: string | null;
	phase?: string | null;
	status: string;
	startedAt: string;
	endedAt?: string | null;
	/** Per-run usage — the leaf rows that roll up into session/container totals. */
	usageInputTokens?: number;
	usageOutputTokens?: number;
	usageCacheRead?: number;
	usageCacheWrite?: number;
	/** Estimated cost in USD; null/absent when no price data is available. */
	usageCostEstimate?: number | null;
}

/**
 * Metadata block for one trace session. A trace session IS a container of
 * kind "session" — `id` and `containerId` are the same identifier, kept as
 * two fields so call sites read naturally.
 */
export interface TraceSessionMeta {
	id: string;
	containerId: string;
	kind: string;
	label: string | null;
	topic: string | null;
	status: string;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface KernelTraceSessionSummary {
	id: string;
	containerId: string;
	kind: string;
	label: string;
	topic: string | null;
	status: string;
	phase: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	piSessionCount: number;
	eventCount: number;
	latestEventAt: string | null;
	metadata: JsonObject;
}

export interface KernelTraceSessionListResponse {
	trace_sessions: KernelTraceSessionSummary[];
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
