---
covers: "Implementation of @agent-kernel/protocol: TraceEvent envelope, trace sources, trace levels, event data types, open event catalog, and event factories."
type: overview
concepts: [protocol, trace-event, event-factory, trace-source, trace-level, event-data]
code-ref: packages/protocol/src/envelope.ts, packages/protocol/src/types.ts, packages/protocol/src/factories.ts
depends-on: [../../10-system-design/30-event-protocol.md]
---

# Protocol Package

`@agent-kernel/protocol` is the shared contract package. Runtime emitters, DB actions, transcript-recovery mapping, viewer DTOs, and apps all type against it.

---

## Files

| File | Purpose |
|---|---|
| `src/envelope.ts` | `TraceEvent`, `TraceSource`, and source constants |
| `src/types.ts` | trace levels, event type catalog, event data interfaces, `TurnUsage` |
| `src/factories.ts` | helpers that construct correctly shaped events (`TraceEventIds` first) |
| `src/ids.ts` | deterministic event-id derivation shared by emitter and backfill |
| `src/usage.ts` | `TurnUsage` extraction from Pi message usage |
| `src/index.ts` | public package export |

## Envelope Details

`TraceEvent` stores required kernel grouping (`containerId`), event identity, source, trace level, typed payload, timestamp, and optional run linkage (`runId`), actor correlation (`userId`), and span/parent ids. Host correlation happens through container kind + app key, not an envelope field.

`TraceSource` exposes kernel, app, and agent constants, but the type is open-string compatible so host apps can pass custom sources if needed.

## Event Types

`EventType` has known constants and remains open to app-specific strings.

Kernel-core event families include:

- agent and Pi lifecycle (including `run_steered` and per-turn usage)
- prompt and context build lifecycle
- conversation messages
- tool lifecycle
- phases and containers
- warnings and errors

UI ask event types were removed from the core catalog; apps that need them register them as open-string types, and ask storage remains app-side.

## Factory Use

Use protocol factories when kernel or app code emits standard events. Factories assign event ids, sources, timestamps, trace levels, and payload shapes consistently.

Unknown or app-specific event types can still be inserted and rendered generically when they follow the envelope.
