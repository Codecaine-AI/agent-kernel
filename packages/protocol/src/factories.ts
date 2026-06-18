/**
 * Event factory functions — construct TraceEvent instances with correct defaults.
 *
 * Factories are synchronous. They build the object; publishing to the
 * TraceEventWriter is handled separately by the caller.
 *
 * Trace level assignments:
 *   SUMMARY (0)    — user_message, assistant_message, ui_ask_*
 *   PROCESSING (1) — system_prompt, context_build, tool_call (default slider view)
 *   DEBUG (2)      — agent lifecycle, phases, hooks, errors
 *   INTERNAL (3)   — Pi turns, context input resolution
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
  type SystemPromptResolvedData,
  type ToolCallEndData,
  type ToolCallStartData,
  type AskExchange,
  type UIAskAnsweredData,
  type UIAskApprovalResponsePayload,
  type UIAskKind,
  type UIAskRequestedData,
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

// ─── Base Constructor ───────────────────────────────────────────────────────

interface CreateEventOptions {
  type: string;
  appSessionId: string;
  userId: string;
  eventData: EventData;
  source: TraceSourceValue;
  agentId?: string;
  containerId?: string;
  traceLevel?: number;
  spanId?: string;
  parentEventId?: string;
  piSessionUuid?: string;
  timestamp?: string;
}

function createEvent(opts: CreateEventOptions): TraceEvent {
  return {
    eventId: newEventId(),
    appSessionId: opts.appSessionId,
    userId: opts.userId,
    type: opts.type as TraceEvent["type"],
    source: opts.source,
    agentId: opts.agentId,
    containerId: opts.containerId,
    traceLevel: (opts.traceLevel ?? TraceLevel.SUMMARY) as TraceEvent["traceLevel"],
    eventData: opts.eventData,
    spanId: opts.spanId,
    parentEventId: opts.parentEventId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    ...(opts.piSessionUuid && { piSessionUuid: opts.piSessionUuid }),
  };
}

// ─── Agent Lifecycle ────────────────────────────────────────────────────────

export function createAgentSessionStartEvent(
  appSessionId: string,
  userId: string,
  agentType: string,
  model: string,
  opts?: {
    agentId?: string;
    modelAlias?: string;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAgentSessionEndEvent(
  appSessionId: string,
  userId: string,
  status: string,
  opts?: {
    agentId?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    errorMessage?: string;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAgentRunStartEvent(
  appSessionId: string,
  userId: string,
  agentName: string,
  runId: string,
  opts?: {
    agentId?: string;
    parentRunId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
    containerId?: string;
    phase?: string;
    parentToolUseId?: string;
    displayLabel?: string;
  },
): TraceEvent {
  const data: AgentRunStartData = {
    run_id: runId,
    agent_name: agentName,
    parent_run_id: opts?.parentRunId,
    container_id: opts?.containerId,
    phase: opts?.phase,
    parent_tool_use_id: opts?.parentToolUseId,
    display_label: opts?.displayLabel,
  };
  return createEvent({
    type: EventType.AGENT_RUN_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

export function createAgentRunEndEvent(
  appSessionId: string,
  userId: string,
  agentName: string,
  runId: string,
  status: "ok" | "error",
  opts?: {
    agentId?: string;
    errorMessage?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  const data: AgentRunEndData = {
    run_id: runId,
    agent_name: agentName,
    status,
    error_message: opts?.errorMessage,
  };
  return createEvent({
    type: EventType.AGENT_RUN_END,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

// ─── Pi Lifecycle ───────────────────────────────────────────────────────────

export function createPiAgentStartEvent(
  appSessionId: string,
  userId: string,
  opts?: {
    agentId?: string;
    promptSummary?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiAgentStartData = {
    prompt_summary: opts?.promptSummary,
  };
  return createEvent({
    type: EventType.PI_AGENT_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.AGENT,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiAgentEndEvent(
  appSessionId: string,
  userId: string,
  status: "ok" | "error",
  opts?: {
    agentId?: string;
    errorMessage?: string;
    inputTokens?: number;
    outputTokens?: number;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.AGENT,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiTurnStartEvent(
  appSessionId: string,
  userId: string,
  opts?: {
    agentId?: string;
    turnNumber?: number;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiTurnStartData = {
    turn_number: opts?.turnNumber,
  };
  return createEvent({
    type: EventType.PI_TURN_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.AGENT,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPiTurnEndEvent(
  appSessionId: string,
  userId: string,
  opts?: {
    agentId?: string;
    turnNumber?: number;
    stopReason?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PiTurnEndData = {
    turn_number: opts?.turnNumber,
    stop_reason: opts?.stopReason,
  };
  return createEvent({
    type: EventType.PI_TURN_END,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.AGENT,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Messages ───────────────────────────────────────────────────────────────

export function createUserMessageEvent(
  appSessionId: string,
  userId: string,
  content: string,
  phase: string,
  opts?: {
    agentId?: string;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    parentEventId: opts?.parentEventId,
  });
}

export function createAssistantMessageEvent(
  appSessionId: string,
  userId: string,
  content: string,
  blockType: string,
  opts?: {
    agentId?: string;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Tool Use ───────────────────────────────────────────────────────────────

export function createToolCallStartEvent(
  appSessionId: string,
  userId: string,
  toolName: string,
  toolUseId: string,
  opts?: {
    agentId?: string;
    toolInput?: Record<string, unknown>;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: ToolCallStartData = {
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_input: opts?.toolInput,
  };
  return createEvent({
    type: EventType.TOOL_CALL_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createToolCallEndEvent(
  appSessionId: string,
  userId: string,
  toolName: string,
  toolUseId: string,
  opts?: {
    agentId?: string;
    toolOutput?: string;
    durationMs?: number;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: ToolCallEndData = {
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_output: opts?.toolOutput,
    duration_ms: opts?.durationMs,
  };
  return createEvent({
    type: EventType.TOOL_CALL_END,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPreToolHookEvent(
  appSessionId: string,
  userId: string,
  toolName: string,
  opts?: {
    agentId?: string;
    toolInput?: Record<string, unknown>;
    containerId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PreToolHookData = {
    tool_name: toolName,
    tool_input: opts?.toolInput,
  };
  return createEvent({
    type: EventType.PRE_TOOL_HOOK,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

export function createPostToolHookEvent(
  appSessionId: string,
  userId: string,
  toolName: string,
  opts?: {
    agentId?: string;
    toolOutput?: string;
    containerId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PostToolHookData = {
    tool_name: toolName,
    tool_output: opts?.toolOutput,
  };
  return createEvent({
    type: EventType.POST_TOOL_HOOK,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Phase Transitions ──────────────────────────────────────────────────────

export function createPhaseStartEvent(
  appSessionId: string,
  userId: string,
  phase: string,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PhaseStartData = { phase };
  return createEvent({
    type: EventType.PHASE_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createPhaseEndEvent(
  appSessionId: string,
  userId: string,
  phase: string,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: PhaseEndData = { phase };
  return createEvent({
    type: EventType.PHASE_END,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Pipeline Containers ────────────────────────────────────────────────────

export function createContainerStartEvent(
  appSessionId: string,
  userId: string,
  data: ContainerStartData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTAINER_START,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId ?? data.container_id,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

export function createContainerEndEvent(
  appSessionId: string,
  userId: string,
  data: ContainerEndData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTAINER_END,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId ?? data.container_id,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
  });
}

// ─── Spawn Lifecycle ────────────────────────────────────────────────────────

export function createSystemPromptResolvedEvent(
  appSessionId: string,
  userId: string,
  data: SystemPromptResolvedData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.SYSTEM_PROMPT_RESOLVED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

export function createContextBuildStartedEvent(
  appSessionId: string,
  userId: string,
  data: ContextBuildStartedData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_BUILD_STARTED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

export function createContextInputResolvedEvent(
  appSessionId: string,
  userId: string,
  data: ContextInputResolvedData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_INPUT_RESOLVED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.INTERNAL,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

export function createContextBuildCompletedEvent(
  appSessionId: string,
  userId: string,
  data: ContextBuildCompletedData,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  return createEvent({
    type: EventType.CONTEXT_BUILD_COMPLETED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.PROCESSING,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

// ─── UI Asks ────────────────────────────────────────────────────────────────

export function createUIAskRequestedEvent(
  appSessionId: string,
  userId: string,
  toolUseId: string,
  kind: UIAskKind,
  payload: Record<string, unknown>,
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
  },
): TraceEvent {
  const data: UIAskRequestedData = {
    tool_use_id: toolUseId,
    kind,
    payload,
  };
  return createEvent({
    type: EventType.UI_ASK_REQUESTED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

export function createUIAskAnsweredEvent(
  appSessionId: string,
  userId: string,
  toolUseId: string,
  kind: UIAskKind,
  exchanges: AskExchange[],
  opts?: {
    agentId?: string;
    containerId?: string;
    spanId?: string;
    parentEventId?: string;
    piSessionUuid?: string;
    approvalResponse?: UIAskApprovalResponsePayload;
  },
): TraceEvent {
  const data: UIAskAnsweredData = {
    tool_use_id: toolUseId,
    kind,
    exchanges,
    ...(opts?.approvalResponse
      ? { approval_response: opts.approvalResponse }
      : {}),
  };
  return createEvent({
    type: EventType.UI_ASK_ANSWERED,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    spanId: opts?.spanId,
    parentEventId: opts?.parentEventId,
    piSessionUuid: opts?.piSessionUuid,
  });
}

// ─── System ─────────────────────────────────────────────────────────────────

export function createErrorEvent(
  appSessionId: string,
  userId: string,
  opts?: {
    agentId?: string;
    errorType?: string;
    errorMessage?: string;
    stackTrace?: string;
    containerId?: string;
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
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}

export function createWarningEvent(
  appSessionId: string,
  userId: string,
  message: string,
  opts?: {
    agentId?: string;
    warningType?: string;
    containerId?: string;
    parentEventId?: string;
  },
): TraceEvent {
  const data: WarningData = {
    message,
    warning_type: opts?.warningType,
  };
  return createEvent({
    type: EventType.WARNING,
    appSessionId,
    userId,
    eventData: data,
    source: TraceSource.KERNEL,
    agentId: opts?.agentId,
    containerId: opts?.containerId,
    traceLevel: TraceLevel.DEBUG,
    parentEventId: opts?.parentEventId,
  });
}
