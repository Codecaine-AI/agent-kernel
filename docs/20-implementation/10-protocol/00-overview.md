---
covers: "Implementation of @agent-kernel/protocol: TraceEvent envelope, trace sources, trace levels, event data types, open event catalog, and event factories."
type: overview
concepts: [protocol, trace-event, event-factory, trace-source, trace-level, event-data]
code-ref: packages/protocol/src/envelope.ts, packages/protocol/src/types.ts, packages/protocol/src/factories.ts
depends-on: [../../10-system-design/30-event-protocol.md]
---

# Protocol Package

`@agent-kernel/protocol` is the shared contract package. Runtime emitters, DB actions, tailer mapping, viewer DTOs, and apps all type against it.

---

## Files

| File | Purpose |
|---|---|
| `src/envelope.ts` | `TraceEvent`, `TraceSource`, and source constants |
| `src/types.ts` | trace levels, event type catalog, event data interfaces |
| `src/factories.ts` | helpers that construct correctly shaped events |
| `src/index.ts` | public package export |

## Envelope Details

`TraceEvent` stores app correlation (`appSessionId`), optional kernel grouping (`containerId`), event identity, source, trace level, typed payload, timestamp, and optional span/parent ids.

`TraceSource` exposes kernel, app, and agent constants, but the type is open-string compatible so host apps can pass custom sources if needed.

## Event Types

`EventType` has known constants and remains open to app-specific strings.

Kernel-core event families include:

- agent and Pi lifecycle
- prompt and context build lifecycle
- conversation messages
- tool lifecycle
- phases and containers
- warnings and errors

The current package still includes UI ask event data because ask events existed before extraction. Spectre-specific ask storage remains app-side.

## Factory Use

Use protocol factories when kernel or app code emits standard events. Factories assign event ids, sources, timestamps, trace levels, and payload shapes consistently.

Unknown or app-specific event types can still be inserted and rendered generically when they follow the envelope.
