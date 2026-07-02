---
covers: "Implementation of @agent-kernel/db: SQLite-first client and bootstrap, kernel manifest, Drizzle schema for containers, Pi agent sessions, agent runs, trace events, prompt revisions, usage rollups, the Postgres mirror, and container-first read helpers."
type: overview
concepts: [db, sqlite, drizzle, kernel-manifest, containers, pi-agent-sessions, agent-runs, trace-events, prompt-revisions, usage-rollups, bootstrap, read-api-helpers, pg-mirror]
code-ref: packages/db/src/client.ts, packages/db/src/manifest.ts, packages/db/src/bootstrap.ts, packages/db/src/schema/, packages/db/src/actions/
depends-on: [../../10-system-design/20-observability-model.md]
---

# Database Package

`@agent-kernel/db` owns the kernel observability storage: one local SQLite database per kernel, plus the schema, write actions, and container-first read helpers over it.

---

## Client And Manifest

`openKernelDatabase({ path })` opens (creating if needed) the kernel database — standard path `<root>/.agent-kernel/trace.db` via `kernelDatabasePath(rootDir)` — enables WAL mode so viewer reads never block the kernel writer, and returns a Drizzle handle plus `close()`. `KernelDatabase` is the Bun-SQLite Drizzle handle every action is typed against.

`writeKernelManifest(dir, manifest)` / `readKernelManifest(dir)` manage `<root>/.agent-kernel/kernel.json` — the local manifest that replaced the old `kernel_registrations` table. With one database per kernel there is no shared plane to register with; the manifest records `kernelId`, `displayName`, `piSessionsDir`, and an optional viewer link.

## Schema

| Table | Purpose |
|---|---|
| `containers` | The single grouping primitive: derived id, `kernel_id`, `kind`, `app_key` (JSON key segments, unique per kernel+kind), label, status, parent container, phase, working dir, metadata, usage rollup columns |
| `pi_agent_sessions` | Pi SDK session identity: container linkage, parent session + `parent_tool_use_id`, agent name, model, `prompt_hash`, status, usage rollups |
| `agent_runs` | One run inside a Pi session: session/container linkage, parent run, `trigger`, `inbound_event_id`/`outbound_event_id`, status, usage rollup columns |
| `trace_events` | Event stream rows typed by the protocol envelope (`container_id` required, `run_id` optional, open `type`/`source` strings) |
| `prompt_revisions` | Content-addressed prompt snapshots: `hash` (`pk1-<sha256>`) primary key, agent name, schema version, canonical document, rendered text, `source` (`registry-boot` \| `lab-save`) |

Usage rollup columns (`usage_input_tokens`, `usage_output_tokens`, `usage_cache_read`, `usage_cache_write`, `usage_cost_estimate`) live on runs and containers; sessions carry input/output totals. `actions/usage.ts` provides the additive increment helpers the emitter uses to fold turn usage into run, session, and container rows.

## Container Identity

Container ids are derived, never minted: `kernel.container({ kind, key })` in the kernel package computes `uuidv5` over `(kernelId, kind, key)` and calls `upsertContainer` here — the same inputs always resolve to the same row. Apps map their domain work units to containers through kind vocabulary without the kernel learning app workflow semantics.

## Trace Events

Trace events store the protocol envelope as rows. `insertTraceEventsBatch()` is idempotent by event id (`INSERT OR IGNORE`), which is what lets the in-process emitter and a later JSONL backfill of the same session coexist without duplicates.

## Bootstrap

`ensureKernelObservabilitySchema(db)` runs idempotent `CREATE TABLE IF NOT EXISTS` statements mirroring the Drizzle schema. There is no migration tooling: the schema is created on kernel start against the local `trace.db`.

## Postgres Mirror

`@agent-kernel/db/schema/pg` exports a Postgres mirror of the schema for shared-plane deployments — column names, row shapes, and constraints match SQLite (timestamps stay ISO-8601 TEXT). The caveat: the actions layer is SQLite-first and typed against the bun-sqlite handle; Postgres deployments query the mirrored tables directly until actions go dual-dialect. The mirror is exported only through the `schema/pg` subpath so the default entrypoint stays SQLite-only.

## Read Helpers

`actions/read-api.ts` is container-first — all reads are keyed by `containerId`, and there is no app-session identity in this package:

- `getKernelTraceReadRows(db, containerId, opts)` — one container subtree: root container, child containers, Pi sessions with event counts, runs, events
- `listSessionContainersWithStats(db, ...)` — containers of kind `"session"` with session/event stats for list views
- `deleteKernelTraceRows(db, containerId)` — cascade delete of one container subtree

These are the helpers behind the kernel's default `readApiService`.
