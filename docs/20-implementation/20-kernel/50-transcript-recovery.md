---
covers: "Transcript recovery (backfill) inside the kernel: re-deriving trace rows from Pi JSONL transcripts — mapper, session binding, deterministic event ids, emitter id parity, runBackfill, and the CLI."
concepts: [transcript-recovery, backfill, jsonl, event-mapper, deterministic-ids, session-binding, idempotent-insert]
code-ref: packages/kernel/src/transcript-recovery/
depends-on: [../10-protocol/00-overview.md, ../../10-system-design/20-observability-model.md]
---

# Transcript Recovery

`@agent-kernel/kernel/transcript-recovery` re-derives trace rows from Pi JSONL transcripts. It is a recovery/import tool, not a daemon: the primary trace path is the kernel's in-process emitter, and Pi's JSONL is the durable record this module reads back when the live rows are missing.

It lives inside the kernel package, co-located with the emitter it must stay in parity with. The two paths share id derivation and usage extraction through `@agent-kernel/protocol`.

Use it for:

- **Disaster rebuild** — reconstruct a trace database from the JSONL transcripts after loss or corruption.
- **Importing externally-run sessions** — bring sessions that ran outside the kernel into a kernel trace db.
- **Schema re-derivation** — re-map transcripts through updated event mapping.

The old daemon posture — directory watcher loop, cursor snapshots, health port, registration-row discovery — is gone.

---

## Components

| Component | Purpose |
|---|---|
| `runBackfill(options)` | Scans a JSONL directory (or explicit file list), maps whole files, batch-inserts idempotently, returns a summary |
| `EventMapper` | Re-derives protocol `TraceEvent`s from Pi JSONL entries |
| `readJsonlFile` | Reads and parses one JSONL transcript |
| `createRecoveryConfig` | Normalizes batch size |
| `backfill-cli.ts` | CLI entry over `runBackfill` (exposed as the `agent-kernel-backfill` bin) |

## Event Mapping

The mapper understands Pi entries such as `session`, `message`, `model_change`, and `custom`, and emits protocol events for user messages, assistant messages, tool call starts/ends, agent session starts, turn boundaries with `TurnUsage`, and lifecycle custom events.

## Deterministic Ids And Emitter Parity

Event ids are derived deterministically from `(piSessionUuid, JSONL entry id, ordinal, type)` via the shared `piEntryEventId` helper in `@agent-kernel/protocol`. The kernel's in-process emitter derives the identical ids at emit time, so live emission followed by a backfill of the same session produces the same id set — `insertTraceEventsBatch` is `INSERT OR IGNORE` on `event_id`, and replays insert zero new rows. The backfill summary reports mapped, inserted, and skipped (already present) counts.

Because the mapper now lives beside the emitter in the same package, the emitter's id-parity test imports `EventMapper` directly from `../transcript-recovery` — an intra-package drift guard that fails fast if the two paths diverge.

## Session Binding

Pi JSONL starts with Pi's own session id. Envelope identity — required `containerId` and optional `runId` — arrives through the session-binding marker the kernel's spawn pipeline writes into every transcript. The mapper holds events pending until it sees the marker, then stamps and releases them.

Marker and lifecycle custom types are configurable through `EventMapperOptions`; the kernel defaults are `agent-kernel:session-binding`, `agent-kernel:pi-lifecycle`, and `agent-kernel:subagent-link`.

## CLI Usage

```bash
bun run packages/kernel/src/transcript-recovery/backfill-cli.ts <jsonl-dir> --db <db-path> \
  [--batch-size <n>] [--binding-type <t>] [--lifecycle-type <t>] [--subagent-type <t>]
```

The CLI opens the database (ensuring the schema), scans the directory recursively for `.jsonl` files, and prints the backfill summary. `runBackfill` also accepts an already-open `db` handle for embedding — the example app mounts it behind a dev `/api/backfill` endpoint.
