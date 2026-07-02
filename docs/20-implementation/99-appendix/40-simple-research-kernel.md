---
covers: "Simple Research Kernel example that boots a non-Spectre research app on a single local SQLite trace database and renders traces through the viewer shell."
concepts: [research-harness, examples, kernel-runtime, agent-catalog, context-loaders, subagents, working-memory, sqlite, read-api, doctor, backfill, viewer-shell]
code-ref: examples/simple-research-kernel/
depends-on: [10-dev-setup.md, ../20-kernel/30-context-loaders.md, ../50-read-api/00-overview.md, ../60-viewer/00-overview.md]
---

# Simple Research Kernel Demo

`examples/simple-research-kernel` is a runnable host application for inspecting the kernel outside Spectre. It runs entirely against one local SQLite file — no Postgres, no Docker, no tailer daemon.

---

## Run

```bash
bun run dev:simple-research
```

The launcher starts two local processes:

- API: `http://127.0.0.1:8788`
- Viewer: `http://127.0.0.1:5174`

On boot the server opens `.agent-kernel/trace.db` (WAL), ensures the observability schema, and writes the local kernel manifest `.agent-kernel/kernel.json`.

The API exposes the kernel read routes under `/kernel/*` and app routes under `/api/*`: `/api/research` for the current app summary, `/api/run` for starting prompt-driven research runs (optionally with a manifest `variant`), `/api/doctor` for the trace-doctor report, `/api/backfill` for re-importing Pi JSONL transcripts (idempotent by event id), and `/api/kernel-manifest` for the manifest summary. The viewer opens at `/research`, where a user can start a run and watch its live trace stream. `/traces` lists session containers, deep-links selections, and hosts the full detailed trace browser.

## What It Wires

The harness exercises the core package path:

```text
@agent-kernel/kernel
  createKernel({ id, db, catalog, models, loaders, toolRuntime, appContext, ... })
  kernel.container({ kind: "session", key })  — one root container per research request
  kernel.spawnAgent / kernel.agentManager
  kernel.traceWriter / kernel.readApiService / kernel.doctor()
  default loader catalog + app working-memory loader
  agent.json / prompt.json / prompt.rendered.md bundles
  per-agent context.ts and tools.ts sidecars

@agent-kernel/protocol
  trace event factories (app phase/container seeding)

@agent-kernel/db
  openKernelDatabase + ensureKernelObservabilitySchema + writeKernelManifest

@agent-kernel/tailer
  runBackfill behind the dev /api/backfill endpoint

@agent-kernel/kernel/read-api
  createKernelTraceReadApi(kernel.readApiService)

@agent-kernel/viewer-core
  KERNEL_TRACE_READ_PATHS
  buildTraceSpans()

@agent-kernel/viewer-shell
  KernelTraceViewer
```

## Runtime Shape

`src/server.ts` owns the Elysia API, DB open/bootstrap, kernel manifest write, read API mounting, and the doctor/backfill dev endpoints.

`src/simple-research-kernel-store.ts` owns the kernel instance (`createKernel` with catalog roots, a model alias, the working-memory loader, an app tool runtime, and per-spawn `appContext`), the live research runtime, session-container creation, subagent fan-out, and completion validation. One research request is one root container of kind `"session"`; identity is derived, never minted.

`src/agent-catalog/*/` holds the coordinator, source scout, and report writer bundles. Each directory contains an `agent.json` manifest, the canonical `prompt.json`, a committed `prompt.rendered.md` snapshot (enforced by `prompt-snapshots.test.ts`), and `context.ts`/`tools.ts` sidecars attached by filename convention.

`src/agent-catalog/tool-runtime.ts` contains the shared tool registration helpers and the runtime contract that lets agent sidecars call back into app-owned working memory and subagent orchestration without moving those concerns into the kernel package.

`research-memory/` holds the seed brief and durable source notes. When a run starts, the app creates `.agent-kernel/research-sessions/<session-slug>/`, copies that seed material into the session's `research-memory/` folder, and writes generated scout/final reports under that session directory.

`src/App.tsx` fetches the session-container list and selected detail, transforms selected events into trace spans, and renders separate research-run, traces, and agent-catalog workspaces around the shared viewer packages.

`src/styles.css`, `tailwind.config.cjs`, and `postcss.config.cjs` provide the example's Tailwind pipeline and Spectre-compatible viewer tokens. The example wrapper uses Tailwind utility classes; it does not define a separate named CSS component system.

## Boundary Intent

This example is deliberately not a Spectre adapter. It proves the extracted kernel can stand up a host harness with:

- a kernel instance from one config object
- container-first identity for app grouping
- data-file agent bundles with code sidecars
- app-defined context loaders
- subagent orchestration with inherited identity and triggers
- scout-report review and optional follow-up
- working-memory artifacts
- in-process event emission with usage rollups
- a single-file SQLite observability store
- read API responses, viewer-core transforms, and a mountable viewer shell
- an executable linkage check (`kernel.doctor()`)

Spectre should consume the same packages through a Spectre adapter layer rather than requiring these packages to know about Spectre sessions, phases, checkpoints, or task graphs.
