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
  type CallEndData,
  type CallStartData,
  type ContextBuildCompletedData,
  type ContextBuildStartedData,
  type ContextInputResolvedData,
  type DecisionMadeData,
  type ErrorData,
  type GateEndData,
  type GateStartData,
  type PhaseEndData,
  type PhaseStartData,
  type PiRequestSnapshotData,
  type PiTurnEndData,
  type PostToolHookData,
  type PreToolHookData,
  type StepEndData,
  type StepStartData,
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

/** JSON-encode a non-empty array; malformed and empty values are omitted. */
function asNonEmptyArrayJson(value: unknown): string | undefined {
  return Array.isArray(value) && value.length > 0
    ? JSON.stringify(value)
    : undefined;
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

// ─── Nested tool calls ──────────────────────────────────────────────────────
// Calls a codemode script makes carry their immediate parent's tool_use_id;
// the nesting pass moves them under that tool span. Absent on top-level tools,
// so these attributes add nothing there.

type NestedToolData = { parent_tool_use_id?: string; nested_status?: string };

function nestedToolAttrs(
  start: NestedToolData | null,
  end: NestedToolData | null,
): AttrEntry[] {
  return [
    ["parent_tool_use_id", start?.parent_tool_use_id ?? end?.parent_tool_use_id],
    ["nested_status", end?.nested_status],
  ];
}

// ─── Model nodes ────────────────────────────────────────────────────────────
// call_start/call_end bracket one call or decision run; decision_made records
// the decision's answers. Steps and gates are spans on their parent run. The
// node-row builder (model-nodes.ts) absorbs a node run's lifecycle events, so
// these entries mostly show when a node event renders as a plain span.

/** call_end.status → span status: ok → success, error → error, aborted → warning. */
export function callEndStatus(status: string | null | undefined): TraceSpanStatus {
  if (status === "error") return "error";
  if (status === "aborted") return "warning";
  return "success";
}

/** step_end → span status: an error or a failed check is an error, an abstained check a warning. */
export function stepEndStatus(data: StepEndData | null): TraceSpanStatus {
  if (data?.status === "error" || data?.check_result === "fail") return "error";
  if (data?.check_result === "abstain") return "warning";
  return "success";
}

/** Gate verdict → span status: pass → success, fail → error, abstain → warning. */
export function gateVerdictStatus(verdict: string | null | undefined): TraceSpanStatus {
  if (verdict === "fail") return "error";
  if (verdict === "abstain") return "warning";
  return "success";
}

function callStartAttrs(d: CallStartData | null): AttrEntry[] {
  return [
    ["run_id", d?.run_id],
    ["node_kind", d?.node_kind],
    ["function_name", d?.function_name],
    ["engine", d?.engine],
    ["transport", d?.transport],
    ["model", d?.model],
    ["model_alias", d?.model_alias],
    ["provider", d?.provider],
    ["api", d?.api],
    ["prompt_hash", d?.prompt_hash],
    ["input_blob_hash", d?.input_blob_hash],
    ["trigger", d?.trigger],
    ["parent_run_id", d?.parent_run_id],
    ["parent_tool_use_id", d?.parent_tool_use_id],
    ["request_id", d?.request_id],
    ["attempt", d?.attempt],
    ["deadline_at", d?.deadline_at],
    ["gate_span_id", d?.gate_span_id],
  ];
}

function callEndAttrs(d: CallEndData | null): AttrEntry[] {
  return [
    ["status", d?.status],
    ["output_blob_hash", d?.output_blob_hash],
    ["error_kind", d?.error?.kind],
    ["error_message", d?.error?.message],
    ["http_status", d?.error?.http_status],
    ["attempts", d?.attempts],
    ["duration_ms", d?.duration_ms],
    ["resolved_model", d?.resolved_model],
    ["input_tokens", d?.usage?.inputTokens],
    ["output_tokens", d?.usage?.outputTokens],
    ["cache_read_tokens", d?.usage?.cacheReadTokens],
    ["cache_write_tokens", d?.usage?.cacheWriteTokens],
    ["cost_estimate", d?.usage?.costEstimate],
  ];
}

function decisionAttrs(d: DecisionMadeData | null): AttrEntry[] {
  return [
    ["run_id", d?.run_id],
    ["decision_name", d?.decision_name],
    ["chosen", d?.chosen],
    ["abstained", d?.abstained],
    ["abstain_reason", d?.abstain_reason],
    ["confidence_source", d?.confidence_source],
    ["engine", d?.engine],
    ["provider", d?.provider],
    ["api", d?.api],
    ["model", d?.model],
    ["requested_model", d?.requested_model],
    ["error_kind", d?.error_kind],
    ["gate_span_id", d?.gate_span_id],
  ];
}

/** Step attributes from start and end, end winning on a shared key; JSON, or absent when empty. */
function stepAttributesJson(
  start: StepStartData | null,
  end: StepEndData | null,
): string | undefined {
  const merged = { ...start?.attributes, ...end?.attributes };
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined;
}

function stepEndAttrs(d: StepEndData | null): AttrEntry[] {
  return [
    ["status", d?.status],
    ["duration_ms", d?.duration_ms],
    ["check_result", d?.check_result],
    ["check_value", d?.check_value],
    ["error_message", d?.error_message],
    ["step_events", asNonEmptyArrayJson(d?.events)],
  ];
}

function gateEndAttrs(d: GateEndData | null): AttrEntry[] {
  return [
    ["verdict", d?.verdict],
    ["aborted", d?.aborted === true ? true : undefined],
    ["duration_ms", d?.duration_ms],
  ];
}

/**
 * Step and gate spans carry their envelope span id (gate folding matches a
 * check's gate_span_id against it) and their envelope run id (they attach to
 * that run). Other event types never get these two attributes from here.
 */
const RUN_SCOPED_SPAN_EVENT_TYPES = new Set<string>([
  EventType.STEP_START,
  EventType.STEP_END,
  EventType.GATE_START,
  EventType.GATE_END,
]);

// ─── App event payloads ─────────────────────────────────────────────────────

/**
 * "app:board-render" — a host-published full-board raster taken at the end of
 * one agent turn. The payload references the PNG by content hash; the
 * detail-panel renderer fetches it from the blob route on selection.
 */
interface AppBoardRenderData {
  blob_hash?: string;
  mimeType?: string;
  byte_length?: number;
  /** Applied-change ordinal of the rendered board. */
  n?: number;
  /** Gesture summary that produced this board. */
  summary?: string;
  /** 1-based end-of-turn hook count. */
  turn?: number;
  /** 0-based pi turn numbering, aligned with pi_request_snapshot. */
  turn_number?: number;
}

// ─── The registry ────────────────────────────────────────────────────────────

const EVENT_SPECS: Record<string, EventSpec> = {
  "app:board-render": spec<AppBoardRenderData>({
    title: (d) => (typeof d.n === "number" ? `board render #${d.n}` : "board render"),
    point: (d) => ({
      attrs: [
        ["blob_hash", d?.blob_hash],
        ["mime_type", d?.mimeType],
        ["byte_length", d?.byte_length],
        ["n", d?.n],
        ["summary", d?.summary],
        ["turn", d?.turn],
        ["turn_number", d?.turn_number],
      ],
    }),
  }),
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
        ["resolved_inputs", asNonEmptyArrayJson(end?.inputs)],
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
        ["resolved_inputs", asNonEmptyArrayJson(d?.inputs)],
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
  [EventType.PI_TURN_START]: spec<{ turn_number?: number }>({
    title: (d) =>
      typeof d.turn_number === "number" ? `turn ${d.turn_number} start` : undefined,
    point: (d) => ({
      attrs: [
        [
          "turn_number",
          typeof d?.turn_number === "number" ? d.turn_number : undefined,
        ],
      ],
    }),
  }),
  [EventType.PI_TURN_END]: spec<PiTurnEndData>({
    point: (d) => ({
      attrs: [
        ["turn_number", d?.turn_number],
        ["stop_reason", d?.stop_reason],
        ["input_tokens", d?.usage?.inputTokens],
        ["output_tokens", d?.usage?.outputTokens],
        ["cache_read_tokens", d?.usage?.cacheReadTokens],
        ["cache_write_tokens", d?.usage?.cacheWriteTokens],
        ["model", d?.usage?.model],
        ["cost_estimate", d?.usage?.costEstimate],
      ],
    }),
  }),
  [EventType.PI_REQUEST_SNAPSHOT]: spec<PiRequestSnapshotData>({
    category: "llm_call",
    // Display name is just the turn — the pi_request_snapshot event type in
    // the detail header carries the technical identity. Built at render time
    // from event data (titles are not stored), so old traces pick this up too.
    title: (d) => `Turn ${d.turn_number}`,
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
        // Tool roster for this request. Both fields are absent (no attribute)
        // whenever the roster was not captured — including every snapshot
        // written before tool capture existed — and absence must never be read
        // as "zero tools". A captured empty roster does emit tool_count 0.
        ["tools_blob_hash", d?.tools_blob_hash],
        ["tool_count", d?.tool_count],
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
        ...nestedToolAttrs(d, null),
      ],
    }),
    pair: (start, end) => ({
      input: asJson(start?.tool_input),
      output: asText(end?.tool_output),
      attrs: [
        ["tool_name", start?.tool_name ?? end?.tool_name],
        ["tool_use_id", start?.tool_use_id ?? end?.tool_use_id],
        ["duration_ms", end?.duration_ms],
        ["is_error", end?.is_error === true ? true : undefined],
        ...spawnerAttrs(start ?? end),
        ...nestedToolAttrs(start, end),
      ],
    }),
  }),
  [EventType.TOOL_CALL_END]: spec<ToolCallEndData, ToolCallEndData>({
    category: "tool_execution",
    title: (d) => (isSpawner(d) ? spawnerTitle(d) : d.tool_name),
    status: (d) => (d?.is_error === true ? "error" : "success"),
    point: (d) => ({
      output: asText(d?.tool_output),
      attrs: [
        ["tool_name", d?.tool_name],
        ["tool_use_id", d?.tool_use_id],
        ["duration_ms", d?.duration_ms],
        ["is_error", d?.is_error === true ? true : undefined],
        ...spawnerAttrs(d),
        ...nestedToolAttrs(null, d),
      ],
    }),
    pairStatus: (_start, end) =>
      end?.is_error === true ? "error" : "success",
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
  [EventType.CALL_START]: spec<CallStartData, CallEndData>({
    category: "llm_call",
    title: (d) => d.display_label ?? d.function_name,
    status: "pending",
    point: (d) => ({ attrs: callStartAttrs(d) }),
    pair: (start, end) => ({
      attrs: [...callStartAttrs(start), ...callEndAttrs(end)],
    }),
  }),
  [EventType.CALL_END]: spec<CallEndData, CallEndData>({
    category: "llm_call",
    title: (d) => d.function_name,
    status: (d) => callEndStatus(d?.status),
    point: (d) => ({
      attrs: [
        ["run_id", d?.run_id],
        ["node_kind", d?.node_kind],
        ["function_name", d?.function_name],
        ["gate_span_id", d?.gate_span_id],
        ...callEndAttrs(d),
      ],
    }),
    pairStatus: (_start, end) => callEndStatus(end?.status),
  }),
  [EventType.DECISION_MADE]: spec<DecisionMadeData>({
    category: "llm_call",
    title: (d) => d.decision_name,
    status: (d) => (d?.abstained === true ? "warning" : "success"),
    point: (d) => ({ output: asJson(d), attrs: decisionAttrs(d) }),
  }),
  [EventType.STEP_START]: spec<StepStartData, StepEndData>({
    category: "chain_operation",
    title: (d) => d.step_name,
    status: "pending",
    point: (d) => ({
      attrs: [
        ["step_name", d?.step_name],
        ["gate_span_id", d?.gate_span_id],
        ["step_attributes", stepAttributesJson(d, null)],
      ],
    }),
    pair: (start, end) => ({
      output: asJson(end?.output_summary),
      attrs: [
        ["step_name", start?.step_name ?? end?.step_name],
        ["gate_span_id", start?.gate_span_id ?? end?.gate_span_id],
        ...stepEndAttrs(end),
        ["step_attributes", stepAttributesJson(start, end)],
      ],
    }),
  }),
  [EventType.STEP_END]: spec<StepEndData, StepEndData>({
    category: "chain_operation",
    title: (d) => d.step_name,
    status: (d) => stepEndStatus(d),
    point: (d) => ({
      output: asJson(d?.output_summary),
      attrs: [
        ["step_name", d?.step_name],
        ["gate_span_id", d?.gate_span_id],
        ...stepEndAttrs(d),
        ["step_attributes", stepAttributesJson(null, d)],
      ],
    }),
    pairStatus: (_start, end) => stepEndStatus(end),
  }),
  [EventType.GATE_START]: spec<GateStartData, GateEndData>({
    category: "guardrail",
    title: (d) => d.gate_name,
    status: "pending",
    point: (d) => ({
      input: asNonEmptyArrayJson(d?.checks),
      attrs: [
        ["gate_name", d?.gate_name],
        ["check_count", d?.checks?.length],
      ],
    }),
    pair: (start, end) => ({
      input: asNonEmptyArrayJson(start?.checks),
      output: asNonEmptyArrayJson(end?.checks),
      attrs: [
        ["gate_name", start?.gate_name ?? end?.gate_name],
        ["check_count", start?.checks?.length],
        ...gateEndAttrs(end),
      ],
    }),
  }),
  [EventType.GATE_END]: spec<GateEndData, GateEndData>({
    category: "guardrail",
    title: (d) => d.gate_name,
    status: (d) => gateVerdictStatus(d?.verdict),
    point: (d) => ({
      output: asNonEmptyArrayJson(d?.checks),
      attrs: [["gate_name", d?.gate_name], ...gateEndAttrs(d)],
    }),
    pairStatus: (_start, end) => gateVerdictStatus(end?.verdict),
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
  if (RUN_SCOPED_SPAN_EVENT_TYPES.has(sourceEvent.type)) {
    const dataRunId = (sourceEvent.eventData as { run_id?: unknown } | null)?.run_id;
    pushAttr(attrs, "span_id", sourceEvent.spanId);
    pushAttr(
      attrs,
      "run_id",
      sourceEvent.runId ?? (typeof dataRunId === "string" ? dataRunId : undefined),
    );
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
