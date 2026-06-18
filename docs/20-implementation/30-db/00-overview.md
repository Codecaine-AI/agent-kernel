---
covers: "Implementation of @agent-kernel/db: Drizzle schema and query helpers for kernel registrations, containers, Pi agent sessions, agent runs, trace events, bootstrap, and kernel trace reads."
type: overview
concepts: [db, drizzle, kernel-registration, containers, pi-agent-sessions, agent-runs, trace-events, bootstrap, read-api-helpers]
code-ref: packages/db/src/schema/, packages/db/src/actions/
depends-on: [../../10-system-design/20-observability-model.md]
---

# Database Package

`@agent-kernel/db` owns the kernel observability schema and server-side query helpers. Apps compose these table definitions into their own Drizzle setup.

---

## Schema

| Table | Purpose |
|---|---|
| `kernel_registrations` | Host-kernel discovery row for shared local infrastructure |
| `containers` | Generic grouping unit for app work and viewer navigation |
| `pi_agent_sessions` | Pi SDK session identity, parent Pi session linkage, agent status, model, phase/container labels |
| `agent_runs` | One run inside a Pi session, including agent, container, phase, parent run, status, and parent tool call |
| `trace_events` | Event stream rows typed by the protocol envelope |

## Kernel Registrations

Each host app can upsert one `kernel_registrations` row on startup. The row tells shared infrastructure which Pi sessions directory to watch and tells viewers where to link back into the app.

Use `upsertKernelRegistration(db, data)` with:

- `kernelId`
- `displayName`
- `workingDir`
- `piSessionsDir`
- app/generic trace URL templates
- marker names for session binding, lifecycle, and subagent links

## Containers

Containers are the kernel's portable grouping primitive. They carry label, status, parent container, working paths, phase label, phase vocabulary, metadata, and timestamps.

Apps can map their domain work units to containers without the kernel learning app workflow semantics.

## Pi Agent Sessions

Pi agent sessions track the durable Pi conversation identity for each agent. The table stores parent-child relationships, app-session correlation, container/phase labels, display labels, agent names, status, model, and timestamps.

## Agent Runs

An agent run represents one processing loop. Runs link to Pi sessions and carry explicit structural fields such as `agentName`, `containerId`, `phase`, `parentRunId`, `displayLabel`, and `parentToolUseId`.

## Trace Events

Trace events store the protocol envelope as DB rows. The `type` and `source` columns are open strings so app-specific events can pass through.

`insertTraceEventsBatch()` is idempotent by event id. This lets tailer retry/replay paths tolerate overlap.

## Bootstrap

`ensureKernelObservabilitySchema(db)` creates the current Postgres schema and indexes when a host app does not yet have a migration path. It is used by `examples/simple-research-kernel` and is intentionally small: production apps should still fold the exported Drizzle schema into their own migrations once contracts settle.

## Read Helpers

`actions/read-api.ts` provides:

- `listContainerTree(db, rootContainerId)`
- `getKernelTraceReadRows(db, identity, opts)`

These are lower-level helpers used by app-mounted read API adapters. They prefer container identity and use app-session identity as a compatibility bridge when supplied.
