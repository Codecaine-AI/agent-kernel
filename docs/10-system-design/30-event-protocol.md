---
covers: "Event protocol design: TraceEvent envelope, core event types, trace levels, sources, and app extension behavior."
concepts: [event-protocol, trace-event, event-type, trace-level, trace-source, app-events]
code-ref: packages/protocol/src/envelope.ts, packages/protocol/src/types.ts, packages/protocol/src/factories.ts
depends-on: [20-observability-model.md]
---

# Event Protocol

`@agent-kernel/protocol` defines the event contract shared by the runtime, DB helpers, tailer, read API, and viewer packages.

---

## Envelope

Every trace event has the same envelope:

```ts
interface TraceEvent {
  eventId: string;
  appSessionId: string;
  containerId?: string;
  userId: string;
  type: EventType;
  source: TraceSource;
  agentId?: string;
  traceLevel: TraceLevel;
  eventData: EventData;
  spanId?: string;
  parentEventId?: string;
  timestamp: string;
  piSessionUuid?: string;
}
```

`piSessionUuid` is transport-only. The tailer or write helper resolves it to persisted Pi session identity.

## Core Event Families

The core catalog covers:

- agent lifecycle: `agent_session_*`, `agent_run_*`
- Pi lifecycle: `pi_agent_*`, `pi_turn_*`
- spawn lifecycle: `system_prompt_resolved`, `context_build_*`
- conversation: `user_message`, `assistant_message`
- tools: `tool_call_*`, `pre_tool_hook`, `post_tool_hook`
- grouping: `phase_*`, `container_*`
- diagnostics: `error`, `warning`

The protocol currently also includes UI ask event names because they existed before the split. Those are a promotion candidate. Spectre's durable ask storage and payload semantics remain app-side until the generic human-in-the-loop contract is finalized.

## Open Strings

`EventType` and `TraceSource` are open string unions. That lets apps register or pass through app-specific event types without blocking storage, tailing, streaming, or generic viewing.

Unknown event types should still flow end to end and render as generic trace rows.

## Trace Levels

Trace levels are viewer filtering hints:

| Level | Name | Purpose |
|---|---|---|
| 0 | Summary | User-visible conversation |
| 1 | Processing | Main execution and tool activity |
| 2 | Debug | Lifecycle, grouping, warnings, errors |
| 3 | Internal | Pi internals and high-volume details |

The kernel assigns levels through protocol factories. Apps may use the same convention for custom events.
