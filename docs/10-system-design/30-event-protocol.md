---
covers: "Event protocol design: TraceEvent envelope, core event types, trace levels, sources, deterministic event ids, and app extension behavior."
concepts: [event-protocol, trace-event, event-type, trace-level, trace-source, deterministic-ids, turn-usage, app-events]
code-ref: packages/protocol/src/envelope.ts, packages/protocol/src/types.ts, packages/protocol/src/factories.ts, packages/protocol/src/ids.ts, packages/protocol/src/usage.ts
depends-on: [20-observability-model.md, 15-identity-model.md]
---

# Event Protocol

`@agent-kernel/protocol` defines the event contract shared by the runtime, DB helpers, transcript recovery, read API, and viewer packages.

---

## Envelope

Every trace event has the same envelope:

```ts
interface TraceEvent {
  eventId: string;
  /** Required — the primary grouping identity (container kind + key tree). */
  containerId: string;
  type: EventType;
  source: TraceSource;
  traceLevel: TraceLevel;
  eventData: EventData;

  agentId?: string;
  /** Explicit run linkage — stamped at emit time when the run is known. */
  runId?: string;
  spanId?: string;
  parentEventId?: string;
  /** Optional actor correlation. */
  userId?: string;
  timestamp: string; // ISO 8601

  piSessionUuid?: string;
}
```

`containerId` is the single required grouping identity; there is no app-session field on the envelope. `runId` is on the envelope because the in-process emitter knows it at emit time — relationships are emitted, not reconstructed. `userId` is optional actor correlation only.

`piSessionUuid` is transport-only: the Pi session UUID from JSONL line 1, resolved to the persisted `pi_session_id` at write time and never stored directly on `trace_events`.

## Core Event Families

The core catalog covers:

- agent lifecycle: `agent_session_*`, `agent_run_*`, `run_steered`
- Pi lifecycle: `pi_agent_*`, `pi_turn_*`
- spawn lifecycle: `system_prompt_resolved`, `context_build_*`
- conversation: `user_message`, `assistant_message`
- tools: `tool_call_*`, `pre_tool_hook`, `post_tool_hook`
- grouping: `phase_*`, `container_*`
- diagnostics: `error`, `warning`

`run_steered` records a steering message injected into a running run — steering is a control action, and without the event it would be invisible in the trace. The old UI ask event types were removed from the core catalog; apps that need them re-register them as open-string types.

Usage rides on lifecycle payloads: `pi_turn_end.eventData.usage` carries per-model-call `TurnUsage` (input/output/cache tokens, resolved model, optional cost estimate), and `agent_run_end.eventData.usage` carries the run rollup. `system_prompt_resolved` carries the `prompt_hash` of the prompt revision the system prompt was rendered from.

## Deterministic Event Ids

`src/ids.ts` derives event ids deterministically so the two emission paths dedupe against each other. `piEntryEventId(piSessionUuid, entryId, ordinal, type)` is the shared seed layout used by both the kernel's in-process emitter and the transcript-recovery backfill mapper — live emission followed by a backfill of the same Pi session inserts zero duplicate rows (`trace_events` inserts are `INSERT OR IGNORE` on `event_id`). `liveFallbackEventId` is the documented fallback when a JSONL entry id cannot be observed at emit time: still deterministic, but it cannot match the backfill id for that entry.

## Open Strings

`EventType` and `TraceSource` are open string unions. That lets apps register or pass through app-specific event types without blocking storage, ingestion, streaming, or generic viewing.

Unknown event types should still flow end to end and render as generic trace rows.

## Factories

Factories in `src/factories.ts` follow one signature convention: identity comes first as a single `ids` parameter (`TraceEventIds` — `containerId` required; `runId`/`userId`/`agentId`/`piSessionUuid` optional), followed by the event's semantic arguments, followed by an optional `opts` object for span linkage and extras. Run lifecycle factories require `runId` on `ids`.

## Trace Levels

Trace levels are viewer filtering hints:

| Level | Name | Purpose |
|---|---|---|
| 0 | Summary | User-visible conversation |
| 1 | Processing | Main execution and tool activity |
| 2 | Debug | Lifecycle, grouping, warnings, errors |
| 3 | Internal | Pi internals and high-volume details |

The kernel assigns levels through protocol factories. Apps may use the same convention for custom events.
