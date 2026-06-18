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

export interface PiMessage {
  role: "user" | "assistant" | "toolResult";
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

export interface MapperSessionBindingMetadata {
  appSessionId?: string;
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
  metadata?: {
    /** App-level session/container identity discovered from a custom JSONL event. */
    appSession?: MapperSessionBindingMetadata;
    /** Pi session UUID from a session event. */
    piSessionUuid?: string;
    /** Parent-child sub-agent link data from a configured custom event. */
    subagentLink?: MapperSubagentLinkMetadata;
  };
}
