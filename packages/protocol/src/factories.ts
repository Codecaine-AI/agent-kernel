/**
 * Event factory functions — construct TraceEvent instances with correct defaults.
 *
 * Factories are synchronous. They build the object; publishing to the
 * TraceEventWriter is handled separately by the caller.
 *
 * Signature convention: identity comes first as a single `ids` parameter
 * (TraceEventIds — containerId required; runId/userId/agentId/piSessionUuid
 * optional), followed by the event's semantic arguments, followed by an
 * optional `opts` object for span linkage and event-specific extras.
 * Run lifecycle factories require `runId` on `ids`.
 *
 * Trace level assignments:
 *   SUMMARY (0)    — user_message, assistant_message
 *   PROCESSING (1) — system_prompt, context_build, tool_call, pipeline containers
 *   DEBUG (2)      — agent lifecycle, phases, hooks, errors
 *   INTERNAL (3)   — Pi lifecycle/turns, context input resolution
 */

import {
  TraceSource,
  type TraceEvent,
  type TraceSource as TraceSourceValue,
} from "./envelope";
import {
  EventType,
  TraceLevel,
  type AgentSessionEndData,
  type AgentRunEndData,
  type AgentRunStartData,
  type AgentSessionStartData,
  type AssistantMessageData,
  type ContainerEndData,
  type ContainerStartData,
  type ContextBuildCompletedData,
  type ContextBuildStartedData,
  type ContextInputResolvedData,
  type ErrorData,
  type EventData,
  type PhaseEndData,
  type PhaseStartData,
  type PiAgentEndData,
  type PiAgentStartData,
  type PiTurnEndData,
  type PiTurnStartData,
  type PostToolHookData,
  type PreToolHookData,
  type RunSteeredData,
  type SystemPromptResolvedData,
  type ToolCallEndData,
  type ToolCallStartData,
  type TurnUsage,
  type UserMessageData,
  type WarningData,
} from "./types";

// ─── ID Generators ──────────────────────────────────────────────────────────

export function newEventId(): string {
  return crypto.randomUUID();
}

export function newSpanId(): string {
  return crypto.randomUUID();
}

// ─── Identity Parameter ─────────────────────────────────────────────────────

/**
 * Envelope identity, passed as the first argument to every factory.
 * `containerId` is the single required grouping identity; everything else is
 * optional correlation stamped when known at emit time.
 */
export interface TraceEventIds {
  containerId: string;
  runId?: string;
  userId?: string;
  agentId?: string;
  piSessionUuid?: string;
}

/** Identity for run lifecycle events, where the run id must be known. */
export type RunTraceEventIds = TraceEventIds & { runId: string };

// ─── Base Constructor ───────────────────────────────────────────────────────

interface CreateEventOptions {
  type: string;
  ids: TraceEventIds;
  eventData: EventData;
  source: TraceSourceValue;
  traceLevel?: number;
  spanId?: string;
  parentEventId?: string;
  timestamp?: string;
}

function createEvent(opts: CreateEventOptions): TraceEvent {
  return {
    eventId: newEventId(),
    containerId: opts.ids.containerId,
    type: opts.type as TraceEvent["type"],
    source: opts.source,
    traceLevel: (opts.traceLevel ?? TraceLevel.SUMMARY) as TraceEvent["traceLevel"],
    eventData: opts.eventData,
    agentId: opts.ids.agentId,
    runId: opts.ids.runId,
    spanId: opts.spanId,
    parentEventId: opts.parentEventId,
    userId: opts.ids.userId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    ...(opts.ids.piSessionUuid && { piSessionUuid: opts.ids.piSessionUuid }),
  };
}

// ─── Agent Lifecycle ────────────────────────────────────────────────────────

export function createAgentSessionStartEvent(
  ids: TraceEventIds,
  agentType: string,
  model: string,
  opts?: {
    modelAlias?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: AgentSessionStartData = {
    agent_type: agentType,
    model,
    model_alias: opts?.modelAlias,
  };
  return createEvent({
    type: EventType.AGENT_SESSION_START,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAgentSessionEndEvent(
  ids: TraceEventIds,
  status: string,
  opts?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    errorMessage?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: AgentSessionEndData = {
    status,
    input_tokens: opts?.inputTokens ?? 0,
    output_tokens: opts?.outputTokens ?? 0,
    cost: opts?.cost ?? 0.0,
    error_message: opts?.errorMessage,
  };
  return createEvent({
    type: EventType.AGENT_SESSION_END,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAgentRunStartEvent(
  ids: RunTraceEventIds,
  agentName: string,
  opts?: {
    parentRunId?: string;
    spanId?: string;
    parentEventId?: string;
    phase?: string;
    parentToolUseId?: string;
    displayLabel?: string;
  },
): TraceEvent {
  const data: AgentRunStartData = {
    run_id: ids.runId,
    agent_name: agentName,
    parent_run_id: opts?.parentRunId,
    container_id: ids.containerId,
    phase: opts?.phase,
    parent_tool_use_id: opts?.parentToolUseId,
    display_label: opts?.displayLabel,
  };
  return createEvent({
    type: EventType.AGENT_RUN_START,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAgentRunEndEvent(
  ids: RunTraceEventIds,
  agentName: string,
  status: "ok" | "error",
  opts?: {
    errorMessage?: string;
    usage?: TurnUsage;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: AgentRunEndData = {
    run_id: ids.runId,
    agent_name: agentName,
    status,
    error_message: opts?.errorMessage,
    ...(opts?.usage ? { usage: opts.usage } : {}),
  };
  return createEvent({
    type: EventType.AGENT_RUN_END,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createRunSteeredEvent(
  ids: RunTraceEventIds,
  agentName: string,
  message: string,
  opts?: {
    delivery?: "delivered" | "queued";
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: RunSteeredData = {
    run_id: ids.runId,
    agent_name: agentName,
    message,
    delivery: opts?.delivery ?? "delivered",
  };
  return createEvent({
    type: EventType.RUN_STEERED,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Pi Lifecycle ───────────────────────────────────────────────────────────

export function createPiAgentStartEvent(
  ids: TraceEventIds,
  opts?: {
    promptSummary?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiAgentStartData = {
    prompt_summary: opts?.promptSummary,
  };
  return createEvent({
    type: EventType.PI_AGENT_START,
    ids,
    eventData: data,
    source: TraceSource.AGENT,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiAgentEndEvent(
  ids: TraceEventIds,
  status: "ok" | "error",
  opts?: {
    errorMessage?: string;
    inputTokens?: number;
    outputTokens?: number;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiAgentEndData = {
    status,
    error_message: opts?.errorMessage,
    input_tokens: opts?.inputTokens,
    output_tokens: opts?.outputTokens,
  };
  return createEvent({
    type: EventType.PI_AGENT_END,
    ids,
    eventData: data,
    source: TraceSource.AGENT,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiTurnStartEvent(
  ids: TraceEventIds,
  opts?: {
    turnNumber?: number;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiTurnStartData = {
    turn_number: opts?.turnNumber,
  };
  return createEvent({
    type: EventType.PI_TURN_START,
    ids,
    eventData: data,
    source: TraceSource.AGENT,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiTurnEndEvent(
  ids: TraceEventIds,
  opts?: {
    turnNumber?: number;
    stopReason?: string;
    usage?: TurnUsage;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiTurnEndData = {
    turn_number: opts?.turnNumber,
    stop_reason: opts?.stopReason,
    ...(opts?.usage ? { usage: opts.usage } : {}),
  };
  return createEvent({
    type: EventType.PI_TURN_END,
    ids,
    eventData: data,
    source: TraceSource.AGENT,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Messages ───────────────────────────────────────────────────────────────

export function createUserMessageEvent(
  ids: TraceEventIds,
  content: string,
  phase: string,
  opts?: {
    parentEventId?: string;
    questionId?: string;
  },
): TraceEvent {
  const data: UserMessageData = {
    content,
    phase,
    ...(opts?.questionId !== undefined ? { question_id: opts.questionId } : {}),
  };
  return createEvent({
    type: EventType.USER_MESSAGE,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    parentEventId: opts?.parentEventId,
  });
}

export function createAssistantMessageEvent(
  ids: TraceEventIds,
  content: string,
  blockType: string,
  opts?: {
    parentEventId?: string;
    questionId?: string;
  },
): TraceEvent {
  const data: AssistantMessageData = {
    content,
    block_type: blockType,
    ...(opts?.questionId !== undefined ? { question_id: opts.questionId } : {}),
  };
  return createEvent({
    type: EventType.ASSISTANT_MESSAGE,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Tool Use ───────────────────────────────────────────────────────────────

export function createToolCallStartEvent(
  ids: TraceEventIds,
  toolName: string,
  toolUseId: string,
  opts?: {
    toolInput?: Record<string, unknown>;
    spanId?: string;
    parentEventId?: string;
    /** Mark the call as an agent-dispatching spawner tool (D77). */
    toolKind?: "spawner";
    /** The spawner tool's declared agent-name allowlist (D77). */
    spawns?: string[];
  },
): TraceEvent {
  const data: ToolCallStartData = {
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_input: opts?.toolInput,
    ...(opts?.toolKind !== undefined ? { toolKind: opts.toolKind } : {}),
    ...(opts?.spawns !== undefined ? { spawns: opts.spawns } : {}),
  };
  return createEvent({
    type: EventType.TOOL_CALL_START,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createToolCallEndEvent(
  ids: TraceEventIds,
  toolName: string,
  toolUseId: string,
  opts?: {
    toolOutput?: string;
    durationMs?: number;
    spanId?: string;
    parentEventId?: string;
    /** Mark the call as an agent-dispatching spawner tool (D77). */
    toolKind?: "spawner";
    /** The spawner tool's declared agent-name allowlist (D77). */
    spawns?: string[];
  },
): TraceEvent {
  const data: ToolCallEndData = {
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_output: opts?.toolOutput,
    duration_ms: opts?.durationMs,
    ...(opts?.toolKind !== undefined ? { toolKind: opts.toolKind } : {}),
    ...(opts?.spawns !== undefined ? { spawns: opts.spawns } : {}),
  };
  return createEvent({
    type: EventType.TOOL_CALL_END,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPreToolHookEvent(
  ids: TraceEventIds,
  toolName: string,
  opts?: {
    toolInput?: Record<string, unknown>;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PreToolHookData = {
    tool_name: toolName,
    tool_input: opts?.toolInput,
  };
  return createEvent({
    type: EventType.PRE_TOOL_HOOK,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

export function createPostToolHookEvent(
  ids: TraceEventIds,
  toolName: string,
  opts?: {
    toolOutput?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PostToolHookData = {
    tool_name: toolName,
    tool_output: opts?.toolOutput,
  };
  return createEvent({
    type: EventType.POST_TOOL_HOOK,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Phase Transitions ──────────────────────────────────────────────────────

export function createPhaseStartEvent(
  ids: TraceEventIds,
  phase: string,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PhaseStartData = { phase };
  return createEvent({
    type: EventType.PHASE_START,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPhaseEndEvent(
  ids: TraceEventIds,
  phase: string,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PhaseEndData = { phase };
  return createEvent({
    type: EventType.PHASE_END,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Pipeline Containers ────────────────────────────────────────────────────

export function createContainerStartEvent(
  ids: TraceEventIds,
  data: ContainerStartData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTAINER_START,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createContainerEndEvent(
  ids: TraceEventIds,
  data: ContainerEndData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTAINER_END,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Spawn Lifecycle ────────────────────────────────────────────────────────

export function createSystemPromptResolvedEvent(
  ids: TraceEventIds,
  data: SystemPromptResolvedData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.SYSTEM_PROMPT_RESOLVED,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createContextBuildStartedEvent(
  ids: TraceEventIds,
  data: ContextBuildStartedData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_BUILD_STARTED,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createContextInputResolvedEvent(
  ids: TraceEventIds,
  data: ContextInputResolvedData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_INPUT_RESOLVED,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createContextBuildCompletedEvent(
  ids: TraceEventIds,
  data: ContextBuildCompletedData,
  opts?: {
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_BUILD_COMPLETED,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── System ─────────────────────────────────────────────────────────────────

export function createErrorEvent(
  ids: TraceEventIds,
  opts?: {
    errorType?: string;
    errorMessage?: string;
    stackTrace?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: ErrorData = {
    error_type: opts?.errorType,
    error_message: opts?.errorMessage,
    stack_trace: opts?.stackTrace,
  };
  return createEvent({
    type: EventType.ERROR,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

export function createWarningEvent(
  ids: TraceEventIds,
  message: string,
  opts?: {
    warningType?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: WarningData = {
    message,
    warning_type: opts?.warningType,
  };
  return createEvent({
    type: EventType.WARNING,
    ids,
    eventData: data,
    source: TraceSource.KERNEL,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}
