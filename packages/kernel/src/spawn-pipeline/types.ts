import type { RuntimeState } from "../context";

export interface VariableDeclaration {
	default: unknown;
	description?: string;
}

export interface DomainRule {
	path: string;
	read: boolean;
	upsert: boolean;
	delete: boolean;
}

export interface AgentFrontmatter {
	name: string;
	description: string;
	model: string;
	tools: string[];
	disallowed_tools?: string[];
	extensions?: true | string[] | false;
	can_spawn_subagent?: boolean;
	variables: Record<string, VariableDeclaration>;
	max_turns?: number;
	run_in_background?: boolean;
	thinking?: string;
}

export interface ParsedAgent {
	frontmatter: AgentFrontmatter;
	body: string;
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
