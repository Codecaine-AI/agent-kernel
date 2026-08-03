# Agent Kernel

- An opinionated system for building **problem-specific agent harnesses** on top of the Pi Agent SDK
- Designed for high-volume multi-agent systems that do one class of work extremely well

## Why this exists

- Mass multi-agent systems are the next step for agentic software:
  - Dozens of workers
  - Long pipelines
  - Deep subagent trees
- At that scale, token spend becomes a commodity resource:
  - Meter it like water.
  - Map where it flows.
  - Find the leaks.
  - Cut or reroute work that does not earn its cost.
- General tools like Codex and Claude Code are useful execution environments, but they do not give a purpose-built harness deep observability into spawned agents, token budgets, trace lineage, and model effectiveness.

- Agent Kernel is opinionated about that layer:

  - **Extreme observability.** 
    - Every prompt, context load, tool call, subagent spawn, and lifecycle event is captured as a durable, explicitly-linked trace. 
    - You can answer "where did the tokens go and what did they produce?" without guesswork or timestamp reconstruction.
  - **Extreme control.** 
    - Per-kernel and per-agent concurrency, explicit boundaries, scoped run context, abort/stop semantics, and a spawn pipeline you can audit end to end. 
    - You decide how many workers run and how they're contained.
  - **Any model, per agent.** 
    - Agents are declarative definitions, not hardcoded to one model. 
    - Route each agent in a harness to the model that earns its tokens

- The kernel stays deliberately neutral about *what problem your harness solves*.
- Workflow semantics, domain tools, and product rules belong to your harness.
- The kernel owns the runtime and observability foundation that makes a harness safe to scale — because scaling blindly is how agent projects get quietly expensive.

## Packages

- This is a platform monorepo while the contracts settle:

  - `@agent-kernel/protocol` — trace/event envelopes, event factories, deterministic event ids, and turn usage
  - `@agent-kernel/db` — per-kernel SQLite observability store, schema (with a Postgres mirror), kernel manifest, and query helpers
  - `@agent-kernel/kernel` — `createKernel` runtime, container identity, registry, context assembly, spawn pipeline, in-process emitter, subagents, trace doctor, read API, and transcript recovery
  - `@codecaine-ai/prompt-kit` — prompt document model, canonicalization/hashing, renderers, and editor primitives (submodule)
  - `@agent-kernel/viewer-core` — viewer DTOs, read/catalog API paths, trace transforms, and prompt diffing
  - `@agent-kernel/viewer-ui` — trace tree and card system, the detail panel and its data-only renderer contract, prompt lab components
  - `@agent-kernel/viewer-shell` — mountable trace workspace, the tree/detail viewer, and the shared style system

## Building a harness on it

- A harness is the problem-specific application layer that makes the kernel good at one task.
- A host application (the harness) consumes the kernel through a thin adapter.
- The harness owns workflow sessions, phase semantics, domain tools, app-specific loaders, app DB tables, and custom viewer panels.
- The kernel owns spawning, context assembly, observability storage, trace reading, and viewer primitives.
- The identity model behind all of this (containers, sessions, runs, turns, linkage invariants) is documented in [docs/10-system-design/15-identity-model.md](docs/10-system-design/15-identity-model.md); the overhaul plan that produced it lives in [docs/.drafts/agent-kernel-overhaul.plan.md](docs/.drafts/agent-kernel-overhaul.plan.md).

## Setup

- Install dependencies with `bun install`.

## Validation

- Run `bun run test:boundaries`.
- Run `bun run typecheck`.
- Run `bun run test`.
- The boundary check is the important portability gate: platform packages must not import the host application or reference host-app paths.
- To check a kernel trace database against the linkage/usage invariants, run the trace doctor: `bun run packages/kernel/src/doctor-cli.ts <db-path>`.

## Examples

- `examples/prompt-kit-kernel` is the standalone Prompt Kit kernel host for the first-party `prompt-editor` agent. It also exposes the Simple Research catalog as real edit targets and mounts its catalog, annotation, prompt-edit session, trace, and health APIs under the Observatory-compatible routes.
- Start it with `bun run dev:prompt-kit`; its API listens on `http://127.0.0.1:4850` and its isolated SQLite state lives under `examples/prompt-kit-kernel/.agent-kernel/`.
- `examples/simple-research-kernel` is a runnable standalone Simple Research Kernel.
- The example defines agents in a catalog (folder-form bundles: `agent.json` + `prompt/` + `context/` + `tools/`), loads context sidecars, spawns scout subagents, waits for their reports, reviews gaps, queues a report writer, writes working memory, persists kernel observability rows, and renders traces through the viewer shell.
- Start it with `bun run dev:simple-research` — no Postgres, no Docker, no service processes.
- It runs against a single local SQLite file (`examples/simple-research-kernel/.agent-kernel/trace.db`, WAL mode) created on boot, alongside a local kernel manifest (`.agent-kernel/kernel.json`).
- The launcher starts the API on `http://127.0.0.1:8788` and the viewer on `http://127.0.0.1:5174`.
- `bun run dev:services` remains only for optional shared-Postgres experiments against the `@agent-kernel/db/schema/pg` mirror; the example does not use it.
