---
covers: "Implementation overview of the kernel monorepo: the package map, the structural decisions that govern it, and the per-area implementation records."
type: overview
concepts: [implementation, packages, protocol, db, kernel, prompt-system, read-api, viewer, dependency-direction, workspace-linking]
depends-on: [../10-system-design/00-overview.md]
---

# Implementation Overview

This repository is a Bun workspace containing the portable kernel packages extracted from Spectre. This page records the structural decisions that govern the workspace — how the packages are organized and why — so additions conform. Behavior and schemas live in [system design](../10-system-design/00-overview.md); dev commands live in the repo [README](../../README.md).

---

## Package Map

```text
packages/
  protocol/      Trace event envelope, event catalog, factories, deterministic ids
  db/            Per-kernel SQLite store, schema (+ pg mirror), manifest, query helpers
  kernel/        Kernel instance, containers, spawn runtime, emitter, registry,
                 context, agent state, subagents, doctor, read API,
                 transcript recovery
  prompt-kit/    Prompt document model, canonicalization/hash, renderers (sibling repo / Core workspace member)
  viewer-core/   Read/catalog API DTOs, trace span transforms, prompt diff
  viewer-ui/     Trace tree, detail, and prompt lab UI components
  viewer-shell/  Mountable KernelTraceViewer shell
```

## Decisions

### Dependency direction

**Decision.** Packages layer one way: `protocol` at the base; `db` and `viewer-core` depend only on it; `viewer-ui` depends on `viewer-core`; `viewer-shell` on `viewer-ui`; `kernel` depends on `protocol`, `db`, and `viewer-core` for runtime/read contracts. No kernel package imports Spectre packages, Spectre paths, or Spectre naming; apps consume the kernel through package exports and adapters, never through package internals.

**Why.** The protocol is the shared vocabulary, so everything meets there; one-way layering keeps the viewer embeddable without the runtime and the kernel free of UI dependencies. The rejected alternative — letting the kernel reach into viewer packages, or hosts import internals directly — is how Spectre's original entanglement happened and what the extraction undid.

**Applies to.** `packages/*`, `scripts/check-package-boundaries.ts`, and any future package added to the workspace.

### Package source of truth

**Decision.** This repository is the sole source of the `@agent-kernel/*` packages. Consumers link them as workspace members (Core's `agent-kernel/packages/*` plus `examples/*`) or as a git-submodule workspace (Spectre's `packages/pi-agent-kernel/packages/*`) with `workspace:*` dependencies. No consumer keeps local copies.

**Why.** The extraction left Spectre with a parallel in-app copy of every package; two copies under one name drift immediately, and the boundary tests guard only one of them. Vendoring per host — the rejected alternative — is how Spectre's compat-shim debt accumulated.

**Applies to.** `packages/*`, consumer workspace manifests (Spectre root `package.json`, Core root `package.json`), and any future host linking the kernel.

### Consumption mechanism progression

**Decision.** While package contracts are unstable, consumption is linked workspace source (submodule or meta-workspace member) with `workspace:*`. Published, version-pinned registry packages replace `workspace:*` only after the APIs stabilize.

**Why.** Registry pinning during churn forces a publish per cross-repo change; linked source keeps multi-repo development live. Publishing to a private registry now was considered and rejected.

**Applies to.** The publishing state of `packages/*` and every consumer dependency on `@agent-kernel/*`.

## Child Nodes

### [10-protocol.md](10-protocol.md)
Area page for `packages/protocol`: trace protocol types and event factories.

### [20-kernel/](20-kernel/00-overview.md)
Runtime package: kernel instance, containers, registry, spawn pipeline, emitter, context, agent state, subagents, run context, doctor, transcript recovery.

### [30-db.md](30-db.md)
Area page for `packages/db`: SQLite client, kernel manifest, and schema/query helpers.

### [40-prompt-system.md](40-prompt-system.md)
Structural decisions for the prompt system's code layout across `packages/kernel` and agent bundles.

### [50-read-api.md](50-read-api.md)
Area page for the kernel read API consumed by viewer-core.

### [60-viewer/](60-viewer/00-overview.md)
The viewer packages: DTOs and transforms, the tree/card/detail surface, and the workspace shell.

### [70-app-adapters.md](70-app-adapters.md)
How host apps such as Spectre connect domain state to kernel packages.
