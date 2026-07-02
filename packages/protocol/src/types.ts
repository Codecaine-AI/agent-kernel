/**
 * Trace event type system — event data payloads, trace levels, and event type catalog.
 *
 * Each interface captures the type-specific payload for TraceEvent.eventData.
 * Mirrors the Python dataclasses in infrastructure/tracing/types.py.
 */

// ─── Placeholder User ID ───────────────────────────────────────────────────

/**
 * Optional actor label for single-user apps. Nothing in the protocol requires
 * a userId; apps that want an actor correlation may use this constant.
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// ─── Trace Levels ───────────────────────────────────────────────────────────

export const TraceLevel = {
  SUMMARY: 0,
  PROCESSING: 1,
  DEBUG: 2,
  INTERNAL: 3,
} as const;

export type TraceLevel = (typeof TraceLevel)[keyof typeof TraceLevel];

// ─── Event Type Catalog ─────────────────────────────────────────────────────

export const EventType = {
  // Agent Lifecycle
  AGENT_SESSION_START: "agent_session_start",
  AGENT_SESSION_END: "agent_session_end",
  AGENT_RUN_START: "agent_run_start",
  AGENT_RUN_END: "agent_run_end",
  RUN_STEERED: "run_steered",

  // Pi Lifecycle (tailer-emitted, mirrors Pi SDK agent/turn boundaries)
  PI_AGENT_START: "pi_agent_start",
  PI_AGENT_END: "pi_agent_end",
  PI_TURN_START: "pi_turn_start",
  PI_TURN_END: "pi_turn_end",

  // Spawn Lifecycle
  SYSTEM_PROMPT_RESOLVED: "system_prompt_resolved",
  CONTEXT_BUILD_STARTED: "context_build_started",
  CONTEXT_INPUT_RESOLVED: "context_input_resolved",
  CONTEXT_BUILD_COMPLETED: "context_build_completed",

  // Messages (rendered in chat UI)
  USER_MESSAGE: "user_message",
  ASSISTANT_MESSAGE: "assistant_message",

  // Tool Use
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
  PRE_TOOL_HOOK: "pre_tool_hook",
  POST_TOOL_HOOK: "post_tool_hook",

  // Phase Transitions
  PHASE_START: "phase_start",
  PHASE_END: "phase_end",

  // Pipeline Containers (plan-stage grouping — outline / checkpoint / task_group)
  CONTAINER_START: "container_start",
  CONTAINER_END: "container_end",

  // System
  ERROR: "error",
  WARNING: "warning",
} as const;

export type KnownEventType = (typeof EventType)[keyof typeof EventType];
export type EventType = KnownEventType | (string & {});

// ─── Usage ──────────────────────────────────────────────────────────────────

/**
 * Per-model-call token usage. Carried on pi_turn_end.eventData.usage and
 * rolled up onto agent_run_end.eventData.usage. Columns land in Phase 1;
 * population happens in Phase 2 (extension emitter).
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The model that actually served the turn. */
  model: string;
  /** From kernel-config price table, when present. */
  costEstimate?: number;
}

// ─── Agent Lifecycle ────────────────────────────────────────────────────────

export interface AgentSessionStartData {
  agent_type: string;
  model: string;
  model_alias?: string;
}

export interface AgentSessionEndData {
  status: string; // "completed" | "error" | "cancelled"
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  error_message?: string;
}

export interface AgentRunStartData {
  run_id: string;
  agent_name: string;
  parent_run_id?: string;
  container_id?: string;
  phase?: string; // "spec" | "plan" | "build"
  parent_tool_use_id?: string;
  display_label?: string;
}

export interface AgentRunEndData {
  run_id: string;
  agent_name: string;
  status: "ok" | "error";
  error_message?: string;
  /** Usage rolled up across the run's turns (populated from Phase 2). */
  usage?: TurnUsage;
}

/**
 * A steering message injected into a running run. Steering is a control
 * action; without this event it would be invisible in the trace.
 */
export interface RunSteeredData {
  run_id: string;
  agent_name: string;
  message: string;
  /** "delivered" — steered a live session; "queued" — held until the session exists. */
  delivery: "delivered" | "queued";
}

// ─── Pi Lifecycle ───────────────────────────────────────────────────────────

export interface PiAgentStartData {
  prompt_summary?: string;
}

export interface PiAgentEndData {
  status: "ok" | "error";
  error_message?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface PiTurnStartData {
  turn_number?: number;
}

export interface PiTurnEndData {
  turn_number?: number;
  stop_reason?: string;
  /** Token usage for this model call (populated from Phase 2). */
  usage?: TurnUsage;
}

// ─── Spawn Lifecycle ────────────────────────────────────────────────────────

export interface SystemPromptResolvedData {
  agent_name: string;
  /**
   * Content address ("pk1-<sha256>") of the canonical prompt.json revision
   * the system prompt was rendered from; null for prompt sources that are
   * not content-addressed (e.g. markdown agents).
   */
  prompt_hash?: string | null;
  rendered_prompt: string;
  tools_allowlist: string[];
  tools_disallowlist: string[];
  extensions: boolean | string[];
  domain_rules_installed: boolean;
  variables_resolved: Record<string, unknown>;
}

export interface ContextBuildStartedData {
  agent_name: string;
  declared_inputs: Array<{ kind: string; ref: string }>;
}

export interface ContextInputResolvedData {
  loader_kind: string;
  input_ref: string;
  status: "ok" | "error" | "empty";
  bytes: number;
  from_cache: boolean;
  error?: string;
  content_hash?: string;
}

export interface ContextBuildCompletedData {
  inputs: Array<{
    loader_kind: string;
    input_ref: string;
    status: "ok" | "error" | "empty";
    bytes: number;
  }>;
  rendered_context: string;
  total_bytes: number;
}

// ─── Messages ───────────────────────────────────────────────────────────────

export interface UserMessageData {
  content: string;
  phase: string; // "spec" | "plan" | "build"
  question_id?: string;
}

export interface AssistantMessageData {
  content: string;
  block_type: string; // "text" | "thinking" | "tool_use" | "tool_result"
  question_id?: string;
}

// ─── Tool Use ───────────────────────────────────────────────────────────────

export interface ToolCallStartData {
  tool_use_id: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
}

export interface ToolCallEndData {
  tool_use_id: string;
  tool_name: string;
  tool_output?: string;
  duration_ms?: number;
}

export interface PreToolHookData {
  tool_name: string;
  tool_input?: Record<string, unknown>;
}

export interface PostToolHookData {
  tool_name: string;
  tool_output?: string;
}

// ─── Phase Transitions ──────────────────────────────────────────────────────

export interface PhaseStartData {
  phase: string; // "spec" | "plan" | "build"
}

export interface PhaseEndData {
  phase: string;
}

// ─── Pipeline Containers ────────────────────────────────────────────────────

export interface ContainerStartData {
  container_id: string;
  level: "outline" | "checkpoint" | "task_group" | "triage" | "updates" | "foundation" | "design" | "implementation" | "verify" | "alignment" | "research" | "interview";
  checkpoint_id?: number | null;
  task_group_id?: number | null;
  parent_container_id?: string | null;
  label: string;
  producer_stage: "outline" | "task_groups" | "tasks" | "docs" | "spec";
  phase?: string;
}

export interface ContainerEndData {
  container_id: string;
  status: "ok" | "error";
  error_message?: string;
  phase?: string;
}

// ─── System ─────────────────────────────────────────────────────────────────

export interface ErrorData {
  error_type?: string;
  error_message?: string;
  stack_trace?: string;
}

export interface WarningData {
  message: string;
  warning_type?: string;
}

// ─── Union of all event data types ──────────────────────────────────────────

export type KnownEventData =
  | AgentSessionStartData
  | AgentSessionEndData
  | AgentRunStartData
  | AgentRunEndData
  | RunSteeredData
  | PiAgentStartData
  | PiAgentEndData
  | PiTurnStartData
  | PiTurnEndData
  | SystemPromptResolvedData
  | ContextBuildStartedData
  | ContextInputResolvedData
  | ContextBuildCompletedData
  | UserMessageData
  | AssistantMessageData
  | ToolCallStartData
  | ToolCallEndData
  | PreToolHookData
  | PostToolHookData
  | PhaseStartData
  | PhaseEndData
  | ContainerStartData
  | ContainerEndData
  | ErrorData
  | WarningData;

export type UnknownEventData = Record<string, unknown>;

export type EventData = KnownEventData | UnknownEventData;
