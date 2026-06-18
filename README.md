# Pi Agent Kernel

Portable agent runtime, observability, tailer, and viewer packages extracted from Spectre.

This repository is intentionally a platform monorepo while the contracts settle:

- `@agent-kernel/protocol` - trace/event envelopes and event factories
- `@agent-kernel/db` - kernel observability schema and query helpers
- `@agent-kernel/kernel` - runtime, registry, context assembly, spawn pipeline, subagents, and read API
- `@agent-kernel/tailer` - Pi JSONL ingestion primitives
- `@agent-kernel/viewer-core` - viewer DTOs, read API paths, and trace transforms
- `@agent-kernel/viewer-ui` - reusable trace viewer components
- `@agent-kernel/viewer-shell` - mountable base trace viewer shell

Spectre should consume this repository as an application adapter/reference app. Spectre owns workflow sessions, phase semantics, domain tools, app-specific loaders, app DB tables, and custom viewer panels.

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

The boundary check is the important portability gate: platform packages must not import Spectre or reference Spectre app paths.

## Current State

This repo was seeded from Spectre's local-ready agent-kernel extraction. See:

- `objectives/agent-kernel-platform-extraction/current_state.md`
- `docs/.drafts/agent-kernel-platform.design.md`
- `docs/.drafts/agent-kernel-contracts.design.md`
- `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`

## Next Step

Add a minimal non-Spectre harness under `examples/` that boots the kernel, loads a tiny agent catalog, emits trace events, reads them through the kernel read API, and renders them through the viewer shell.
