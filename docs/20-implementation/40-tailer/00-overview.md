---
covers: "Implementation of @agent-kernel/tailer: Pi JSONL mapping, session binding, lifecycle custom events, cursoring, queueing, file reading, directory watching, backpressure, and health."
type: overview
concepts: [tailer, jsonl, event-mapper, cursor-store, event-queue, file-reader, directory-watcher, health]
code-ref: packages/tailer/src/
depends-on: [../../10-system-design/20-observability-model.md, ../10-protocol/00-overview.md]
---

# Tailer Package

`@agent-kernel/tailer` contains reusable Pi JSONL ingestion primitives. A host app wraps these primitives with DB inserts, watch paths, and app-specific marker names.

---

## Components

| Component | Purpose |
|---|---|
| `createTailerConfig` | Normalizes watch path, cursor path, batch sizes, retry limits, and health port |
| `EventMapper` | Maps Pi JSONL events to protocol `TraceEvent`s |
| `EventQueue` | Batches trace events and retries failed inserts |
| `CursorStore` | Tracks byte offsets and writes crash-recovery snapshots |
| `FileReader` | Reads appended JSONL lines from a file |
| `DirectoryWatcher` | Watches a directory tree and manages readers |
| health route | Exposes queue, reader, pressure, DB, and uptime state |

## Event Mapping

The mapper understands Pi events such as:

- `session`
- `message`
- `model_change`
- `custom`
- skipped informational events

It emits protocol events for user messages, assistant messages, tool call starts/ends, agent session starts, and lifecycle custom events.

## Session Binding

Pi JSONL starts with Pi's own session id. The kernel mapper can hold events until it sees an app session binding marker. Once an app session id is known, pending events are stamped and released.

The marker name and field names are configurable through `EventMapperOptions.sessionBinding`. Spectre can use its compatibility marker while new apps can use kernel-native marker names.

## Lifecycle Custom Events

The mapper defaults to:

- `agent-kernel:pi-lifecycle`
- `agent-kernel:subagent-link`

Apps may override these to support existing JSONL streams.

## Backpressure And Recovery

The queue has a bounded capacity. When full, callers can pause reading and resume once the queue drains.

Cursor snapshots let the tailer recover from process restarts. Re-read overlap is expected and handled by idempotent event insertion on the app side.
