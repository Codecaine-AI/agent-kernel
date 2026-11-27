# Agent Kernel

Bundle authoring guidance lives at [`docs/30-authoring/`](docs/30-authoring/).

## Test commands

Run every command from the repo root. Install first with `bun install` at the Core workspace root (the folder above this repo).

**Tier 1, every change:** `bun run typecheck`, then the focused command for each changed test or its owner: `bun test ./<path to test file>` from the repo root. A path under `.archon/` must be named file by file: `bun test` skips dot folders when it gets a folder filter, so `bun test ./.archon` matches nothing.

**Tier 2, before a PR:** there is no changed-files gate and no CI. Diff base: `origin/main`. Run the suite of every area the diff touches, plus every area that imports it:

| Area | Owns | Command | Size, wall time |
|---|---|---|---|
| `scripts` | Package boundary check, TUI typecheck baseline | `bun run test:boundaries` | 2 files, under 1 s |
| `packages/protocol` | Event envelopes, factories, deterministic ids | `bun test ./packages/protocol/src` | 4 files, under 1 s |
| `packages/db` | SQLite observability store, schema upgrades | `bun test ./packages/db/src` | 6 files, about 1 s |
| `packages/kernel` | `createKernel`, registry, spawn pipeline, model nodes, read API, doctor, prompt edit sessions | `bun test ./packages/kernel/src` | 65 files, about 10 s |
| `packages/tui` | Terminal UI | `bun run --cwd packages/tui test` | 5 files, under 1 s |
| `examples/simple-research-kernel` | Example harness, prompt snapshots, model-nodes demo | `bun test ./examples/simple-research-kernel` | 3 files, about 3 s |
| `.archon` | Pre-PR review workflow pack helpers | `bun test ./.archon/workflows/codecaine/.shared/outside-reviewers.test.ts ./.archon/workflows/codecaine/.shared/review-item.test.ts ./.archon/workflows/codecaine/.shared/scope.test.ts` | 3 files, under 1 s |

Routing rules:
- A change in `packages/protocol` runs protocol, db, kernel, tui and examples. They all import `@codecaine-ai/agent-kernel-protocol`.
- A change in `packages/db` runs db, kernel, tui and examples.
- A change in `packages/kernel` runs kernel, tui and examples.
- A change in `packages/protocol`, `packages/db` or `packages/kernel` can break other Core repos: `trace-viewer`, `observatory`, `canvas` and `docs-system` import them. Run the suites of those repos too.
- A change in `packages/` also runs `bun run test:boundaries`.
- A change only in `docs/`, `catalog/`, `prompts/` or `skills/` runs no tests, except a prompt change, which runs examples (prompt snapshots).

**Tier 3, before a big merge:** `bun run typecheck`, then every Tier 2 command in turn. `bun run test` and `bun run verify` skip protocol, db, examples outside the prompt snapshots, and `.archon`, so they are not the full suite.

**Keeper tests:** these are the only proof of a public contract. A prune must keep them, test by test. Run them all with:
`bun test ./scripts/check-package-boundaries.test.ts ./packages/protocol/src/ids.test.ts ./packages/db/src/upgrade.test.ts ./packages/db/src/read-compat.test.ts ./packages/kernel/src/index.test.ts ./packages/kernel/src/read-api-snapshots.test.ts ./examples/simple-research-kernel/src/agent-catalog/prompt-snapshots.test.ts`

| Contract | Keeper |
|---|---|
| No app-specific code or BAML loads under `packages/` | `scripts/check-package-boundaries.test.ts` |
| Deterministic event ids | `packages/protocol/src/ids.test.ts` |
| Schema upgrade of an old database; read-only handles | `packages/db/src/upgrade.test.ts`, `read-compat.test.ts` |
| `createKernel` public API | `packages/kernel/src/index.test.ts` |
| Read API shapes that trace-viewer and observatory read | `packages/kernel/src/read-api-snapshots.test.ts` |
| Prompt bytes of the example catalog | `examples/simple-research-kernel/src/agent-catalog/prompt-snapshots.test.ts` |

**Known failures on main:** none. Two BAML subprocess tests in `packages/kernel/src/model-nodes/baml-engine/` skip when the `.work/` spike is not built.

**Quarantine:** none. Each entry needs the test title, an owner and an expiry date.
