---
covers: "Development setup and validation commands for the pi-agent-kernel repository."
concepts: [dev-setup, bun, typecheck, tests, boundary-check]
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
bun run typecheck:kernel
bun run typecheck:tailer
bun run typecheck:viewer-core
bun run typecheck:viewer-ui
bun run typecheck:viewer-shell
```

## Basic Workbench

```bash
bun run dev:basic
```

This starts the non-Spectre in-memory workbench:

- Viewer: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8788`

Use it when checking that the kernel runtime facade, context loader catalog, protocol events, read API, viewer-core transforms, and viewer shell still work together.

## Current Recommended Manual Check

When changing package boundaries, run:

```bash
rg -n "@spectre|\\.spectre|Spectre|SPECTRE|apps/backend|apps/frontend|checkpoint-slice|SessionStateManager" packages docs
```

Expected result: app-specific names may appear in docs only when explaining adapter boundaries. They should not appear in package source.
