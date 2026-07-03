---
covers: "Development setup and validation commands for the pi-agent-kernel repository."
concepts: [dev-setup, bun, typecheck, tests, boundary-check, trace-doctor, sqlite]
depends-on: [../00-overview.md]
---

# Dev Setup

This repository is a Bun workspace.

---

## Install

```bash
bun install
```

## Validation

```bash
bun run test:boundaries
bun run typecheck
bun run test
```

`test:boundaries` is the portability gate. It checks that kernel packages do not reference Spectre packages, Spectre paths, or known Spectre-only names.

## Package Typechecks

```bash
bun run typecheck:protocol
bun run typecheck:db
bun run typecheck:prompt-kit
bun run typecheck:kernel
bun run typecheck:viewer-core
bun run typecheck:viewer-ui
bun run typecheck:viewer-shell
bun run typecheck:examples
```

## Simple Research Kernel Demo

No Docker and no service processes — the example runs against a single local SQLite file:

```bash
bun run dev:simple-research
```

Defaults:

- DB: `examples/simple-research-kernel/.agent-kernel/trace.db` (WAL mode, created on boot)
- Viewer: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8788`

Use it when checking that agent bundles, context sidecars, subagent orchestration, scout-report review, working-memory writes, protocol events, SQLite persistence, usage rollups, read API, viewer-core transforms, and viewer shell still work together.

`bun run dev:services` still exists, but only for optional shared-Postgres experiments against the `@agent-kernel/db/schema/pg` mirror — the example does not need it.

## Trace Doctor

Check a kernel database against the linkage and usage invariants:

```bash
bun run packages/kernel/src/doctor-cli.ts <db-path>
```

Without an argument it defaults to `.agent-kernel/trace.db` under the current directory. Non-zero exit means violations. The example API also exposes the same report at `GET /api/doctor`, and `POST /api/backfill` re-imports Pi JSONL transcripts (idempotent by event id).

## Current Recommended Manual Check

When changing package boundaries, run:

```bash
rg -n "@spectre|\\.spectre|Spectre|SPECTRE|apps/backend|apps/frontend|checkpoint-slice|SessionStateManager" packages docs
```

Expected result: app-specific names may appear in docs only when explaining adapter boundaries. They should not appear in package source.
