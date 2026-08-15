# Core Kernel & Observatory Convergence

> **SETTLED 2026-08-14** into `../10-system-design/70-harness-model.md`
> (harness taxonomy, TUI boot contract, tracing, kernel checklist) — read
> that for the current model; this file is the session record and is no
> longer maintained.

Design session + as-built record, 2026-08-07. Successor to
`tui-harness.design.md` (the TUI leg this builds on). Goal: the Observatory is
the one place to see — and edit — every agent in the system: canvas, research,
prompt-kit, the kernel's own generic agents, and (next) docs.

## The unifying idea

Everything the Observatory renders, it gets from "a kernel": manifest +
catalog + trace.db + optional read API. Canvas, prompt-kit, and
simple-research already conformed. The generic agents (context-editor,
docs-writer, …) were the only ones living outside the pattern — no kernel, no
traces, no editability. The overhaul is not reshaping the Observatory; it is
making the kernel layer conform to its own pattern: **the agent-kernel repo is
now a kernel** (the "core kernel"), with the TUI as its runtime leg and a
minimal service harness as its service leg.

```
Observatory (registry of kernels; direct db reads + per-project proxy)
  canvas           app harness :4820 · trace.db · catalog
  prompt-kit       app harness :4850 · trace.db · catalog
  simple-research  example
  agent-kernel     CORE KERNEL (new)
      .agent-kernel/kernel.json + trace.db
      catalog/  (context-editor, docs-writer, …)
      core-harness :4860 — read API + prompt-edit (no app UI;
                            its "app" is the agent system itself)
      TUI sessions → markers → ingest → trace.db
  docs             next: joins by the checklist below
```

## As-built, 2026-08-07 (all uncommitted)

### 1. Core kernel

- `agent-kernel/.agent-kernel/kernel.json` — manifest v2: kernelId
  `agent-kernel`, catalogRoots `[<repo>/catalog]`, dbPath
  `.agent-kernel/trace.db`, readApiBaseUrl `http://127.0.0.1:4860`.
- Registered in `observatory/registry.json` + `registry.example.json`
  (launchCommand `bun run --cwd ../agent-kernel core-harness`, autoLaunch
  false, writable true).

### 2. TUI trace pipeline (batch-first, per the settled call)

- On `/kernel` boot, the tui extension appends two custom entries into pi's
  live transcript via `pi.appendEntry` (`packages/tui/src/session-binding.ts`):
  - `agent-kernel:session-binding` `{containerId: uuid, runId: uuid}` — the
    marker transcript-recovery's mapper requires (top-level data fields).
  - `agent-kernel:tui-session-meta` `{containerId, runId, agentName, source,
    cwd, kernelId, targetKernelRoot, origin: "tui"}` — ingest identity;
    carries the ids so meta↔binding pair by id, not adjacency.
- `targetKernelRoot` implements the **ownership rule**: the cwd repo's
  `.agent-kernel/` when found (a context-editor session in canvas belongs to
  canvas), else the core kernel's own.
- `bunx agent-kernel-tui-ingest [--sessions-dir ~/.pi/agent/sessions]
  [--dry-run]` (`packages/kernel/src/transcript-recovery/tui-ingest.ts`):
  scans pi session JSONL, and for files carrying the meta marker upserts the
  identity rows (container kind `"session"`, `metadata.origin: "tui"`, label
  `tui: <agent>`; pi_agent_session; agent_run trigger `operator`) into the
  target kernel's db, then runs the existing backfill over the file.
  Idempotent — re-runs are zero-delta (deterministic event ids, INSERT OR
  IGNORE). Files without the meta marker (plain pi sessions, old harness
  transcripts) are skipped silently.
- Verified live: real RPC sessions from canvas → canvas `trace.db`, from a
  kernel-less dir → agent-kernel `trace.db`; both render through
  `createContainerReadService` (kind `"session"` needs no viewer change).

### 3. Service leg — `packages/core-harness`

`bun run core-harness` (from agent-kernel) binds 127.0.0.1:4860:
`GET /health`; `/kernel/*` routes matching the Observatory proxy convention —
read-api (trace-sessions, container trace, blobs, run turn context),
catalog-api with writes (agents, prompt PUT, manifest PUT, revisions, state
previews, annotations), and the full prompt-edit-session surface (create,
SSE events, requests, accept/reject/undo/replies). Prompt-editor resolves
from prompt-kit's catalog as an unlisted root (spawnable, not listed);
model default `codex-lb/gpt-5.6-sol`. Verified end-to-end with a live
prompt-edit session against context-editor (real spawn, real turn).

**Ownership rule applied to prompt edits** (settled): prompt-edit *runs* for
generic agents record under the **prompt-kit kernel's** db, mirroring
canvas's `bootPromptEditTraceKernel` — prompt editing is prompt-kit's domain.
Registry/catalog writes stay on the core kernel.

### 4. Registry sync + origin visibility

- `observatory/scripts/sync-registry.ts` (`bun run registry:check|sync`;
  Core doctor runs check as a warning). Registry-authoritative: matches by
  resolved kernelRoot, ADDs missing kernels, reports drift, never modifies
  existing entries. First real run caught genuine drift (prompt-kit's
  :4850 → ephemeral-port manifest rewrite — the known port bounce).
- Session-list container kinds: `SESSION_CONTAINER_KINDS` constant in
  `observatory/src/server/database.ts` (was hardcoded).
- Origin badge: `viewer-shell` `KernelTraceWorkspace` renders a pill from
  `TraceWorkspaceRow.badge`; observatory's `TracesPage` populates it from
  `metadata.origin`. (`viewer-ui` untouched — it holds unrelated uncommitted
  work.)

## The kernel checklist (how a new domain joins)

1. `.agent-kernel/kernel.json` — kernelId, catalogRoots, dbPath, and (if it
   has a service) readApiBaseUrl.
2. A catalog of folder-form bundles (see `docs/30-authoring/`), each with an
   explicit `host` posture.
3. Traces into its own `trace.db` — via its harness's emitter, or via the
   TUI marker + ingest path for interactive sessions (ownership rule: the
   kernel of the repo the session operates on).
4. Optional service leg for Observatory proxy features (catalog browsing,
   prompt-lab editing): mount read-api/catalog-api/prompt-edit at `/kernel/*`
   plus `/health`, on a stable port.
5. `bun run registry:sync` in observatory (doctor will nag if you forget).

The docs kernel is the next consumer: the `docs-writer` bundle exists in the
generic catalog; kernel-ifying docs-system is this checklist, applied.

## Known issues & quirks (discovered during verification)

- **Observatory offline reads vs WAL** — `openKernelDatabaseReadOnly` fails
  with SQLITE_CANTOPEN on a cleanly-closed WAL db missing its `-shm` (bites
  agent-kernel's db until some read-write connection recreates it; canvas
  works only because its harness leaves one). `?immutable=1` works. Fix
  belongs in the observatory's open path.
- **pi persists session JSONL lazily** — a slash-command-only session writes
  nothing; a model turn (even one that 429s at the provider) is required
  before markers exist on disk.
- **Mapper rebinding** — a second `/kernel` boot in one session rebinds
  subsequent events to the new container; if both boots target *different*
  kernel roots, the whole file backfills into each db and the other root's
  events sit as non-rendering orphans (documented in tui-ingest.ts).
- **Single-writer** — batch ingest into a db a live harness is writing leans
  on SQLite locking; acceptable for batch, revisit if ingest goes
  watcher-live.
- The meta marker maps to a benign `custom_event` trace row.

## Addendum 2026-08-14: typed tool surfaces + tool policy

Pattern established with `docs-writer` (the model is the prompt-editor: the
agent cannot corrupt the artifact class it manages, because every mutation is
a validated, domain-shaped function call):

- **Typed tools sidecar** — `catalog/docs-writer/tools/` registers
  `docs_tree` / `docs_read` / `docs_write` / `docs_check` over
  `@codecaine-ai/docs-model` + docs-cli's `mdxToDoc`: markdown in,
  schema-validated `doc.json` out; invalid documents are rejected without
  writing; reads return rendered markdown (never raw doc.json). Self-
  contained and Node-portable (doctor-verified); cross-repo package imports
  resolve through the Core workspace hoist.
- **Tool policy = the existing manifest fields.** No new vocabulary:
  `disallowedTools: ["write", "edit"]` in `agent.json`. The spawn pipeline
  already applied it; the TUI now enforces it too, by blocking at
  `tool_call` while the agent is active (reads stay open, `bash` remains —
  guardrail against sloppiness, not a security boundary). The boot notice
  lists `built-ins disabled: …`.
- Known limitation: `docs_write` is full-document — block ids regenerate on
  update (document id preserved); annotations anchored to old block ids
  detach. Surgical `applyOps`-based updates are the successor when id-stable
  editing matters.
- Sidecar dependency rule learned the hard way: import deep, typebox-free
  subpaths (`docs-model/doc-schema`, `/delta-markdown`), never the docs-model
  barrel — its `components/` call `@sinclair/typebox` `Type.Recursive` at
  module load, which fails under pi's runtime typebox flavor. Doctor's
  host-portability check did NOT catch this (its module resolution found a
  compatible typebox; pi's differs) — doctor proves loadability under *a*
  Node runtime, not under pi's exact dependency graph. Final gate for tool
  sidecars: boot through real pi (`--mode rpc`).

## Open items

1. Observatory WAL/readonly open fix (`immutable=1` or accept `-shm`
   recreation).
2. Watcher-live ingest (promote from batch) — natural home: core-harness.
3. Per-turn ③ state re-render in the TUI (`state-loop`), per-agent flags,
   alias/model resolution — carried from the TUI design.
4. Canvas-specialized context-editor bundle; `spawn_agent` over the same
   catalog precedence.
5. Docs kernel via the checklist.
6. Cross-kernel links in the viewer (runs touching another kernel's domain).

## Addendum 2026-08-14: docs kernel

`docs-system` has joined the Observatory pattern through the kernel checklist:
its repo-owned manifest points at its own catalog and trace database, and its
service leg listens on `127.0.0.1:4840`.

The docs-system catalog is the listed, domain-owned root and starts without
bundles. The generic `docs-writer` stays in `agent-kernel/catalog/` so it
remains TUI-spawnable in any repository; docs-kernel mounts that catalog as an
unlisted root for resolution only.

Docs-edit sessions are the id-stable successor anticipated by the typed tool
surface addendum: they stage `DocProposal`s in-process through docs-server's
proposal operations instead of using whole-document `docs_write`, preserving
existing block ids and their annotation anchors.
