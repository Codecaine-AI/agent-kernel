# Pi Agent Kernel

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

- Pi Agent Kernel is opinionated about that layer:

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

  - `@agent-kernel/protocol` — trace/event envelopes and event factories
  - `@agent-kernel/db` — kernel observability schema and query helpers
  - `@agent-kernel/kernel` — runtime, registry, context assembly, spawn pipeline, subagents, and read API
  - `@agent-kernel/tailer` — Pi JSONL ingestion primitives
  - `@agent-kernel/viewer-core` — viewer DTOs, read API paths, and trace transforms
  - `@agent-kernel/viewer-ui` — reusable trace viewer components
  - `@agent-kernel/viewer-shell` — mountable base trace viewer shell

## Building a harness on it

- A harness is the problem-specific application layer that makes the kernel good at one task.
- A host application (the harness) consumes the kernel through a thin adapter.
- The harness owns workflow sessions, phase semantics, domain tools, app-specific loaders, app DB tables, and custom viewer panels.
- The kernel owns spawning, context assembly, observability storage, trace reading, and viewer primitives.
- **Spectre** is the reference harness — a coding-workflow application built on the kernel.
- Spectre exists to show how to extend the kernel for a real problem-specific harness, not to define what the kernel is.
- For the longer-term service model, see [ARCHITECTURE_UPDATE.md](ARCHITECTURE_UPDATE.md).
- `ARCHITECTURE_UPDATE.md` describes the centralized local DB/tailer plane, kernel registration, app-embedded viewers, and optional central observer.

## Setup

- Install dependencies with `bun install`.

## Validation

- Run `bun run test:boundaries`.
- Run `bun run typecheck`.
- Run `bun run test`.
- The boundary check is the important portability gate: platform packages must not import the host application or reference host-app paths.

## Examples

- `examples/simple-research-kernel` is a runnable non-Spectre Simple Research Kernel.
- The example defines agents in a catalog, loads context sidecars, spawns scout subagents, waits for their reports, reviews gaps, queues a report writer, writes working memory, persists kernel observability rows to Postgres, and renders traces through the viewer shell.
- Start shared services with `bun run dev:services`.
- Start the Simple Research Kernel with `bun run dev:simple-research`.
- The service command starts shared Postgres in OrbStack/Docker on `127.0.0.1:55432`.
- The kernel command starts the API on `http://127.0.0.1:8788` and the viewer on `http://127.0.0.1:5174`.
- The example uses `AGENT_KERNEL_DATABASE_URL` when set, otherwise `postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel`.
- It bootstraps kernel observability tables, upserts a `kernel_registrations` row, and writes containers/Pi sessions/runs/events to Postgres.
