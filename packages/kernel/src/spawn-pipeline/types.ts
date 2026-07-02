import type { RuntimeState } from "../context";

export interface VariableDeclaration {
	default?: unknown;
	description?: string;
	optional?: boolean;
	required?: boolean;
}

export interface DomainRule {
	path: string;
	read: boolean;
	upsert: boolean;
	delete: boolean;
}

/**
 * Runtime agent configuration resolved from the agent.json manifest (D76).
 * `tools` is the fully expanded allowlist: manifest coreTools + expanded
 * toolProfiles + harvested private tool names.
 */
export interface AgentConfig {
	name: string;
	description: string;
	model: string;
	tools: string[];
	disallowedTools?: string[];
	extensions?: true | string[] | false;
	/**
	 * Spawner tool name → declared agent-name allowlist (D77). Harvested from
	 * the tools.ts sidecar at boot; the emitter uses it to mark spawner tool
	 * calls in traces (`toolKind: "spawner"`).
	 */
	spawnerTools?: Record<string, string[]>;
	variables: Record<string, VariableDeclaration>;
	maxTurns?: number;
	runInBackground?: boolean;
	thinking?: string;
}

export interface ParsedAgent {
	config: AgentConfig;
	body: string;
	/**
	 * Content address ("pk1-<sha256>") of the canonical prompt.json the body
	 * was rendered from. Stamped onto pi_agent_sessions.prompt_hash at
	 * session creation (D72).
	 */
	promptHash?: string;
}

export type PiToolResultBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export interface ResumeToolResultInput {
	toolUseId: string;
	toolName: string;
	content: string;
	contentBlocks?: PiToolResultBlock[];
}

export interface KernelSpawnRuntimeOptions {
	signal?: AbortSignal;
	resumeFromToolResult?: ResumeToolResultInput;
	resumeTriggerCustomType?: string;
	onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
	onTextDelta?: (delta: string) => void;
	onTurnEnd?: (turnCount: number) => void;
}

export interface KernelSpawnResult<TSession> {
	responseText: string;
	session: TSession;
	aborted: boolean;
}

export interface KernelAgentSessionLike {
	messages: any[];
	prompt(prompt: string): Promise<unknown>;
	sendCustomMessage(
		message: { customType: string; content: string; display: boolean },
		opts: { triggerTurn: true },
	): Promise<unknown>;
	subscribe(listener: (event: KernelAgentSessionEventLike) => void): () => void;
	steer(message: string): Promise<unknown>;
	abort(): void;
}

export type KernelAgentSessionEventLike =
	| { type: "turn_end" }
	| { type: "message_start" }
	| {
			type: "message_update";
			assistantMessageEvent: { type: "text_delta"; delta: string };
	  }
	| { type: "tool_execution_start"; toolName: string }
	| { type: "tool_execution_end"; toolName: string }
	| { type: string; [key: string]: unknown };

export interface KernelSessionEntryLike {
	id: string;
	type: string;
	message?: any;
}

export interface KernelSessionManagerLike {
	getEntries(): KernelSessionEntryLike[];
	getBranch(): KernelSessionEntryLike[];
	branch(entryId: string): unknown;
	appendMessage(message: any): unknown;
}

export type KernelRuntimeState = RuntimeState;
