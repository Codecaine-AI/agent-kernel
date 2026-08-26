---
covers: "How agents run outside their owning apps: the harness taxonomy (app harnesses vs the terminal harness), the reference app harness, the TUI leg's boot contract and catalog precedence, host and tool-policy classification, the core kernel, TUI session tracing, and how any kernel joins the Observatory."
concepts: [harness, tui, terminal-harness, app-harness, simple-research-kernel, core-kernel, catalog-precedence, host, disallowed-tools, session-binding, trace-ingest, observatory, kernel-checklist]
depends-on: [10-runtime-model.md, 15-identity-model.md, 20-observability-model.md, 60-prompt-system-model.md, ../30-authoring/00-overview.md]
---

# Harness Model

A **kernel** is the unit the platform understands: manifest
(`.agent-kernel/kernel.json`) + catalog of bundles + `trace.db` + optional
read API. A **harness** is how sessions of a kernel's agents actually run.
Nothing about running kernels requires any particular harness.

```
                agent-kernel (library)
        ┌────────────┼────────────────┐
  canvas-agent   prompt-kit-agent   @agent-kernel/tui
  (app harness   (app harness       (terminal harness —
   :4820)         :4850)             a pi extension)
```

App harnesses embed the kernel as a service inside a product (session stores,
SSE, viewers). The terminal harness is the opposite trade: it borrows pi's
existing front-end — loop, streaming, tools, transcript — and only supplies
what pi cannot: find the bundle, assemble the request, bind its tools.

## The reference app harness (`examples/simple-research-kernel`)

The in-repo example is the minimal complete app harness: a runnable research
host that is deliberately not a Spectre adapter. Its architecture is what any
app harness reduces to:

- **One server process owns composition.** The API server opens the kernel's
  SQLite trace db (WAL), ensures the observability schema, writes the local
  kernel manifest, mounts the kernel read routes under `/kernel/*`, and keeps
  app routes separate under `/api/*` (run start, app summary, doctor report,
  transcript backfill).
- **One store module owns the kernel instance and the runtime.** `createKernel`
  from a single config object (catalog roots, a model alias, an app
  working-memory loader, an app tool runtime, per-spawn `appContext`), plus
  session-container creation, subagent fan-out, and completion validation.
- **Container-first identity.** One research request is one root container of
  kind `"session"`; identity is derived from kind + key, never minted.
- **Data-file bundles with code sidecars.** The coordinator, source scout, and
  report writer are folder-form bundles — `agent.json`, `prompt/prompt.json`
  with its committed `system.md` render, `context/` and `tools/` sections. None
  ships a state section, so all three run pass-through.
- **App capabilities through the tool runtime.** A shared runtime contract lets
  agent sidecars call back into app-owned working memory and subagent
  orchestration without moving either concern into the kernel package. Durable
  session artifacts (seed brief, source notes, scout and final reports) live in
  per-session working-memory folders the app owns.
- **A thin viewer binding.** The frontend maps app objects onto the shared
  `KernelTraceWorkspace`/`KernelTraceViewer` from viewer-shell and owns nothing
  about trace layout — only the surrounding research, traces, and catalog
  workspaces.

Run instructions live in `examples/simple-research-kernel/README.md`. Spectre
consumes the same packages through its own adapter layer
(`50-app-adapter-model.md`) rather than the kernel knowing Spectre concepts.

## The terminal harness (`packages/tui`)

A globally-loaded pi extension (via the pi settings `extensions` pointer; see
the pi-config repo's README for machine setup). It is passive until invoked:
plain `pi` is an ordinary session.

- `/kernel` — interactive table of resolvable agents (project and generic
  sections, per-row runnable status, Tab for description). Non-interactive
  contexts get a plain list.
- `/kernel <name> [--fixture <id>]` — soft-reboots the *current* session as
  that agent: from the next turn the model receives the bundle's assembled
  request, and the bundle's tools are registered live. Same process, same
  transcript.

### Boot contract (thin spawn)

The full spawn pipeline is db-coupled; the TUI assembles from the fs-only
kernel exports: `buildRegistry` (bundle discovery), `buildContext` (section
②), and the state module's seed/render (section ③, seeded once at boot or
from a named fixture). `before_agent_start` replaces pi's system prompt with
the assembled ① + ② + ③ every turn. Per-turn ③ re-render is a marked seam,
not yet built.

**Runtime constraint that shapes everything:** pi executes extensions — and
therefore bundle sidecars — under Node via jiti, while the kernel ecosystem
is bun-first. Anything the extension's import graph or a `host:"any"` sidecar
loads must therefore survive a Node runtime; the import-graph rules that keep
them Node-clean are implementation decisions on
[`../20-implementation/70-app-adapters.md`](../20-implementation/70-app-adapters.md).
Doctor's host-portability check proves loadability under *a* Node runtime;
the final gate for tools sidecars is a boot through real pi.

### Catalog precedence

```
resolve(name) over [ cwd .agent-kernel/kernel.json catalogRoots…,
                     generic catalog (agent-kernel/catalog/) ]
```

Project-first, by name: a repo bundle **shadows** a generic one. This is the
entire specialization mechanism — one generic `context-editor` everywhere; a
repo ships its own under the same name to specialize. Never specialize via
pi skill-name collisions.

### Classification: `host` and tool policy

Two manifest fields (semantics in `../30-authoring/00-overview.md`) govern
the TUI's behavior per bundle:

- `host` — `"app"` (default) bundles are classified from the manifest alone
  and never evaluated or booted here; `"any"` bundles load, and load
  failures degrade to a per-bundle reason instead of hiding the catalog.
- `disallowedTools` — enforced by blocking at `tool_call` while the agent is
  active (interactive sessions keep pi's built-ins, so blocking *is* the
  enforcement). Pattern: an agent whose mutations must flow through its own
  typed tools sidecar disallows `write`/`edit` and keeps reads open —
  `docs-writer` is the reference case.

## The core kernel

The agent-kernel repo is itself a kernel: its generic catalog is the
bundles' home, `packages/core-harness` (:4860) is
its service leg — health, kernel read API, catalog routes, and prompt-edit
sessions so generic agents are editable from the Observatory's prompt lab.
Prompt-edit *runs* record under the prompt-kit kernel (trace ownership:
prompt editing is prompt-kit's domain); catalog writes stay on the core
kernel.

## TUI session tracing

Interactive sessions become kernel traces in two steps:

1. **Markers** — on `/kernel` boot the extension appends two custom entries
   to pi's transcript: the `agent-kernel:session-binding` marker
   (container/run identity for transcript recovery) and
   `agent-kernel:tui-session-meta` (agent name, cwd, target kernel root,
   `origin: "tui"`). Ownership rule: the target kernel is the cwd repo's
   (`.agent-kernel/` up-tree), else the core kernel's. Note pi persists the
   JSONL lazily — a session needs at least one model turn.
2. **Ingest** — the `agent-kernel-tui-ingest` CLI (batch, idempotent) scans pi's
   sessions dir, upserts identity rows (container kind `session`,
   `metadata.origin: "tui"`), and backfills events into the owning kernel's
   `trace.db`. Ingested sessions render in the Observatory with a `tui`
   badge, beside the same kernel's app-harness runs.

## Joining the Observatory (kernel checklist)

1. `.agent-kernel/kernel.json` — kernelId, catalogRoots, dbPath, and (with a
   service leg) readApiBaseUrl.
2. A catalog of folder-form bundles (`../30-authoring/`), each with an
   explicit `host` posture and, where mutations need guardrails, a
   `disallowedTools` policy + typed tools sidecar.
3. Traces into its own `trace.db` — harness emitter, or markers + ingest for
   TUI sessions.
4. Optional service leg mounting read-api/catalog/prompt-edit at `/kernel/*`
   plus `/health` on a stable port (mirror `packages/core-harness`).
5. Register with the observatory repo's registry sync (Core's doctor warns
   on drift).

## Records

Operational setup, boot commands, and troubleshooting (the how-to
counterpart of this doc): `packages/tui/README.md` and the repo `README.md`.
Design rationale and as-built session records (kept as reference, not
maintained as documentation): `../.drafts/tui-harness.design.md` and
`../.drafts/core-kernel-observatory.design.md`. Machine/personal setup:
the pi-config repo's README. Observatory-side details: the observatory
repo's README and DESIGN.
