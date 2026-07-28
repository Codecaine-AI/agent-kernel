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

  // Pi Lifecycle (emitter/backfill, mirrors Pi SDK agent/turn boundaries)
  PI_AGENT_START: "pi_agent_start",
  PI_AGENT_END: "pi_agent_end",
  PI_TURN_START: "pi_turn_start",
  PI_TURN_END: "pi_turn_end",
  PI_REQUEST_SNAPSHOT: "pi_request_snapshot",

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

/**
 * One context message in a per-turn request snapshot, by reference into the
 * trace_blobs store (packages/db).
 */
export interface PiRequestSnapshotMessageRef {
  /** trace_blobs hash ("b1-<sha256hex>") of the sanitized message JSON. */
  blob_hash: string;
  /** "user" | "assistant" | "toolResult" | custom. */
  role: string;
  /** Position in the context message array. */
  index: number;
  text_chars: number;
  image_count: number;
  tool_call_count: number;
}

/**
 * One structural section of a per-turn request window, as three-section
 * request assembly (① system prompt · ② context message · ③ rendered state)
 * built it. Indices are half-open [start, end) positions into the snapshot's
 * ordered `message_refs` list. The system prompt is captured as its own blob
 * and renders as section ①, so it never appears here.
 */
export interface PiRequestSnapshotSection {
  kind: "context" | "state" | "tail";
  start: number;
  end: number;
}

/**
 * One tool the agent had access to on a specific request, as the session
 * reported it at capture time. `parameters` is the JSON parameter schema
 * configured on the tool, passed through verbatim.
 */
export interface PiRequestSnapshotTool {
  name: string;
  description?: string;
  /** JSON schema for the tool's parameters, as configured. */
  parameters?: unknown;
}

/**
 * Snapshot of the exact request context sent to the model for one turn.
 * Message payloads live in the trace_blobs store (packages/db) and are
 * referenced by content hash.
 *
 * Sanitized-message contract — downstream implementers code against this:
 * a "sanitized message" blob (kind "message", mime "application/json") is
 * the pi-ai message JSON with every image content block
 * `{type: "image", data: <base64>, mimeType}` replaced by
 * `{type: "image", blob_hash: "<b1-...>", mimeType, byte_length}` — the
 * base64 `data` field removed. Image bytes are stored as separate blobs
 * (kind "image"). The system prompt is stored as a blob of kind "text",
 * mime "text/plain".
 */
export interface PiRequestSnapshotData {
  /** 0-based, aligned with pi_turn_start. */
  turn_number: number;
  system_prompt_blob_hash: string | null;
  /** "pk1-" content address when known. */
  prompt_hash: string | null;
  message_count: number;
  message_refs: PiRequestSnapshotMessageRef[];
  total_text_chars: number;
  total_image_count: number;
  /**
   * Section boundaries of the built request, when the turn was assembled by
   * the three-section builder. Absent on snapshots captured from a plain
   * session transcript (including every snapshot written before section tags
   * existed) — readers must treat a missing `sections` as "untagged".
   */
  sections?: PiRequestSnapshotSection[];
  /**
   * trace_blobs hash of the tool roster this request went out with: a blob of
   * kind "tools", mime "application/json", holding a JSON array of
   * `PiRequestSnapshotTool` in the order the session reports it
   * (provider-visible order — readers must not re-sort). Tools can change
   * call to call, so the roster is captured per request; identical rosters
   * dedupe to one blob by content hash.
   *
   * Absent when the tool roster was not captured for this snapshot (a session
   * that does not expose its roster, or any trace written before tool capture
   * existed) — readers must NOT read absence as "zero tools".
   */
  tools_blob_hash?: string | null;
  /**
   * Number of tools in the captured roster. Absent under exactly the same
   * rule as `tools_blob_hash`: not captured, not "zero tools".
   */
  tool_count?: number;
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
  /** "spawner" when the tool is a declared agent-dispatch tool (D77). */
  toolKind?: "spawner";
  /** Agent names the spawner tool may dispatch; ["*"] means any (D77). */
  spawns?: string[];
}

export interface ToolCallEndData {
  tool_use_id: string;
  tool_name: string;
  tool_output?: string;
  duration_ms?: number;
  /** True when the tool result was marked as an error by the tool. */
  is_error?: boolean;
  /** "spawner" when the tool is a declared agent-dispatch tool (D77). */
  toolKind?: "spawner";
  /** Agent names the spawner tool may dispatch; ["*"] means any (D77). */
  spawns?: string[];
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
  | PiRequestSnapshotData
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
