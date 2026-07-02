/**
 * spanAttributes.ts — Attribute + payload extraction for PairedEvents.
 *
 * Isolates the big switch that pulls domain-specific fields (tool_name,
 * agent_name, status, phase, block_type, etc.) off each event type and turns
 * them into TraceSpanAttribute[] + optional input/output strings. Also hosts
 * title/status/category resolution so the builder is pure orchestration.
 */

import type {
  TraceSpanAttribute,
  TraceSpanCategory,
  TraceSpanStatus,
} from "@evilmartians/agent-prism-types";

import {
  EventType,
  type TraceEvent,
  type AgentSessionEndData,
  type AgentRunEndData,
  type AgentRunStartData,
  type AssistantMessageData,
  type ContextBuildCompletedData,
  type ContextBuildStartedData,
  type ContextInputResolvedData,
  type ErrorData,
  type PostToolHookData,
  type PreToolHookData,
  type SystemPromptResolvedData,
  type ToolCallEndData,
  type ToolCallStartData,
  type UIAskAnsweredData,
  type UIAskRequestedData,
  type UserMessageData,
  type WarningData,
} from "../types";

import type { PairedEvent } from "./pairEvents";

export function makeAttr(
  key: string,
  value: string | number | boolean | null | undefined,
): TraceSpanAttribute | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return { key, value: { intValue: String(value) } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  const str = String(value);
  if (str.length === 0) return null;
  return { key, value: { stringValue: str } };
}

export function pushAttr(
  attrs: TraceSpanAttribute[],
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  const attr = makeAttr(key, value);
  if (attr) attrs.push(attr);
}

export function categoryFor(eventType: string): TraceSpanCategory {
  switch (eventType) {
    case EventType.AGENT_RUN_START:
    case EventType.AGENT_RUN_END:
    case EventType.AGENT_SESSION_START:
    case EventType.AGENT_SESSION_END:
    case EventType.SYSTEM_PROMPT_RESOLVED:
    case EventType.CONTEXT_BUILD_STARTED:
    case EventType.CONTEXT_BUILD_COMPLETED:
    case EventType.CONTEXT_INPUT_RESOLVED:
      return "agent_invocation";
    case EventType.TOOL_CALL_START:
    case EventType.TOOL_CALL_END:
    case EventType.PRE_TOOL_HOOK:
    case EventType.POST_TOOL_HOOK:
      return "tool_execution";
    case EventType.ASSISTANT_MESSAGE:
      return "llm_call";
    case EventType.UI_ASK_REQUESTED:
    case EventType.UI_ASK_ANSWERED:
      return "event";
    default:
      return "event";
  }
}

export function statusFor(paired: PairedEvent): TraceSpanStatus {
  if (paired.kind === "pair") {
    if (paired.end.type === EventType.AGENT_RUN_END) {
      const data = paired.end.eventData as AgentRunEndData | null;
      return data?.status === "ok" ? "success" : "error";
    }
    return "success";
  }
  const event = paired.event;
  if (event.type === EventType.ERROR) return "error";
  if (event.type === EventType.WARNING) return "warning";
  if (event.type === EventType.CONTEXT_INPUT_RESOLVED) {
    const data = event.eventData as ContextInputResolvedData | null;
    if (data?.status === "error") return "error";
    if (data?.status === "empty") return "warning";
    return "success";
  }
  if (
    event.type === EventType.AGENT_RUN_START ||
    event.type === EventType.TOOL_CALL_START ||
    event.type === EventType.AGENT_SESSION_START ||
    event.type === EventType.UI_ASK_REQUESTED ||
    event.type === EventType.CONTEXT_BUILD_STARTED
  ) {
    return "pending";
  }
  const status = (event.eventData as { status?: unknown } | null)?.status;
  if (typeof status === "string") {
    if (status === "failed" || status === "error" || status === "blocked") return "error";
    if (status === "warning") return "warning";
    if (status === "started" || status === "running" || status === "queued") return "pending";
  }
  return "success";
}

export function titleFor(paired: PairedEvent): string {
  const event = paired.kind === "pair" ? paired.start : paired.event;
  const data = event.eventData as Record<string, unknown> | null;
  if (data) {
    if (event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_END) {
      const name = data.tool_name as string | undefined;
      if (name) return name;
    }
    if (event.type === EventType.AGENT_RUN_START || event.type === EventType.AGENT_RUN_END) {
      return "run";
    }
    if (event.type === EventType.AGENT_SESSION_START) {
      return "session start";
    }
    if (event.type === EventType.AGENT_SESSION_END) {
      return "session end";
    }
    if (event.type === EventType.PHASE_START || event.type === EventType.PHASE_END) {
      const phase = data.phase as string | undefined;
      if (phase) return phase;
    }
    if (event.type === EventType.ASSISTANT_MESSAGE) {
      const blockType = data.block_type as string | undefined;
      if (blockType) return blockType;
    }
    if (event.type === EventType.SYSTEM_PROMPT_RESOLVED) {
      const name = data.agent_name as string | undefined;
      if (name) return `system prompt: ${name}`;
    }
    if (
      event.type === EventType.CONTEXT_BUILD_STARTED ||
      event.type === EventType.CONTEXT_BUILD_COMPLETED
    ) {
      return "context build";
    }
    if (event.type === EventType.CONTEXT_INPUT_RESOLVED) {
      const ref = data.input_ref as string | undefined;
      if (ref) return `input: ${ref}`;
      const loader = data.loader_kind as string | undefined;
      if (loader) return `input: ${loader}`;
    }
    if (event.type === EventType.UI_ASK_REQUESTED || event.type === EventType.UI_ASK_ANSWERED) {
      const kind = data.kind as string | undefined;
      return kind ? `ui ask: ${kind}` : "ui ask";
    }
    if (event.type === EventType.PRE_TOOL_HOOK) {
      const name = data.tool_name as string | undefined;
      if (name) return `pre-hook: ${name}`;
    }
    if (event.type === EventType.POST_TOOL_HOOK) {
      const name = data.tool_name as string | undefined;
      if (name) return `post-hook: ${name}`;
    }
    const operation = data.operation as string | undefined;
    if (operation) return operation;
  }
  return event.type;
}

export interface SpanPayload {
  input?: string;
  output?: string;
  attributes?: TraceSpanAttribute[];
}

function fillPaired(paired: PairedEvent & { kind: "pair" }, attrs: TraceSpanAttribute[]): {
  input?: string;
  output?: string;
} {
  const startType = paired.start.type;
  let input: string | undefined;
  let output: string | undefined;

  if (startType === EventType.TOOL_CALL_START) {
    const startData = paired.start.eventData as ToolCallStartData | null;
    const endData = paired.end.eventData as ToolCallEndData | null;
    if (startData?.tool_input !== undefined && startData?.tool_input !== null) {
      input = JSON.stringify(startData.tool_input);
    }
    if (endData?.tool_output) output = endData.tool_output;
    pushAttr(attrs, "tool_name", startData?.tool_name ?? endData?.tool_name);
    pushAttr(attrs, "tool_use_id", startData?.tool_use_id ?? endData?.tool_use_id);
    pushAttr(attrs, "duration_ms", endData?.duration_ms ?? null);
  } else if (startType === EventType.AGENT_RUN_START) {
    const startData = paired.start.eventData as AgentRunStartData | null;
    const endData = paired.end.eventData as AgentRunEndData | null;
    pushAttr(attrs, "run_id", startData?.run_id);
    pushAttr(attrs, "agent_name", startData?.agent_name);
    pushAttr(attrs, "parent_run_id", startData?.parent_run_id);
    pushAttr(attrs, "status", endData?.status);
    pushAttr(attrs, "error_message", endData?.error_message);
  } else if (startType === EventType.CONTEXT_BUILD_STARTED) {
    const startData = paired.start.eventData as ContextBuildStartedData | null;
    const endData = paired.end.eventData as ContextBuildCompletedData | null;
    if (startData?.declared_inputs && startData.declared_inputs.length > 0) {
      input = JSON.stringify(startData.declared_inputs);
    }
    if (endData?.rendered_context) output = endData.rendered_context;
    pushAttr(attrs, "agent_name", startData?.agent_name);
    pushAttr(attrs, "total_bytes", endData?.total_bytes ?? null);
    pushAttr(attrs, "inputs_count", endData?.inputs?.length ?? null);
  } else if (startType === EventType.UI_ASK_REQUESTED) {
    const startData = paired.start.eventData as UIAskRequestedData | null;
    const endData = paired.end.eventData as UIAskAnsweredData | null;
    if (startData?.payload !== undefined && startData?.payload !== null) {
      input = JSON.stringify(startData.payload);
    }
    if (endData?.exchanges !== undefined && endData?.exchanges !== null) {
      output = JSON.stringify(endData.exchanges);
    }
    pushAttr(attrs, "kind", endData?.kind ?? startData?.kind);
    pushAttr(attrs, "tool_use_id", endData?.tool_use_id ?? startData?.tool_use_id);
  }

  return { input, output };
}

function fillPoint(ev: TraceEvent, attrs: TraceSpanAttribute[]): {
  input?: string;
  output?: string;
} {
  let input: string | undefined;
  let output: string | undefined;

  if (ev.type === EventType.ASSISTANT_MESSAGE) {
    const data = ev.eventData as AssistantMessageData | null;
    if (data?.content) output = data.content;
    pushAttr(attrs, "block_type", data?.block_type);
  } else if (ev.type === EventType.USER_MESSAGE) {
    const data = ev.eventData as UserMessageData | null;
    if (data?.content) input = data.content;
    pushAttr(attrs, "phase", data?.phase);
  } else if (ev.type === EventType.AGENT_SESSION_END) {
    const data = ev.eventData as AgentSessionEndData | null;
    pushAttr(attrs, "status", data?.status);
    pushAttr(attrs, "input_tokens", data?.input_tokens);
    pushAttr(attrs, "output_tokens", data?.output_tokens);
    pushAttr(attrs, "cost", data?.cost);
    pushAttr(attrs, "error_message", data?.error_message);
  } else if (ev.type === EventType.AGENT_SESSION_START) {
    const data = ev.eventData as
      | { agent_type?: string; model?: string; model_alias?: string | null }
      | null;
    pushAttr(attrs, "agent_type", data?.agent_type);
    pushAttr(attrs, "model", data?.model);
    pushAttr(attrs, "model_alias", data?.model_alias);
  } else if (ev.type === EventType.TOOL_CALL_START) {
    const data = ev.eventData as ToolCallStartData | null;
    if (data?.tool_input !== undefined && data?.tool_input !== null) {
      input = JSON.stringify(data.tool_input);
    }
    pushAttr(attrs, "tool_name", data?.tool_name);
    pushAttr(attrs, "tool_use_id", data?.tool_use_id);
  } else if (ev.type === EventType.TOOL_CALL_END) {
    const data = ev.eventData as ToolCallEndData | null;
    if (data?.tool_output) output = data.tool_output;
    pushAttr(attrs, "tool_name", data?.tool_name);
    pushAttr(attrs, "tool_use_id", data?.tool_use_id);
    pushAttr(attrs, "duration_ms", data?.duration_ms ?? null);
  } else if (ev.type === EventType.AGENT_RUN_START) {
    const data = ev.eventData as AgentRunStartData | null;
    pushAttr(attrs, "run_id", data?.run_id);
    pushAttr(attrs, "agent_name", data?.agent_name);
    pushAttr(attrs, "parent_run_id", data?.parent_run_id);
  } else if (ev.type === EventType.SYSTEM_PROMPT_RESOLVED) {
    const data = ev.eventData as SystemPromptResolvedData | null;
    if (data?.rendered_prompt) output = data.rendered_prompt;
    pushAttr(attrs, "agent_name", data?.agent_name);
    pushAttr(
      attrs,
      "tools_allowlist",
      data?.tools_allowlist ? data.tools_allowlist.join(",") : null,
    );
    pushAttr(attrs, "domain_rules_installed", data?.domain_rules_installed);
    pushAttr(
      attrs,
      "extensions",
      Array.isArray(data?.extensions)
        ? data.extensions.join(",")
        : typeof data?.extensions === "boolean"
          ? data.extensions
          : null,
    );
  } else if (ev.type === EventType.CONTEXT_BUILD_STARTED) {
    const data = ev.eventData as ContextBuildStartedData | null;
    pushAttr(attrs, "agent_name", data?.agent_name);
    pushAttr(attrs, "declared_inputs_count", data?.declared_inputs?.length ?? null);
  } else if (ev.type === EventType.CONTEXT_BUILD_COMPLETED) {
    const data = ev.eventData as ContextBuildCompletedData | null;
    if (data?.rendered_context) output = data.rendered_context;
    pushAttr(attrs, "total_bytes", data?.total_bytes ?? null);
    pushAttr(attrs, "inputs_count", data?.inputs?.length ?? null);
  } else if (ev.type === EventType.CONTEXT_INPUT_RESOLVED) {
    const data = ev.eventData as ContextInputResolvedData | null;
    pushAttr(attrs, "loader_kind", data?.loader_kind);
    pushAttr(attrs, "input_ref", data?.input_ref);
    pushAttr(attrs, "status", data?.status);
    pushAttr(attrs, "bytes", data?.bytes ?? null);
    pushAttr(attrs, "from_cache", data?.from_cache);
    pushAttr(attrs, "error", data?.error);
    pushAttr(attrs, "content_hash", data?.content_hash);
  } else if (ev.type === EventType.UI_ASK_REQUESTED) {
    const data = ev.eventData as UIAskRequestedData | null;
    if (data?.payload !== undefined && data?.payload !== null) {
      input = JSON.stringify(data.payload);
    }
    pushAttr(attrs, "kind", data?.kind);
    pushAttr(attrs, "tool_use_id", data?.tool_use_id);
  } else if (ev.type === EventType.UI_ASK_ANSWERED) {
    const data = ev.eventData as UIAskAnsweredData | null;
    if (data?.exchanges !== undefined && data?.exchanges !== null) {
      output = JSON.stringify(data.exchanges);
    }
    pushAttr(attrs, "kind", data?.kind);
    pushAttr(attrs, "tool_use_id", data?.tool_use_id);
  } else if (ev.type === EventType.PRE_TOOL_HOOK) {
    const data = ev.eventData as PreToolHookData | null;
    if (data?.tool_input !== undefined && data?.tool_input !== null) {
      input = JSON.stringify(data.tool_input);
    }
    pushAttr(attrs, "tool_name", data?.tool_name);
  } else if (ev.type === EventType.POST_TOOL_HOOK) {
    const data = ev.eventData as PostToolHookData | null;
    if (data?.tool_output) output = data.tool_output;
    pushAttr(attrs, "tool_name", data?.tool_name);
  } else if (ev.type === EventType.ERROR) {
    const data = ev.eventData as ErrorData | null;
    pushAttr(attrs, "error_type", data?.error_type);
    pushAttr(attrs, "error_message", data?.error_message);
    pushAttr(attrs, "stack_trace", data?.stack_trace);
  } else if (ev.type === EventType.WARNING) {
    const data = ev.eventData as WarningData | null;
    pushAttr(attrs, "warning_type", data?.warning_type);
    pushAttr(attrs, "message", data?.message);
  } else {
    const data = ev.eventData as Record<string, unknown> | null;
    pushAttr(attrs, "operation", typeof data?.operation === "string" ? data.operation : null);
    pushAttr(attrs, "status", typeof data?.status === "string" ? data.status : null);
    pushAttr(attrs, "detail", typeof data?.detail === "string" ? data.detail : null);
    pushAttr(attrs, "phase", typeof data?.phase === "string" ? data.phase : null);
    pushAttr(attrs, "container_kind", typeof data?.containerKind === "string" ? data.containerKind : null);
  }

  return { input, output };
}

export function extractSpanPayload(paired: PairedEvent): SpanPayload {
  const attrs: TraceSpanAttribute[] = [];
  const sourceEvent = paired.kind === "pair" ? paired.start : paired.event;
  pushAttr(attrs, "trace_level", sourceEvent.traceLevel);
  pushAttr(attrs, "event_type", sourceEvent.type);
  pushAttr(attrs, "container_id", sourceEvent.containerId);

  const { input, output } =
    paired.kind === "pair" ? fillPaired(paired, attrs) : fillPoint(paired.event, attrs);

  const result: SpanPayload = {};
  if (input !== undefined) result.input = input;
  if (output !== undefined) result.output = output;
  if (attrs.length > 0) result.attributes = attrs;
  return result;
}
