/**
 * spanAttributes.ts — Title / status / category / payload resolution for
 * PairedEvents, driven by one declarative registry.
 *
 * EVENT_SPECS maps event type → { category, title, status, point, pair,
 * pairStatus }. Every field is optional and falls back to a generic rule, so
 * adding a new event type is one table entry, not a new switch branch:
 *
 *   - category    → "event"
 *   - title       → eventData.operation, else the event type string
 *   - status      → derived from eventData.status (failed/error/blocked →
 *                   error, warning → warning, started/running/queued →
 *                   pending, else success)
 *   - point       → generic operation/status/detail/phase/container_kind attrs
 *   - pair        → no extra attrs (only types pairEvents can pair carry one)
 *   - pairStatus  → "success" (looked up on the END event's type)
 */

import type {
  TraceSpanAttribute,
  TraceSpanCategory,
  TraceSpanStatus,
} from "@evilmartians/agent-prism-types";

import {
  EventType,
  UI_ASK_ANSWERED,
  UI_ASK_REQUESTED,
  type JsonObject,
  type AgentRunEndData,
  type AgentRunStartData,
  type AgentSessionEndData,
  type AgentSessionStartData,
  type AssistantMessageData,
  type ContextBuildCompletedData,
  type ContextBuildStartedData,
  type ContextInputResolvedData,
  type ErrorData,
  type PhaseEndData,
  type PhaseStartData,
  type PiRequestSnapshotData,
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

// ─── Attribute primitives ────────────────────────────────────────────────────

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

/** Read a string attribute back off a built span (grouping stages route by these). */
export function readStringAttr(
  span: { attributes?: TraceSpanAttribute[] },
  key: string,
): string | null {
  const found = span.attributes?.find((a) => a.key === key);
  return found?.value?.stringValue ?? null;
}

// ─── Registry types + shared extraction helpers ─────────────────────────────

type AttrValue = string | number | boolean | null | undefined;

/** Ordered [key, value] pairs; null/undefined/empty values are dropped. */
type AttrEntry = readonly [key: string, value: AttrValue];

interface Payload {
  input?: string;
  output?: string;
  attrs?: AttrEntry[];
}

interface EventSpec {
  category?: TraceSpanCategory;
  /** Title from the (start) event's data; only consulted when data is non-null. */
  title?: (data: never) => string | undefined;
  /** Point-event status; constant or derived from data. */
  status?: TraceSpanStatus | ((data: never) => TraceSpanStatus);
  /** Point-event input/output/attributes. */
  point?: (data: never) => Payload;
  /** Pair input/output/attributes, keyed by the START event's type. */
  pair?: (start: never, end: never) => Payload;
  /** Pair status, keyed by the END event's type. */
  pairStatus?: (start: never, end: never) => TraceSpanStatus;
}

/** Pins an entry's extractors to its start/end eventData types. */
function spec<Start, End = never>(entry: {
  category?: TraceSpanCategory;
  title?: (data: Start & JsonObject) => string | undefined;
  status?: TraceSpanStatus | ((data: Start | null) => TraceSpanStatus);
  point?: (data: Start | null) => Payload;
  pair?: (start: Start | null, end: End | null) => Payload;
  pairStatus?: (start: Start | null, end: End | null) => TraceSpanStatus;
}): EventSpec {
  return entry as EventSpec;
}

/** JSON-encode any present value (objects, arrays, scalars). */
function asJson(value: unknown): string | undefined {
  return value !== undefined && value !== null ? JSON.stringify(value) : undefined;
}

/** Pass through non-empty strings. */
function asText(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

/** Comma-join a string list (empty lists render as no attribute). */
function asCsv(list: string[] | null | undefined): string | null {
  return list ? list.join(",") : null;
}

// ─── Spawner tool helpers (D77) ─────────────────────────────────────────────
// A tool call whose eventData.toolKind === "spawner" dispatches subagents. It
// pairs / times / statuses exactly like an ordinary tool; these helpers only
// add the distinguishing attributes and a dispatch-flavored title. Absent /
// unknown toolKind falls through untouched (characterization snapshot proves it).

type ToolCallData = { tool_name?: string; toolKind?: string; spawns?: string[] };

function isSpawner(data: ToolCallData | null): boolean {
  return data?.toolKind === "spawner";
}

/**
 * Title for a spawner call: "Dispatch: <agents>" using the declared agent
 * list, e.g. "Dispatch: source-scout" or "Dispatch: scout-a, scout-b". A
 * wildcard (["*"]) or absent list falls back to the tool name so the row still
 * reads as a dispatch: "Dispatch: spawn_research_scouts".
 */
function spawnerTitle(data: ToolCallData): string {
  const spawns = data.spawns;
  const named = spawns?.filter((s) => s && s !== "*") ?? [];
  if (named.length > 0) return `Dispatch: ${named.join(", ")}`;
  return `Dispatch: ${data.tool_name ?? "agents"}`;
}

/** Spawner-only attributes appended to a tool span (dropped for ordinary tools). */
function spawnerAttrs(data: ToolCallData | null): AttrEntry[] {
  if (!isSpawner(data)) return [];
  return [
    ["tool_kind", "spawner"],
    ["spawns", asCsv(data?.spawns)],
  ];
}

function stringField(data: JsonObject | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

/** Fallback attrs for event types without a registry entry (app events). */
function genericPoint(data: unknown): Payload {
  const record = data as JsonObject | null;
  return {
    attrs: [
      ["operation", stringField(record, "operation")],
      ["status", stringField(record, "status")],
      ["detail", stringField(record, "detail")],
      ["phase", stringField(record, "phase")],
      ["container_kind", stringField(record, "containerKind")],
    ],
  };
}

/** Fallback status for event types without a status rule. */
function genericStatus(data: unknown): TraceSpanStatus {
  const status = (data as { status?: unknown } | null)?.status;
  if (typeof status === "string") {
    if (status === "failed" || status === "error" || status === "blocked") return "error";
    if (status === "warning") return "warning";
    if (status === "started" || status === "running" || status === "queued") return "pending";
  }
  return "success";
}

// ─── The registry ────────────────────────────────────────────────────────────

const EVENT_SPECS: Record<string, EventSpec> = {
  [EventType.AGENT_SESSION_START]: spec<AgentSessionStartData>({
    category: "agent_invocation",
    title: () => "session start",
    status: "pending",
    point: (d) => ({
      attrs: [
        ["agent_type", d?.agent_type],
        ["model", d?.model],
        ["model_alias", d?.model_alias],
      ],
    }),
  }),
  [EventType.AGENT_SESSION_END]: spec<AgentSessionEndData>({
    category: "agent_invocation",
    title: () => "session end",
    point: (d) => ({
      attrs: [
        ["status", d?.status],
        ["input_tokens", d?.input_tokens],
        ["output_tokens", d?.output_tokens],
        ["cost", d?.cost],
        ["error_message", d?.error_message],
      ],
    }),
  }),
  [EventType.AGENT_RUN_START]: spec<AgentRunStartData, AgentRunEndData>({
    category: "agent_invocation",
    title: () => "run",
    status: "pending",
    point: (d) => ({
      attrs: [
        ["run_id", d?.run_id],
        ["agent_name", d?.agent_name],
        ["parent_run_id", d?.parent_run_id],
      ],
    }),
    pair: (start, end) => ({
      attrs: [
        ["run_id", start?.run_id],
        ["agent_name", start?.agent_name],
        ["parent_run_id", start?.parent_run_id],
        ["status", end?.status],
        ["error_message", end?.error_message],
      ],
    }),
  }),
  [EventType.AGENT_RUN_END]: spec<AgentRunEndData, AgentRunEndData>({
    category: "agent_invocation",
    title: () => "run",
    pairStatus: (_start, end) => (end?.status === "ok" ? "success" : "error"),
  }),
  [EventType.SYSTEM_PROMPT_RESOLVED]: spec<SystemPromptResolvedData>({
    category: "agent_invocation",
    title: (d) => (d.agent_name ? `system prompt: ${d.agent_name}` : undefined),
    point: (d) => ({
      output: asText(d?.rendered_prompt),
      attrs: [
        ["agent_name", d?.agent_name],
        ["tools_allowlist", asCsv(d?.tools_allowlist)],
        ["domain_rules_installed", d?.domain_rules_installed],
        [
          "extensions",
          Array.isArray(d?.extensions)
            ? d.extensions.join(",")
            : typeof d?.extensions === "boolean"
              ? d.extensions
              : null,
        ],
      ],
    }),
  }),
  [EventType.CONTEXT_BUILD_STARTED]: spec<ContextBuildStartedData, ContextBuildCompletedData>({
    category: "agent_invocation",
    title: () => "context build",
    status: "pending",
    point: (d) => ({
      attrs: [
        ["agent_name", d?.agent_name],
        ["declared_inputs_count", d?.declared_inputs?.length],
      ],
    }),
    pair: (start, end) => ({
      input:
        start?.declared_inputs && start.declared_inputs.length > 0
          ? JSON.stringify(start.declared_inputs)
          : undefined,
      output: asText(end?.rendered_context),
      attrs: [
        ["agent_name", start?.agent_name],
        ["total_bytes", end?.total_bytes],
        ["inputs_count", end?.inputs?.length],
      ],
    }),
  }),
  [EventType.CONTEXT_BUILD_COMPLETED]: spec<ContextBuildCompletedData>({
    category: "agent_invocation",
    title: () => "context build",
    point: (d) => ({
      output: asText(d?.rendered_context),
      attrs: [
        ["total_bytes", d?.total_bytes],
        ["inputs_count", d?.inputs?.length],
      ],
    }),
  }),
  [EventType.CONTEXT_INPUT_RESOLVED]: spec<ContextInputResolvedData>({
    category: "agent_invocation",
    title: (d) =>
      d.input_ref
        ? `input: ${d.input_ref}`
        : d.loader_kind
          ? `input: ${d.loader_kind}`
          : undefined,
    status: (d) =>
      d?.status === "error" ? "error" : d?.status === "empty" ? "warning" : "success",
    point: (d) => ({
      attrs: [
        ["loader_kind", d?.loader_kind],
        ["input_ref", d?.input_ref],
        ["status", d?.status],
        ["bytes", d?.bytes],
        ["from_cache", d?.from_cache],
        ["error", d?.error],
        ["content_hash", d?.content_hash],
      ],
    }),
  }),
  [EventType.USER_MESSAGE]: spec<UserMessageData>({
    point: (d) => ({
      input: asText(d?.content),
      attrs: [["phase", d?.phase]],
    }),
  }),
  [EventType.ASSISTANT_MESSAGE]: spec<AssistantMessageData>({
    category: "llm_call",
    title: (d) => d.block_type,
    point: (d) => ({
      output: asText(d?.content),
      attrs: [["block_type", d?.block_type]],
    }),
  }),
  [EventType.PI_REQUEST_SNAPSHOT]: spec<PiRequestSnapshotData>({
    category: "llm_call",
    title: (d) => `Context window · turn ${d.turn_number}`,
    point: (d) => ({
      // The sanitized per-message refs ride along as input JSON so the
      // detail-panel renderer can show the per-message table without
      // re-parsing span.raw.
      input: asJson(d?.message_refs),
      attrs: [
        ["turn_number", d?.turn_number],
        ["prompt_hash", d?.prompt_hash],
        ["system_prompt_blob_hash", d?.system_prompt_blob_hash],
        ["message_count", d?.message_count],
        ["total_text_chars", d?.total_text_chars],
        ["total_image_count", d?.total_image_count],
        // Three-section boundaries when the turn was assembled by the
        // builder; undefined (no attribute) on untagged snapshots. Offline
        // fallback for the read-API's `context.sections`.
        ["sections", d?.sections ? asJson(d.sections) : undefined],
      ],
    }),
  }),
  [EventType.TOOL_CALL_START]: spec<ToolCallStartData, ToolCallEndData>({
    category: "tool_execution",
    title: (d) => (isSpawner(d) ? spawnerTitle(d) : d.tool_name),
    status: "pending",
    point: (d) => ({
      input: asJson(d?.tool_input),
      attrs: [
        ["tool_name", d?.tool_name],
        ["tool_use_id", d?.tool_use_id],
        ...spawnerAttrs(d),
      ],
    }),
    pair: (start, end) => ({
      input: asJson(start?.tool_input),
      output: asText(end?.tool_output),
      attrs: [
        ["tool_name", start?.tool_name ?? end?.tool_name],
        ["tool_use_id", start?.tool_use_id ?? end?.tool_use_id],
        ["duration_ms", end?.duration_ms],
        ...spawnerAttrs(start ?? end),
      ],
    }),
  }),
  [EventType.TOOL_CALL_END]: spec<ToolCallEndData>({
    category: "tool_execution",
    title: (d) => (isSpawner(d) ? spawnerTitle(d) : d.tool_name),
    point: (d) => ({
      output: asText(d?.tool_output),
      attrs: [
        ["tool_name", d?.tool_name],
        ["tool_use_id", d?.tool_use_id],
        ["duration_ms", d?.duration_ms],
        ...spawnerAttrs(d),
      ],
    }),
  }),
  [EventType.PRE_TOOL_HOOK]: spec<PreToolHookData>({
    category: "tool_execution",
    title: (d) => (d.tool_name ? `pre-hook: ${d.tool_name}` : undefined),
    point: (d) => ({
      input: asJson(d?.tool_input),
      attrs: [["tool_name", d?.tool_name]],
    }),
  }),
  [EventType.POST_TOOL_HOOK]: spec<PostToolHookData>({
    category: "tool_execution",
    title: (d) => (d.tool_name ? `post-hook: ${d.tool_name}` : undefined),
    point: (d) => ({
      output: asText(d?.tool_output),
      attrs: [["tool_name", d?.tool_name]],
    }),
  }),
  [EventType.PHASE_START]: spec<PhaseStartData>({
    title: (d) => d.phase,
  }),
  [EventType.PHASE_END]: spec<PhaseEndData>({
    title: (d) => d.phase,
  }),
  [EventType.ERROR]: spec<ErrorData>({
    status: "error",
    point: (d) => ({
      attrs: [
        ["error_type", d?.error_type],
        ["error_message", d?.error_message],
        ["stack_trace", d?.stack_trace],
      ],
    }),
  }),
  [EventType.WARNING]: spec<WarningData>({
    status: "warning",
    point: (d) => ({
      attrs: [
        ["warning_type", d?.warning_type],
        ["message", d?.message],
      ],
    }),
  }),
  [UI_ASK_REQUESTED]: spec<UIAskRequestedData, UIAskAnsweredData>({
    title: (d) => (d.kind ? `ui ask: ${d.kind}` : "ui ask"),
    status: "pending",
    point: (d) => ({
      input: asJson(d?.payload),
      attrs: [
        ["kind", d?.kind],
        ["tool_use_id", d?.tool_use_id],
      ],
    }),
    pair: (start, end) => ({
      input: asJson(start?.payload),
      output: asJson(end?.exchanges),
      attrs: [
        ["kind", end?.kind ?? start?.kind],
        ["tool_use_id", end?.tool_use_id ?? start?.tool_use_id],
      ],
    }),
  }),
  [UI_ASK_ANSWERED]: spec<UIAskAnsweredData>({
    title: (d) => (d.kind ? `ui ask: ${d.kind}` : "ui ask"),
    point: (d) => ({
      output: asJson(d?.exchanges),
      attrs: [
        ["kind", d?.kind],
        ["tool_use_id", d?.tool_use_id],
      ],
    }),
  }),
};

// ─── Resolution API (used by spanFactories) ─────────────────────────────────

export function categoryFor(eventType: string): TraceSpanCategory {
  return EVENT_SPECS[eventType]?.category ?? "event";
}

export function statusFor(paired: PairedEvent): TraceSpanStatus {
  if (paired.kind === "pair") {
    const pairStatus = EVENT_SPECS[paired.end.type]?.pairStatus as
      | ((start: unknown, end: unknown) => TraceSpanStatus)
      | undefined;
    return pairStatus
      ? pairStatus(paired.start.eventData, paired.end.eventData)
      : "success";
  }
  const event = paired.event;
  const status = EVENT_SPECS[event.type]?.status as
    | TraceSpanStatus
    | ((data: unknown) => TraceSpanStatus)
    | undefined;
  if (typeof status === "string") return status;
  if (status) return status(event.eventData);
  return genericStatus(event.eventData);
}

export function titleFor(paired: PairedEvent): string {
  const event = paired.kind === "pair" ? paired.start : paired.event;
  const data = event.eventData as JsonObject | null;
  if (data) {
    const title = (
      EVENT_SPECS[event.type]?.title as
        | ((data: JsonObject) => string | undefined)
        | undefined
    )?.(data);
    if (title) return title;
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

export function extractSpanPayload(paired: PairedEvent): SpanPayload {
  const sourceEvent = paired.kind === "pair" ? paired.start : paired.event;
  const attrs: TraceSpanAttribute[] = [];
  pushAttr(attrs, "trace_level", sourceEvent.traceLevel);
  pushAttr(attrs, "event_type", sourceEvent.type);
  pushAttr(attrs, "container_id", sourceEvent.containerId);
  // The request-snapshot renderer needs the envelope runId to fetch
  // /runs/:runId/turns/:n/context. Scoped to this event type so every other
  // span's attribute set (and the characterization snapshots) stay unchanged.
  if (sourceEvent.type === EventType.PI_REQUEST_SNAPSHOT) {
    pushAttr(attrs, "run_id", sourceEvent.runId);
  }

  let payload: Payload;
  if (paired.kind === "pair") {
    const pair = EVENT_SPECS[paired.start.type]?.pair as
      | ((start: unknown, end: unknown) => Payload)
      | undefined;
    payload = pair ? pair(paired.start.eventData, paired.end.eventData) : {};
  } else {
    const point = (EVENT_SPECS[paired.event.type]?.point ?? genericPoint) as (
      data: unknown,
    ) => Payload;
    payload = point(paired.event.eventData);
  }

  for (const [key, value] of payload.attrs ?? []) pushAttr(attrs, key, value);

  const result: SpanPayload = {};
  if (payload.input !== undefined) result.input = payload.input;
  if (payload.output !== undefined) result.output = payload.output;
  if (attrs.length > 0) result.attributes = attrs;
  return result;
}
