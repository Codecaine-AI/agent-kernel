---
covers: "Observability model for containers, Pi agent sessions, agent runs, trace events, prompt revisions, usage rollups, explicit linkage rules, and the trace doctor."
concepts: [observability, containers, pi-agent-sessions, agent-runs, trace-events, prompt-revisions, explicit-linkage, usage-rollups, kernel-emitter, backfill, trace-doctor]
code-ref: packages/db/src/schema/, packages/db/src/actions/read-api.ts, packages/kernel/src/emitter/, packages/kernel/src/doctor.ts, packages/viewer-core/src/build-trace-spans.ts
depends-on: [../00-foundation/20-principles.md, 15-identity-model.md, 30-event-protocol.md]
---

# Observability Model

The kernel observability model answers a simple question: what work ran, where did it belong, who spawned it, what did it cost, and what happened inside it?

---

## Core Records

| Record | Meaning |
|---|---|
| Kernel manifest | Local JSON file (`.agent-kernel/kernel.json`) describing one kernel: id, display name, Pi sessions directory, viewer link. Replaces the old `kernel_registrations` table — with one SQLite database per kernel there is no shared plane to register with. |
| Container | The single grouping primitive. It has a deterministic id derived from `(kernelId, kind, key)`, a kind, an app key, label, status, optional parent container, phase label, phase vocabulary, working paths, metadata, and usage rollup columns. |
| Pi agent session | Pi SDK conversation identity for one agent session, including `prompt_hash` (the prompt revision frozen at session creation) and usage rollups. This is the durable link to JSONL-sourced events. |
| Agent run | One processing loop inside a Pi session: message in, response out. Carries trigger, inbound/outbound event refs, status, and usage rollups. |
| Trace event | Time-ordered event row for prompts, context, messages, tools, lifecycle, containers, phases, warnings, and errors. |
| Prompt revision | Content-addressed snapshot of one `prompt.json` (`pk1-<sha256>` hash, canonical document, rendered text, source). Sessions point at revisions through `prompt_hash`. |

## Identity Layers

Identity is container-first — see [15-identity-model.md](15-identity-model.md) for the full nesting and invariants.

`containerId` is the single required grouping identity on every event. There is no separate app-session identity: an app session is a container of `kind: "session"`, and host correlation happens through container kind + app key. `kernel.container({ kind, key })` derives the same id for the same inputs every time, so apps never mint or persist their own grouping ids.

`runId` identifies a kernel-created run and lives on the envelope. The in-process emitter knows it at emit time, so it is emitted, not reconstructed.

`piSessionId` links events to the Pi session row. Live emission resolves it directly; backfill resolves the JSONL transport session id at write time.

`kernelId` identifies one kernel. It namespaces container derivation and appears in the local kernel manifest.

## Linkage Rule

If a relationship is known at emit time, write the relationship explicitly:

- every trace event carries envelope `containerId`; events inside a run carry envelope `runId`
- every run carries `containerId`, `piSessionId`, and a `trigger` (`operator`, `parent-tool`, `steer`, `resume`, or `system`)
- a run records its `inbound_event_id` when it opens and `outbound_event_id` when it closes
- a run in an app phase carries `phase`
- a subagent spawned by a tool carries `parentToolUseId`
- a nested run carries `parentRunId` when known
- a child Pi session carries `parentSessionId`

The viewer may use timestamps for ordering, but not for structural parentage when an explicit ID is available.

## Event Sources

The primary emission path is the in-process kernel emitter: an extension the spawn pipeline attaches to every Pi session it creates. It has full identity from the run context at emit time and writes through the kernel trace writer into the local database.

Pi's JSONL transcript remains the durable raw record. The tailer package is a backfill tool over it — crash recovery and importing sessions that ran outside the kernel. Emitter and backfill derive identical deterministic event ids from the same protocol helpers, so a backfill after live emission inserts zero duplicate rows.

Kernel-side and app-side events flow through the same trace writer. The viewer treats everything as one trace stream; source is used for display and debugging, not for splitting the mental model.

## Usage Rollups

Every `pi_turn_end` carries `TurnUsage` (input/output/cache tokens, the model that actually served the turn, and a cost estimate from the kernel-config price table when present). The write path folds usage upward: turn → run → session → container, as denormalized rollup columns on each row. `agent_run_end` also carries the run's rolled-up usage in its payload.

## Trace Doctor

`runTraceDoctor` (and the CLI: `bun run packages/kernel/src/doctor-cli.ts <db-path>`) checks one kernel database against eight linkage and usage invariants — container references, run/session resolution, parent linkage, terminal statuses, tool-call pairing, tree acyclicity, run-id resolution, and usage-rollup consistency. The invariant list lives in [15-identity-model.md](15-identity-model.md). The kernel instance exposes the same check as `kernel.doctor()`.
