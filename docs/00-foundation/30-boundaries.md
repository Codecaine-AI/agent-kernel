---
covers: "Kernel versus application ownership boundaries, including which concepts stay core and which must be supplied by adapters like Spectre."
concepts: [boundaries, kernel-core, app-adapter, spectre, ownership, custom-loaders, custom-tools]
depends-on: [20-principles.md]
---

# Boundaries

The kernel owns the reusable runtime and observability foundation. A host application owns workflow semantics and product behavior.

---

## Kernel Owns

| Area | Kernel Responsibility |
|---|---|
| Protocol | Trace event envelope, core event types, trace levels, factories, deterministic event ids, source conventions |
| Runtime | `createKernel` config surface, container identity, run context, spawn pipeline, in-process emitter, turn limits |
| Agent definitions | `agent.json` manifests, registry, prompt rendering, variable validation, sidecar loading |
| Prompt system | Canonical `prompt.json` documents, content-addressed prompt revisions, rendered snapshots, revision registration |
| Context | Base loader catalog and context assembly contract |
| Subagents | In-process agent manager, queueing, parent tool-call linkage, steering events |
| Observability DB | Per-kernel SQLite database, local kernel manifest, containers, Pi agent sessions, agent runs, trace events, prompt revisions, usage rollups, read helpers |
| Tailer | JSONL backfill/import: whole-file reading, event mapping, idempotent insert with emitter id parity |
| Read API | Versioned trace read routes and catalog routes that viewer-core can target |
| Viewer | Trace DTOs, catalog DTOs, trace span transforms, prompt diffing, reusable tree/detail UI, prompt lab, base viewer shell |

## Apps Own

| Area | App Responsibility |
|---|---|
| Workflow state | App session rows, phase slices, task/checkpoint graphs, project docs, local artifacts |
| Workflow rules | When phases start/end, how gates work, what "done" means |
| Domain tools | Tools that mutate app rows or app files |
| Custom loaders | Loaders that read app-specific state, such as Spectre's checkpoint slice |
| App APIs | Routes that start, stop, resume, answer, or mutate workflow artifacts |
| Viewer extensions | Panels and renderers that interpret app-specific labels or custom events |

## Adapter Layer

The adapter layer is the code that joins a host app to the kernel. It should be explicit and small enough to audit.

For Spectre that adapter includes:

- app session to kernel container mapping
- app DB schema composing kernel tables
- Spectre agent catalog roots and shared tool factories
- Spectre state manager injection
- Spectre custom context loaders
- Spectre tailer configuration and compatibility event names
- Spectre data-backend mount for the kernel read API
- Spectre viewer shell plugins and phase-specific panels

## Promotion Rule

A feature starts app-side when its generic shape is unclear. It can move into the kernel only after it proves useful beyond one app and can be expressed without app workflow semantics.

Durable human-in-the-loop asks are a good example. The suspend/resume mechanics are generic. Spectre's ask rows and payloads remain app-side until the kernel has a clean cross-app contract.
