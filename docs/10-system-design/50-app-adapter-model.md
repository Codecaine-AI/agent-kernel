---
covers: "App adapter design: how host applications compose kernel packages while keeping workflow state, tools, loaders, routes, and panels app-owned."
concepts: [app-adapter, host-app, spectre-adapter, custom-loader, custom-tool, package-linking]
depends-on: [../00-foundation/30-boundaries.md, 10-runtime-model.md, 40-viewer-model.md]
---

# App Adapter Model

An app adapter turns the generic kernel into a product-specific agent system. It should be explicit, testable, and mostly one-way: app code can depend on kernel packages, but kernel packages must not depend on app code.

---

## Adapter Responsibilities

An app adapter typically provides:

- kernel instance configuration (`createKernel` config: catalog roots, db handle, model aliases and prices, tool profiles)
- app domain to kernel container mapping (kind + key vocabulary)
- shared tool factories and an app tool runtime for private sidecars
- custom context loaders
- run-context app state through `appContext`
- app-specific event emission through the trace writer
- read API mount and response mapping
- viewer plugins and custom payload renderers

## Spectre Reference Mapping

| Kernel Concept | Spectre Adapter Mapping |
|---|---|
| Container | Spectre session/workflow grouping, with app state kept in Spectre tables |
| Container kind + key | Spectre session id mapped through `kernel.container({ kind: "session", key })` |
| Phase label | `spec`, `plan`, `build`, `docs`, or other Spectre workflow labels |
| Custom loader | `checkpoint-slice`, which reads Spectre plan/build state |
| App state manager | `SessionStateManager` passed through run context |
| Domain tools | Spectre tools that mutate spec, plan, build, docs, projects, or asks |
| Viewer plugin | Spectre session header and phase-specific panels |

## Repo Split Implication

The standalone kernel repository is the source of truth for `@agent-kernel/*` packages. A host app can consume it as a workspace submodule during active development, or as published package versions once contracts stabilize.

The package graph should not change:

```text
Spectre apps -> @agent-kernel/* packages
@agent-kernel/* packages -> no Spectre imports
```

That graph is the important contract. Git topology is the delivery mechanism.

## Spectre Compatibility Note

Spectre still has backend files named `apps/backend/src/agent-kernel/*` because the kernel was extracted from that path. In the current split, those files are app adapter code and compatibility shims around the standalone packages, not the portable kernel source of truth.

A new app should not recreate the Spectre backend tree. It should create a small app-specific adapter and import kernel package exports directly. The implementation guide for that setup lives in [20-implementation/70-app-adapters/10-application-setup.md](../20-implementation/70-app-adapters/10-application-setup.md).
