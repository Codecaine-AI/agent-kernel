---
covers: "Context builder implementation: AgentContextResolver, SpawnContext, loader declarations, open loader catalog, base loaders, custom app loaders, and lifecycle events."
concepts: [context-builder, agent-context-resolver, spawn-context, loader-catalog, custom-loader, accumulation-guard]
code-ref: packages/kernel/src/context/
depends-on: [10-spawn-pipeline.md]
---

# Context Loaders

The context builder is the dynamic half of an agent prompt. It loads runtime data and hands it to an agent-owned assembler.

---

## Resolver Contract

An agent context sidecar exports:

```ts
interface AgentContextResolver {
  loaders: LoaderDeclaration[];
  assemble(loaded: LoadedMap, ctx: SpawnContext): string | Promise<string>;
}
```

`loaders` declares the inputs. `assemble()` decides how to render them into model-facing context.

## Spawn Context

`SpawnContext` carries:

- agent name
- caller variables
- caller identity
- runtime state (`cwd`, `containerId`, phase, session dir)
- paths
- optional app session data

The runtime state's `containerId` is the spawn's primary grouping identity — loaders that key work off the current grouping read it from `ctx`, not from a separate app-session id. `sessionData` is opaque to the kernel; the `createKernel` `appContext` slot and tests may prefill it to avoid duplicate DB reads or support synthetic sessions.

## Loader Catalog

`createLoaderCatalog()` creates an in-memory registry keyed by `kind`. Duplicate kinds fail at registration time. Unknown kinds fail at resolution time.

Base kernel loader kinds are:

- `file`
- `directory`
- `skill`
- `command`
- `text`

Apps register custom kinds. Spectre's `checkpoint-slice` is the reference custom loader because it reads Spectre-specific plan/build state.

Custom loader declarations require a `kind` and may carry loader-specific parameters. The kernel treats those parameters opaquely and passes the declaration to the registered loader.

## Lifecycle Events

The context builder emits:

- `context_build_started`
- `context_input_resolved` once per loader
- `context_build_completed`

These events make context debugging visible in the same trace stream as tool calls and messages.

## Accumulation Guard

The runtime injects rendered context as a custom message entry and checks for an existing entry by agent name. This prevents duplicate context blocks when a Pi session is reused.
