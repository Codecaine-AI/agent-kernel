---
covers: "Current and intended package linking model between Spectre's local workspace packages and the standalone pi-agent-kernel repository."
concepts: [package-linking, workspace, monorepo, repo-split, submodule, private-registry, spectre]
depends-on: [../../00-foundation/20-principles.md, ../70-app-adapters/00-overview.md]
---

# Package Linking

There are two states to keep distinct: the current local extraction state and the intended externalized state.

---

## Current State

Spectre still has local `packages/*` workspace packages with the same package names:

- `@agent-kernel/protocol`
- `@agent-kernel/db`
- `@agent-kernel/kernel`
- `@agent-kernel/viewer-core`
- `@agent-kernel/viewer-ui`
- `@agent-kernel/viewer-shell`

Spectre's root `package.json` includes:

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

So Spectre apps import the local in-Spectre packages through `workspace:*`.

The standalone `pi-agent-kernel` repo is currently a clean seed of those packages. Spectre is not yet consuming the standalone repo.

## Why Both Exist Right Now

The local package split came first because it let Spectre keep running while the boundaries were enforced. The standalone repo was then created as the target home for the kernel packages.

That means there is temporary duplication. It should not stay that way long term.

## Intended Source Of Truth

Once the next split step starts, `pi-agent-kernel` should become the source of truth for `@agent-kernel/*`.

Spectre should stop owning separate copies of those packages and consume them by one of these mechanisms:

| Mechanism | When To Use |
|---|---|
| Git submodule workspace | Best next step while APIs are still changing and both repos need local development |
| Private registry packages | Best later step after the package API stabilizes |
| Git dependency | Possible bridge, but less ergonomic for multi-package workspace development |

## Recommended Next Step

Use a git submodule first.

Sketch:

```text
Spectre/
  apps/
  packages/
    pi-agent-kernel/        git submodule -> Codecaine-AI/pi-agent-kernel
      packages/
        protocol/
        db/
        kernel/
        viewer-core/
        viewer-ui/
        viewer-shell/
```

Then update Spectre root workspaces to include the submodule packages:

```json
{
  "workspaces": [
    "apps/*",
    "packages/pi-agent-kernel/packages/*"
  ]
}
```

At that point, Spectre apps can keep importing `@agent-kernel/*` with `workspace:*`, but the code comes from the standalone repo.

## Later Registry Model

After the package contracts stabilize, publish the packages to a private registry and replace `workspace:*` in Spectre app packages with pinned versions.

That future shape is cleaner for consumers but worse while the API is still changing quickly.
