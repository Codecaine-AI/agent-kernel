---
covers: "Implementation of @agent-kernel/tailer as a backfill/import tool: Pi JSONL mapping, session binding, deterministic event ids, emitter id parity, runBackfill, and the CLI."
type: overview
concepts: [tailer, backfill, jsonl, event-mapper, deterministic-ids, session-binding, idempotent-insert]
code-ref: packages/tailer/src/backfill.ts, packages/tailer/src/mapper.ts, packages/tailer/src/backfill-cli.ts
depends-on: [../../10-system-design/20-observability-model.md, ../10-protocol/00-overview.md]
---

# Tailer Package

`@agent-kernel/tailer` is a backfill/import tool, not a daemon. The primary trace path is the kernel's in-process emitter; this package reads complete Pi JSONL transcripts and imports them into a kernel trace database for crash recovery and for sessions that ran outside the kernel.

The old daemon posture — directory watcher loop, cursor snapshots, health port, registration-row discovery — is gone.

---

## Components

| Component | Purpose |
|---|---|
| `runBackfill(options)` | Scans a JSONL directory (or explicit file list), maps whole files, batch-inserts idempotently, returns a summary |
| `EventMapper` | Maps Pi JSONL entries to protocol `TraceEvent`s |
| `readJsonlFile` | Reads and parses one JSONL transcript |
| `createTailerConfig` | Normalizes batch size and retry limits |
| `backfill-cli.ts` | CLI entry over `runBackfill` |

## Event Mapping

The mapper understands Pi entries such as `session`, `message`, `model_change`, and `custom`, and emits protocol events for user messages, assistant messages, tool call starts/ends, agent session starts, turn boundaries with `TurnUsage`, and lifecycle custom events.

## Deterministic Ids And Emitter Parity

Event ids are derived deterministically from `(piSessionUuid, JSONL entry id, ordinal, type)` via the shared `piEntryEventId` helper in `@agent-kernel/protocol`. The kernel's in-process emitter derives the identical ids at emit time, so live emission followed by a backfill of the same session produces the same id set — `insertTraceEventsBatch` is `INSERT OR IGNORE` on `event_id`, and replays insert zero new rows. The backfill summary reports mapped, inserted, and skipped (already present) counts.

## Session Binding

Pi JSONL starts with Pi's own session id. Envelope identity — required `containerId` and optional `runId` — arrives through the session-binding marker the kernel's spawn pipeline writes into every transcript. The mapper holds events pending until it sees the marker, then stamps and releases them.

Marker and lifecycle custom types are configurable through `EventMapperOptions`; the kernel defaults are `agent-kernel:session-binding`, `agent-kernel:pi-lifecycle`, and `agent-kernel:subagent-link`.

## CLI Usage

```bash
bun run packages/tailer/src/backfill-cli.ts <jsonl-dir> --db <db-path> \
  [--batch-size <n>] [--binding-type <t>] [--lifecycle-type <t>] [--subagent-type <t>]
```

The CLI opens the database (ensuring the schema), scans the directory recursively for `.jsonl` files, and prints the backfill summary. `runBackfill` also accepts an already-open `db` handle for embedding — the example app mounts it behind a dev `/api/backfill` endpoint.
