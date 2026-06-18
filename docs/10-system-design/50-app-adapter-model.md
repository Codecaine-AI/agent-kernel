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

- kernel instance configuration
- spawn adapters and DB handles
- app session to kernel container mapping
- agent catalog roots
- shared tool factories
- private tool sidecar loading
- custom context loaders
- run-context app state
- app-specific event emitters
- tailer watch paths and custom marker names
- read API mount and response mapping
- viewer plugins and custom payload renderers

## Spectre Reference Mapping

| Kernel Concept | Spectre Adapter Mapping |
|---|---|
| Container | Spectre session/workflow grouping, with app state kept in Spectre tables |
| App session identity | Spectre session id, slug, and session directory |
| Phase label | `spec`, `plan`, `build`, `docs`, or other Spectre workflow labels |
| Custom loader | `checkpoint-slice`, which reads Spectre plan/build state |
| App state manager | `SessionStateManager` passed through run context |
| Domain tools | Spectre tools that mutate spec, plan, build, docs, projects, or asks |
| Viewer plugin | Spectre session header and phase-specific panels |

## Repo Split Implication

The adapter boundary should be stable before the repository boundary becomes the source of truth. During extraction, it is acceptable for Spectre to keep local workspace packages. After the split, Spectre should consume the standalone kernel repo either as a submodule workspace or as published packages.

The package graph should not change:

```text
Spectre apps -> @agent-kernel/* packages
@agent-kernel/* packages -> no Spectre imports
```

That graph is the important contract. Git topology is the delivery mechanism.
