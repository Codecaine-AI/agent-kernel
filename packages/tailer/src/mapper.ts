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
  newEventId,
  SYSTEM_USER_ID,
  TraceLevel,
} from "@agent-kernel/protocol";
import type { TraceEvent } from "@agent-kernel/protocol";
import type { MapperResult, PiEvent, PiMessageEvent } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventMapperSessionBindingOptions {
  customType: string;
  appSessionIdField?: string;
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

export class EventMapper {
  private readonly options: Required<Omit<EventMapperOptions, "sessionBinding">> &
    Pick<EventMapperOptions, "sessionBinding">;
  private model = "unknown";
  private appSessionId: string | null = null;
  private piSessionUuid: string | null = null;
  private pending: TraceEvent[] = [];
  private pendingSince: number | null = null;
  private lastActivityAt = Date.now();
  private markedCompleted = false;

  constructor(options: EventMapperOptions = {}) {
    this.options = {
      ...DEFAULT_MAPPER_OPTIONS,
      ...options,
    };
  }

  private asAgentEvent(evt: TraceEvent, timestamp: string): TraceEvent {
    return {
      ...evt,
      source: "agent",
      timestamp,
      piSessionUuid: this.piSessionUuid ?? undefined,
    };
  }

  setAppSessionId(id: string): TraceEvent[] {
    if (!UUID_RE.test(id)) {
      console.error(`[mapper] setAppSessionId rejected non-uuid: ${id}`);
      return [];
    }
    this.appSessionId = id;
    const piUuid = this.piSessionUuid ?? undefined;
    const flushed = this.pending.map((e) => ({
      ...e,
      appSessionId: id,
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

  hasAppSessionId(): boolean {
    return this.appSessionId !== null;
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

  getAppSessionId(): string | null {
    return this.appSessionId;
  }

  getModel(): string {
    return this.model;
  }

  idleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  isCompletable(): boolean {
    return this.appSessionId !== null && !this.markedCompleted;
  }

  markCompleted(): void {
    this.markedCompleted = true;
  }

  map(event: PiEvent): MapperResult {
    this.lastActivityAt = Date.now();
    switch (event.type) {
      case "session":
        this.setPiSessionUuid(event.id);
        return this.gate({
          traceEvents: [
            this.asAgentEvent(
              createAgentSessionStartEvent(
                this.stampId(),
                SYSTEM_USER_ID,
                "pi-agent",
                this.model,
              ),
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

  private stampId(): string {
    return this.appSessionId ?? "";
  }

  private gate(result: MapperResult): MapperResult {
    if (this.appSessionId !== null) return result;
    if (result.traceEvents.length > 0) {
      this.pending.push(...result.traceEvents);
      this.pendingSince ??= Date.now();
    }
    return { traceEvents: [], metadata: result.metadata };
  }

  private mapMessage(event: PiMessageEvent, timestamp: string): MapperResult {
    const results: TraceEvent[] = [];
    const { role, content } = event.message;
    const sid = this.stampId();

    if (role === "toolResult") {
      const toolName = event.message.toolName ?? "unknown";
      const toolCallId = event.message.toolCallId ?? "unknown";
      const output = content
        ?.map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .slice(0, 10000);
      results.push(
        this.asAgentEvent(
          createToolCallEndEvent(sid, SYSTEM_USER_ID, toolName, toolCallId, {
            toolOutput: output || undefined,
            spanId: toolCallId,
          }),
          timestamp,
        ),
      );
      return { traceEvents: results };
    }

    for (const block of content) {
      if (role === "user" && block.type === "text") {
        results.push(
          this.asAgentEvent(
            createUserMessageEvent(sid, SYSTEM_USER_ID, block.text, "unknown"),
            timestamp,
          ),
        );
      }

      if (role === "assistant" && block.type === "text") {
        results.push(
          this.asAgentEvent(
            createAssistantMessageEvent(sid, SYSTEM_USER_ID, block.text, "text"),
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
            createToolCallStartEvent(sid, SYSTEM_USER_ID, block.name, block.id, {
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
      const appSessionId = event.data[binding.appSessionIdField ?? "appSessionId"] as
        | string
        | undefined;
      const slug = event.data[binding.slugField ?? "appSessionSlug"] as string | undefined;
      const dir = event.data[binding.dirField ?? "appSessionDir"] as string | undefined;
      const flushed = appSessionId ? this.setAppSessionId(appSessionId) : [];

      return {
        traceEvents: flushed,
        metadata: {
          appSession: {
            appSessionId,
            slug,
            dir,
            customType: event.customType,
            raw: event.data,
          },
        },
      };
    }

    if (event.customType === this.options.lifecycleCustomType) {
      return this.gate({ traceEvents: this.mapPiLifecycle(event, event.timestamp) });
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
            eventId: newEventId(),
            appSessionId: this.stampId(),
            userId: SYSTEM_USER_ID,
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
  ): TraceEvent[] {
    const sid = this.stampId();
    const phase = event.data.phase as string | undefined;
    switch (phase) {
      case "agent_start":
        return [this.asAgentEvent(createPiAgentStartEvent(sid, SYSTEM_USER_ID), timestamp)];
      case "agent_end":
        return [
          this.asAgentEvent(
            createPiAgentEndEvent(sid, SYSTEM_USER_ID, "ok", {
              inputTokens: event.data.inputTokens as number | undefined,
              outputTokens: event.data.outputTokens as number | undefined,
            }),
            timestamp,
          ),
        ];
      case "turn_start":
        return [
          this.asAgentEvent(
            createPiTurnStartEvent(sid, SYSTEM_USER_ID, {
              turnNumber: event.data.turnIndex as number | undefined,
            }),
            timestamp,
          ),
        ];
      case "turn_end":
        return [
          this.asAgentEvent(
            createPiTurnEndEvent(sid, SYSTEM_USER_ID, {
              turnNumber: event.data.turnIndex as number | undefined,
              stopReason: event.data.stopReason as string | undefined,
            }),
            timestamp,
          ),
        ];
      default:
        return [];
    }
  }
}
