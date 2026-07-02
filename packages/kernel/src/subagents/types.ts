import type { RunTrigger } from "@agent-kernel/db";
import type { TraceEvent } from "@agent-kernel/protocol";

export interface KernelAgentSession {
	messages: any[];
	steer(message: string): Promise<unknown>;
	dispose?: () => void;
	sessionId?: string;
}

export interface KernelExtensionAPI {
	appendEntry(customType: string, payload: Record<string, unknown>): unknown;
}

export interface KernelExtensionContext {
	cwd?: string;
	sessionManager: {
		getSessionId(): string | undefined;
	};
}

export type SubagentType = string;

export interface AgentRecord {
	id: string;
	type: SubagentType;
	description: string;
	status: "queued" | "running" | "completed" | "aborted" | "stopped" | "error";
	result?: string;
	error?: string;
	toolUses: number;
	startedAt: number;
	completedAt?: number;
	session?: KernelAgentSession;
	abortController?: AbortController;
	promise?: Promise<string>;
	toolCallId?: string;
	resultConsumed?: boolean;
	notificationTimeout?: ReturnType<typeof setTimeout>;
	pendingSteers?: string[];
	isBackground?: boolean;
	/** Trace identity of the spawned run, once the pipeline reports it. */
	traceIds?: { containerId: string; runId: string; piSessionUuid?: string };
}

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;

export interface SpawnOptions {
	description: string;
	workingDir?: string;
	isBackground?: boolean;
	toolCallId?: string;
	parentPi?: KernelExtensionAPI;
	parentRunId?: string;
	/** Primary grouping identity; inherited from the parent run context when omitted. */
	containerId?: string;
	/** What opened the run — subagent spawns default to "parent-tool". */
	trigger?: RunTrigger;
	/** Session working directory for Pi session storage. */
	sessionDir?: string;
	piSessionsDir?: string;
	phase?: string;
	displayLabel?: string;
	variables?: Record<string, unknown>;
	parentPiSessionUuid?: string;
	signal?: AbortSignal;
	onToolActivity?: (toolName: string) => void;
	onTextDelta?: (delta: string) => void;
	onSessionCreated?: (session: KernelAgentSession) => void;
	onTurnEnd?: (turnCount: number) => void;
}

export interface NotificationDetails {
	id: string;
	description: string;
	status: string;
	toolUses: number;
	durationMs: number;
	error?: string;
	resultPreview: string;
	others?: NotificationDetails[];
}

export interface EnvInfo {
	isGitRepo: boolean;
	branch: string;
	platform: string;
}

export interface TraceWriterSink {
	submit(event: TraceEvent): void;
}
