# Pi Agent Kernel

An opinionated foundation for building **vertical-specific agent harnesses** on the Pi agent SDK. It is built for token-hungry, multi-agent systems — the kind where you spin up many agents in parallel and need to know, at a fine grain, where every token went and whether it earned its keep.

## Why this exists

When an agent system gets serious — dozens of parallel workers, long pipelines, deep subagent trees — it becomes trivially easy to spend thousands of dollars in minutes. The only way to keep that sustainable is to treat token spend as a first-class engineering concern: you have to *see* it, *attribute* it, and *compare* the effectiveness of the agents and models behind it.

That is what the kernel is opinionated about. For a given vertical, three things matter above all:

- **Extreme observability.** Every prompt, context load, tool call, subagent spawn, and lifecycle event is captured as a durable, explicitly-linked trace. You can answer "where did the tokens go and what did they produce?" without guesswork or timestamp reconstruction.
- **Extreme control.** Per-kernel and per-agent concurrency, explicit boundaries, scoped run context, abort/stop semantics, and a spawn pipeline you can audit end to end. You decide how many workers run and how they're contained.
- **Any model, per agent.** Agents are declarative definitions, not hardcoded to one model. Route each agent in a vertical to the model that earns its tokens — cheap models for fan-out work, strong models for the hard steps.

The kernel stays deliberately neutral about *what your vertical does*. Workflow semantics, domain tools, and product rules belong to your harness. The kernel owns the runtime and observability foundation that makes a harness safe to scale — because scaling blindly is how agent projects get quietly expensive.

## Packages

This is a platform monorepo while the contracts settle:

- `@agent-kernel/protocol` — trace/event envelopes and event factories
- `@agent-kernel/db` — kernel observability schema and query helpers
- `@agent-kernel/kernel` — runtime, registry, context assembly, spawn pipeline, subagents, and read API
- `@agent-kernel/tailer` — Pi JSONL ingestion primitives
- `@agent-kernel/viewer-core` — viewer DTOs, read API paths, and trace transforms
- `@agent-kernel/viewer-ui` — reusable trace viewer components
- `@agent-kernel/viewer-shell` — mountable base trace viewer shell

## Building a vertical on it

A host application (the harness) consumes the kernel through a thin adapter. The harness owns workflow sessions, phase semantics, domain tools, app-specific loaders, app DB tables, and custom viewer panels. The kernel owns spawning, context assembly, observability storage, trace reading, and viewer primitives.

**Spectre** is the reference harness — a coding-workflow application built on the kernel. It exists to show how to extend the kernel for a real vertical, not to define what the kernel is.

## Setup

```bash
bun install
```

## Validation

```bash
bun run test:boundaries
bun run typecheck
bun run test
```

The boundary check is the important portability gate: platform packages must not import the host application or reference host-app paths.

## Examples

`examples/basic-kernel` is a minimal non-Spectre harness that boots the kernel, runs agents, and renders traces through the viewer shell.

```bash
bun run dev:basic
```

The command starts the API on `http://127.0.0.1:8788` and the viewer on `http://127.0.0.1:5174`.

## Current State

This repo was seeded from Spectre's local-ready agent-kernel extraction. See:

- `docs/00-foundation/00-overview.md`
- `docs/10-system-design/00-overview.md`
- `docs/20-implementation/00-overview.md`
- `docs/20-implementation/99-appendix/20-package-linking.md`
- `objectives/agent-kernel-platform-extraction/current_state.md`
- `docs/.drafts/agent-kernel-platform.design.md`
- `docs/.drafts/agent-kernel-contracts.design.md`
- `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`
