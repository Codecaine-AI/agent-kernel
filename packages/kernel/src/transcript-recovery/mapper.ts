/**
 * EventMapper — re-derives protocol TraceEvents from Pi JSONL transcripts.
 *
 * Recovery role: Pi's JSONL is the durable record of a session; this maps its
 * entries back into trace rows for disaster rebuild, importing externally-run
 * sessions, and schema re-derivation. It shares id derivation and usage
 * extraction with the live kernel emitter via @agent-kernel/protocol, so both
 * paths agree on event ids.
 *
 * Identity: `containerId` (required on the envelope) and optional `runId`
 * arrive through a session-binding marker written into the JSONL by the
 * kernel. Events mapped before the marker is seen are held pending and
 * stamped on release.
 *
 * Idempotency: event ids are derived deterministically from
 * (piSessionUuid, JSONL entry id, ordinal), so re-mapping the same file
 * always yields the same event ids and `INSERT OR IGNORE` de-duplicates.
 */
import {
  createAgentSessionStartEvent,
  createAssistantMessageEvent,
  createPiAgentEndEvent,
  createPiAgentStartEvent,
  createPiTurnEndEvent,
  createPiTurnStartEvent,
  createToolCallEndEvent,
  createToolCallStartEvent,
  createUserMessageEvent,
  deterministicEventId,
  piEntryEventId,
  turnUsageFromPiMessage,
  TraceLevel,
} from "@agent-kernel/protocol";
import type { TraceEvent, TraceEventIds, TurnUsage } from "@agent-kernel/protocol";
import type { MapperResult, PiEvent, PiMessage, PiMessageEvent } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventMapperSessionBindingOptions {
  customType: string;
  /** Field in the marker payload carrying the container id. Default: "containerId". */
  containerIdField?: string;
  /** Field in the marker payload carrying the run id. Default: "runId". */
  runIdField?: string;
  slugField?: string;
  dirField?: string;
}

export interface EventMapperOptions {
  sessionBinding?: EventMapperSessionBindingOptions;
  lifecycleCustomType?: string;
  subagentLinkCustomType?: string;
}

const DEFAULT_MAPPER_OPTIONS = Object.freeze({
  lifecycleCustomType: "agent-kernel:pi-lifecycle",
  subagentLinkCustomType: "agent-kernel:subagent-link",
} satisfies Required<Omit<EventMapperOptions, "sessionBinding">>);

/**
 * Deterministic UUID-shaped id from a seed string (sha-256 truncated).
 * Replaying the same JSONL entry always produces the same event id.
 * Re-exported from @agent-kernel/protocol — the kernel's in-process emitter
 * derives the same ids so live emission + backfill never duplicate rows.
 */
export { deterministicEventId };

interface EntryContext {
  entryId: string;
  ordinal: number;
}

export class EventMapper {
  private readonly options: Required<Omit<EventMapperOptions, "sessionBinding">> &
    Pick<EventMapperOptions, "sessionBinding">;
  private model = "unknown";
  private containerId: string | null = null;
  private runId: string | null = null;
  private piSessionUuid: string | null = null;
  private pending: TraceEvent[] = [];
  private pendingSince: number | null = null;
  private entry: EntryContext | null = null;
  /** Usage from the assistant message of the current turn, if any. */
  private currentTurnUsage: TurnUsage | null = null;
  /** Aggregate usage across all turns since agent_start. */
  private aggregateUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  constructor(options: EventMapperOptions = {}) {
    this.options = {
      ...DEFAULT_MAPPER_OPTIONS,
      ...options,
    };
  }

  private ids(): TraceEventIds {
    return {
      containerId: this.containerId ?? "",
      runId: this.runId ?? undefined,
      piSessionUuid: this.piSessionUuid ?? undefined,
    };
  }

  /**
   * Re-stamp a factory-built event as an agent-sourced backfill event:
   * JSONL timestamp, deterministic event id, current pi session uuid.
   */
  private asAgentEvent(evt: TraceEvent, timestamp: string): TraceEvent {
    const entry = this.entry;
    const ordinal = entry ? entry.ordinal++ : 0;
    return {
      ...evt,
      eventId: piEntryEventId(
        this.piSessionUuid ?? "",
        entry?.entryId ?? "",
        ordinal,
        String(evt.type),
      ),
      source: "agent",
      timestamp,
      piSessionUuid: this.piSessionUuid ?? undefined,
    };
  }

  /**
   * Bind container (and optionally run) identity, releasing any pending
   * events with the identity stamped on.
   */
  setContainerBinding(containerId: string, runId?: string): TraceEvent[] {
    if (!UUID_RE.test(containerId)) {
      console.error(`[mapper] setContainerBinding rejected non-uuid: ${containerId}`);
      return [];
    }
    this.containerId = containerId;
    this.runId = runId ?? this.runId;
    const piUuid = this.piSessionUuid ?? undefined;
    const flushed = this.pending.map((e) => ({
      ...e,
      containerId,
      runId: e.runId ?? runId,
      piSessionUuid: e.piSessionUuid ?? piUuid,
    }));
    this.pending = [];
    this.pendingSince = null;
    return flushed;
  }

  private setPiSessionUuid(uuid: string): void {
    if (!UUID_RE.test(uuid)) {
      console.error(`[mapper] setPiSessionUuid rejected non-uuid: ${uuid}`);
      return;
    }
    this.piSessionUuid = uuid;
  }

  hasContainerBinding(): boolean {
    return this.containerId !== null;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  pendingAgeMs(): number {
    return this.pendingSince ? Date.now() - this.pendingSince : 0;
  }

  getPiSessionUuid(): string | null {
    return this.piSessionUuid;
  }

  getContainerId(): string | null {
    return this.containerId;
  }

  getRunId(): string | null {
    return this.runId;
  }

  getModel(): string {
    return this.model;
  }

  map(event: PiEvent): MapperResult {
    this.entry = { entryId: event.id, ordinal: 0 };
    switch (event.type) {
      case "session":
        this.setPiSessionUuid(event.id);
        return this.gate({
          traceEvents: [
            this.asAgentEvent(
              createAgentSessionStartEvent(this.ids(), "pi-agent", this.model),
              event.timestamp,
            ),
          ],
          metadata: { piSessionUuid: event.id },
        });

      case "model_change":
        this.model = event.modelId;
        return { traceEvents: [] };

      case "message":
        return this.gate(this.mapMessage(event, event.timestamp));

      case "custom":
        return this.mapCustom(event);

      case "thinking_level_change":
      case "session_info":
      default:
        return { traceEvents: [] };
    }
  }

  /** Hold events until the container binding is known, then release stamped. */
  private gate(result: MapperResult): MapperResult {
    if (this.containerId !== null) return result;
    if (result.traceEvents.length > 0) {
      this.pending.push(...result.traceEvents);
      this.pendingSince ??= Date.now();
    }
    return { traceEvents: [], warnings: result.warnings, metadata: result.metadata };
  }

  private extractUsage(message: PiMessage): TurnUsage | null {
    return turnUsageFromPiMessage(message, this.model);
  }

  private mapMessage(event: PiMessageEvent, timestamp: string): MapperResult {
    const results: TraceEvent[] = [];
    const { role } = event.message;
    // Pi persists user prompts as either a plain string or content blocks;
    // normalize so string prompts still map to a user_message event.
    const rawContent = event.message.content as unknown;
    const content: PiMessage["content"] =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : (event.message.content ?? []);
    const ids = this.ids();

    if (role === "toolResult") {
      const toolName = event.message.toolName ?? "unknown";
      const toolCallId = event.message.toolCallId ?? "unknown";
      const output = content
        ?.map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .slice(0, 10000);
      results.push(
        this.asAgentEvent(
          createToolCallEndEvent(ids, toolName, toolCallId, {
            toolOutput: output || undefined,
            spanId: toolCallId,
          }),
          timestamp,
        ),
      );
      return { traceEvents: results };
    }

    if (role === "assistant") {
      const usage = this.extractUsage(event.message);
      if (usage) {
        this.currentTurnUsage = usage;
        this.aggregateUsage.input += usage.inputTokens;
        this.aggregateUsage.output += usage.outputTokens;
        this.aggregateUsage.cacheRead += usage.cacheReadTokens;
        this.aggregateUsage.cacheWrite += usage.cacheWriteTokens;
      }
    }

    for (const block of content) {
      if (role === "user" && block.type === "text") {
        results.push(
          this.asAgentEvent(
            createUserMessageEvent(ids, block.text, "unknown"),
            timestamp,
          ),
        );
      }

      if (role === "assistant" && block.type === "text") {
        results.push(
          this.asAgentEvent(
            createAssistantMessageEvent(ids, block.text, "text"),
            timestamp,
          ),
        );
      }

      if (role === "assistant" && block.type === "toolCall") {
        let toolInput: Record<string, unknown> | undefined;
        try {
          toolInput = JSON.parse(block.arguments);
        } catch {
          toolInput = { raw: block.arguments };
        }
        results.push(
          this.asAgentEvent(
            createToolCallStartEvent(ids, block.name, block.id, {
              toolInput,
              spanId: block.id,
            }),
            timestamp,
          ),
        );
      }
    }

    return { traceEvents: results };
  }

  private mapCustom(event: PiEvent & { type: "custom" }): MapperResult {
    const binding = this.options.sessionBinding;
    if (binding && event.customType === binding.customType) {
      const containerId = event.data[binding.containerIdField ?? "containerId"] as
        | string
        | undefined;
      const runId = event.data[binding.runIdField ?? "runId"] as string | undefined;
      const slug = event.data[binding.slugField ?? "appSessionSlug"] as string | undefined;
      const dir = event.data[binding.dirField ?? "appSessionDir"] as string | undefined;
      const flushed = containerId ? this.setContainerBinding(containerId, runId) : [];

      return {
        traceEvents: flushed,
        metadata: {
          containerBinding: {
            containerId,
            runId,
            slug,
            dir,
            customType: event.customType,
            raw: event.data,
          },
        },
      };
    }

    if (event.customType === this.options.lifecycleCustomType) {
      return this.gate(this.mapPiLifecycle(event, event.timestamp));
    }

    if (event.customType === this.options.subagentLinkCustomType) {
      return {
        traceEvents: [],
        metadata: {
          subagentLink: {
            parentPiSessionId: event.data.parentPiSessionId as string,
            childPiSessionId: event.data.childPiSessionId as string,
            toolCallId: event.data.toolCallId as string,
            agentType: event.data.agentType as string,
            description: event.data.description as string,
          },
        },
      };
    }

    return this.gate({
      traceEvents: [
        this.asAgentEvent(
          {
            eventId: "",
            containerId: this.containerId ?? "",
            runId: this.runId ?? undefined,
            type: "custom_event" as TraceEvent["type"],
            source: "agent",
            traceLevel: TraceLevel.PROCESSING as TraceEvent["traceLevel"],
            eventData: {
              custom_type: event.customType,
              data: event.data,
            } as TraceEvent["eventData"],
            timestamp: event.timestamp,
          },
          event.timestamp,
        ),
      ],
    });
  }

  private mapPiLifecycle(
    event: PiEvent & { type: "custom" },
    timestamp: string,
  ): MapperResult {
    const ids = this.ids();
    const phase = event.data.phase as string | undefined;
    switch (phase) {
      case "agent_start":
        this.currentTurnUsage = null;
        this.aggregateUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        return {
          traceEvents: [
            this.asAgentEvent(createPiAgentStartEvent(ids), timestamp),
          ],
        };
      case "agent_end": {
        // Prefer the aggregate of observed per-message usage; fall back to
        // the marker's own (last-message) token fields.
        const agg = this.aggregateUsage;
        const hasAggregate = agg.input > 0 || agg.output > 0;
        return {
          traceEvents: [
            this.asAgentEvent(
              createPiAgentEndEvent(ids, "ok", {
                inputTokens: hasAggregate
                  ? agg.input
                  : (event.data.inputTokens as number | undefined),
                outputTokens: hasAggregate
                  ? agg.output
                  : (event.data.outputTokens as number | undefined),
              }),
              timestamp,
            ),
          ],
        };
      }
      case "turn_start":
        this.currentTurnUsage = null;
        return {
          traceEvents: [
            this.asAgentEvent(
              createPiTurnStartEvent(ids, {
                turnNumber: event.data.turnIndex as number | undefined,
              }),
              timestamp,
            ),
          ],
        };
      case "turn_end": {
        const usage = this.currentTurnUsage;
        this.currentTurnUsage = null;
        const warnings = usage
          ? undefined
          : [
              `turn_end (turn ${String(event.data.turnIndex ?? "?")}) without observed assistant usage in pi session ${this.piSessionUuid ?? "unknown"}; usage omitted`,
            ];
        return {
          traceEvents: [
            this.asAgentEvent(
              createPiTurnEndEvent(ids, {
                turnNumber: event.data.turnIndex as number | undefined,
                stopReason: event.data.stopReason as string | undefined,
                ...(usage ? { usage } : {}),
              }),
              timestamp,
            ),
          ],
          warnings,
        };
      }
      default:
        return { traceEvents: [] };
    }
  }
}
