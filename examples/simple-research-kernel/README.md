# Simple Research Kernel

A runnable host application for inspecting the kernel outside any product
app. It runs entirely against one local SQLite file — no Postgres, no Docker,
no service processes (transcript recovery is an in-kernel import tool, not a
running daemon).

Architecture and the harness taxonomy it belongs to:
[`docs/10-system-design/70-harness-model.md`](../../docs/10-system-design/70-harness-model.md).
The adapter model it demonstrates:
[`docs/10-system-design/50-app-adapter-model.md`](../../docs/10-system-design/50-app-adapter-model.md).

## Run

From the repo root:

```bash
bun run dev:simple-research
```

The launcher starts two local processes:

- API: `http://127.0.0.1:8788` (override with `SIMPLE_RESEARCH_KERNEL_PORT`)
- Viewer: `http://127.0.0.1:5174` (override with `FRONTEND_PORT`)

On boot the server opens `.agent-kernel/trace.db` (WAL mode, created on
boot), ensures the observability schema, and writes the local kernel
manifest `.agent-kernel/kernel.json`.

## Endpoints

Kernel read routes mount under `/kernel/*`; app routes under `/api/*`:

- `/api/research` — current app summary
- `/api/run` — start a prompt-driven research run (optionally with a manifest `variant`)
- `/api/doctor` — the trace-doctor report
- `/api/backfill` — re-import Pi JSONL transcripts (idempotent by event id)
- `/api/kernel-manifest` — manifest summary

The viewer opens at `/research`, where you can start a run and watch its
live trace stream. `/traces` lists session containers, deep-links
selections, and hosts the full detailed trace browser.

## Use it to check

Agent bundles, context sidecars, subagent orchestration, scout-report
review, working-memory writes, protocol events, SQLite persistence, usage
rollups, the read API, viewer-core transforms, and the viewer shell — all
still working together after a change.

`bun run dev:services` (repo root) exists only for optional shared-Postgres
experiments against the `@agent-kernel/db/schema/pg` mirror — this example
does not need it.
