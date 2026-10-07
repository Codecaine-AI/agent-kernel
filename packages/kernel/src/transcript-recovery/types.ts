import type { TraceEvent } from "@agent-kernel/protocol";

export interface PiTextBlock {
  type: "text";
  text: string;
}

export interface PiToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: string;
}

export interface PiThinkingBlock {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}

export type PiContentBlock = PiTextBlock | PiToolCallBlock | PiThinkingBlock;

/**
 * A call a tool made while it ran (a codemode script's `ctx.executeTool()`),
 * as Pi records it on the calling tool's result (`NestedToolCallRecord`).
 * Ids are `<callerId>/<n>`; the record carries no parent field and no result.
 */
export interface PiNestedToolCallRecord {
  id: string;
  name: string;
  /** Omitted when over Pi's size limits; `argumentsBytes` then gives their size. */
  arguments?: Record<string, unknown>;
  argumentsBytes?: number;
  /** `unfinished`: still running when the calling tool finished. */
  status: "ok" | "error" | "unfinished";
  durationMs?: number;
  /** Error text, truncated. */
  error?: string;
}

/** Bounded record of every nested call one model-issued tool call made, at any depth. */
export interface PiNestedToolCalls {
  calls: PiNestedToolCallRecord[];
  /** False when calls were dropped, arguments omitted, or calls had not finished. */
  complete: boolean;
}

export interface PiMessage {
  /** "system": Pi 1.0 persists the system prompt as a leading transcript entry; it maps to no event. */
  role: "user" | "assistant" | "toolResult" | "system";
  content: PiContentBlock[];
  timestamp: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  api?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  responseId?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
  /** toolResult only: the calls this tool made to other tools. */
  nestedCalls?: PiNestedToolCalls;
}

export interface PiSessionEvent {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export interface PiMessageEvent {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: PiMessage;
}

export interface PiModelChangeEvent {
  type: "model_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  provider: string;
  modelId: string;
}

export interface PiThinkingLevelChangeEvent {
  type: "thinking_level_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  thinkingLevel: string;
}

export interface PiCustomEvent {
  type: "custom";
  customType: string;
  data: Record<string, unknown>;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface PiSessionInfoEvent {
  type: "session_info";
  id: string;
  parentId: string | null;
  timestamp: string;
}

export type PiEvent =
  | PiSessionEvent
  | PiMessageEvent
  | PiModelChangeEvent
  | PiThinkingLevelChangeEvent
  | PiCustomEvent
  | PiSessionInfoEvent;

export interface MapperContainerBindingMetadata {
  containerId?: string;
  runId?: string;
  slug?: string;
  dir?: string;
  customType: string;
  raw: Record<string, unknown>;
}

export interface MapperSubagentLinkMetadata {
  parentPiSessionId: string;
  childPiSessionId: string;
  toolCallId: string;
  agentType: string;
  description: string;
}

export interface MapperResult {
  traceEvents: TraceEvent[];
  /** Non-fatal diagnostics raised while mapping (e.g. missing turn usage). */
  warnings?: string[];
  metadata?: {
    /** Container/run identity discovered from a binding-marker JSONL event. */
    containerBinding?: MapperContainerBindingMetadata;
    /** Pi session UUID from a session event. */
    piSessionUuid?: string;
    /** Parent-child sub-agent link data from a configured custom event. */
    subagentLink?: MapperSubagentLinkMetadata;
  };
}
