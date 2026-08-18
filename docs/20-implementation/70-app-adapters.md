---
covers: "Structural decisions for adapter and harness code: the package dependency direction, the adapter surface shape, tool and loader placement, sidecar import discipline, and harness packaging."
type: overview
concepts: [app-adapter, package-boundaries, adapter-surface, tool-sidecars, custom-loaders, host-portability, harness-packaging]
depends-on: [../10-system-design/50-app-adapter-model.md, ../10-system-design/70-harness-model.md, ../00-foundation/30-boundaries.md]
---

# App Adapters

Adapter code lives in host apps, not in this repo. In-repo reference shapes: `examples/simple-research-kernel/src` (app harness), `packages/tui` (terminal harness), `packages/core-harness` (this repo's own service leg). The boundary gate is `scripts/check-package-boundaries.ts`.

Behavior — what an adapter provides, container mapping, events, recovery, read API, viewer, model access — is governed by [10-system-design/50-app-adapter-model.md](../10-system-design/50-app-adapter-model.md); harness taxonomy and runtime constraints by [10-system-design/70-harness-model.md](../10-system-design/70-harness-model.md).

---

## Decisions

### Dependency direction

**Decision:** The package graph is one-way. App code imports `@agent-kernel/*` exports; kernel packages never import app code, reference app paths, or carry app loader/tool names. The direction is enforced by the boundary test, which any host app should mirror.

**Why:** The alternative — kernel-side hooks or registries that know app concepts — is how the original extraction site got entangled. A one-way graph keeps every kernel package portable to the next host without edits.

**Applies to:** `packages/*`, `scripts/check-package-boundaries.ts`, and all host-app adapter code, including apps not yet written.

### Adapter surface shape

**Decision:** A new host app builds a small adapter surface with app-owned names — a kernel-instance module (`createKernel` from one config object), a container-mapping seam, and an agent catalog directory — importing kernel package exports directly. It never copies Spectre's `apps/backend/src/agent-kernel/` tree.

**Why:** That Spectre tree is the extraction site: adapter code plus transitional re-export shims preserving old import paths, not kernel source. Copying it would propagate compatibility debt into a clean app. `examples/simple-research-kernel/src` (server + store + agent-catalog) is the shape to copy instead.

**Applies to:** every future host app; `examples/simple-research-kernel/src` as the reference.

### Tool placement

**Decision:** Tools for one agent live in that bundle's tools sidecar beside its manifest; tools shared across agents come from the `sharedTools` config slot; app capabilities reach sidecars only through the config `toolRuntime`.

**Why:** Colocated sidecars keep implementation, prompt, and manifest together, and the registry harvests tool names at boot so allowlists stay automatic. The rejected alternative — a central app tool registry — separates a tool from the one agent that uses it and hides the allowlist wiring.

**Applies to:** host-app agent catalogs, `catalog/`, `examples/simple-research-kernel/src/agent-catalog/`.

### Loader placement

**Decision:** A loader that reads app tables, app artifacts, or product workflow state lives in the host app and enters through the `loaders` config slot. The kernel's own loader catalog stays generic.

**Why:** App-aware loaders inside the kernel package would put app knowledge on the wrong side of the dependency direction. The slot keeps the extension point without the entanglement.

**Applies to:** host-app adapters (Spectre's `checkpoint-slice`, the example's working-memory loader), `packages/kernel`'s loader catalog.

### Sidecar import discipline (host portability)

**Decision:** The TUI extension's import graph and every `host:"any"` sidecar import deep, dependency-light kernel subpaths (e.g. `@agent-kernel/kernel/agent-registry/registry`) — never package barrels — and use no bun-only APIs (`bun:sqlite`, `Bun.*`, `import.meta.dir`).

**Why:** pi runs extensions and sidecars under Node via jiti. Barrel imports have broken real boots: the agent-registry barrel reaches `@agent-kernel/db` and therefore `bun:sqlite`, and a barrel pulling an incompatible typebox flavor at module load killed the extension. The rejected alternative — importing barrels and shimming the runtime — hides the breakage until a pi boot.

**Applies to:** `packages/tui/src`, `catalog/` sidecars, and any repo catalog shipping `host:"any"` bundles.

### Harness packaging

**Decision:** The terminal harness is a pi extension at `packages/tui` (exporting `./extension`); this repo's service leg is `packages/core-harness`; app harnesses live in their owning repos, not here.

**Why:** Folding either leg into `@agent-kernel/kernel` would drag pi-TUI or Elysia dependencies into the portable runtime package. The rejected alternative — a bespoke terminal front-end — duplicates the loop, streaming, and tools pi already provides.

**Applies to:** `packages/tui`, `packages/core-harness`, and any future harness leg added to this repo.

## Roster

- **Spectre** — `apps/backend/src/agent-kernel/*` in the Spectre repo; consumes the packages through its kernel submodule workspace.
- **simple-research-kernel** — in-repo reference app harness (`examples/simple-research-kernel`).
- **canvas-agent / prompt-kit-agent** — app harnesses in their sibling Core repos.
- **@agent-kernel/tui** — the terminal harness (`packages/tui`).
