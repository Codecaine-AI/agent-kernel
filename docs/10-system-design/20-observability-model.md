---
covers: "Observability model for kernel registrations, containers, Pi agent sessions, agent runs, trace events, and explicit linkage rules."
concepts: [observability, kernel-registration, containers, pi-agent-sessions, agent-runs, trace-events, explicit-linkage, tailer, read-api]
code-ref: packages/db/src/schema/, packages/db/src/actions/read-api.ts, packages/viewer-core/src/build-trace-spans.ts
depends-on: [../00-foundation/20-principles.md, 30-event-protocol.md]
---

# Observability Model

The kernel observability model answers a simple question: what work ran, where did it belong, who spawned it, and what happened inside it?

---

## Core Records

| Record | Meaning |
|---|---|
| Kernel registration | Host-kernel discovery record for shared local infrastructure, including watch directories and viewer links. |
| Container | Generic grouping unit for app work. It has an id, label, status, optional parent container, phase label, phase vocabulary, working paths, and metadata. |
| Pi agent session | Pi SDK conversation identity for one agent session. This is the durable link to JSONL-sourced events. |
| Agent run | One processing loop inside a Pi session, usually tied to one user prompt or subagent dispatch. |
| Trace event | Time-ordered event row for prompts, context, messages, tools, lifecycle, containers, phases, warnings, and errors. |

## Identity Layers

`appSessionId` is host-app correlation. It lets Spectre or another app link kernel rows back to app-owned workflow rows.

`containerId` is kernel grouping identity. Trace reads and viewer rendering should prefer containers because containers are the portable grouping model.

`piSessionId` links events to the Pi session row after the tailer resolves the JSONL transport session id.

`runId` identifies a kernel-created run. Where available, run identity should be emitted directly rather than inferred later.

`kernelId` identifies a registered host kernel. It lets a shared tailer or central observer discover watch roots and link back into app-native trace pages.

## Linkage Rule

If a relationship is known at emit time, write the relationship explicitly:

- an agent run in a container carries `containerId`
- a trace event in a container carries envelope `containerId`
- a run in an app phase carries `phase`
- a subagent spawned by a tool carries `parentToolUseId`
- a nested run carries `parentRunId` when known
- a child Pi session carries `parentId`

The viewer may use timestamps for ordering, but not for structural parentage when an explicit ID is available.

## Event Sources

Kernel-side events come from the runtime and app adapters through trace writers.

Agent-side events come from Pi JSONL ingestion through the tailer.

The viewer treats both as one trace stream. Source is used for display and debugging, not for splitting the mental model.

## Compatibility Fields

The current extraction still carries `appSessionId` because Spectre has existing rows and routes keyed by app sessions. That is acceptable as a generic host-app correlation field. New kernel read paths should resolve from containers first and only fall back to app-session identity for compatibility.
