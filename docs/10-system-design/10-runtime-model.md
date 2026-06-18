---
covers: "Runtime model for the kernel: createKernel, spawn adapters, agent registry, context assembly, Pi session creation, run context, and subagents."
concepts: [runtime-model, create-kernel, spawn-pipeline, run-context, context-loader, subagents, pi-session]
code-ref: packages/kernel/src/index.ts, packages/kernel/src/spawn-pipeline/, packages/kernel/src/context/, packages/kernel/src/subagents/
depends-on: [../00-foundation/30-boundaries.md]
---

# Runtime Model

The runtime model is intentionally layered. The kernel owns the shape of a run, but the host app supplies app state, agent catalogs, tool factories, database access, and domain behavior.

---

## Shape

```text
Host app
  creates kernel instance
  provides spawn adapters and app-specific factories
        |
        v
@agent-kernel/kernel
  registry -> prompt resolver -> Pi session factory
  context builder -> run context -> turn trigger
  subagent manager can re-enter the same spawn path
        |
        v
Pi SDK
  owns the model turn loop and JSONL session output
```

## Kernel Instance

`createKernel(config)` creates an instance with:

- a stable kernel id
- per-kernel concurrency settings
- a `spawnAgent` adapter
- optional `AgentManager` creation
- runtime controls such as `setMaxBackgroundAgents()` and `dispose()`

The instance API lets apps run the kernel without relying on global singleton state.

## Spawn Pipeline

The full DB-backed spawn path lives in `packages/kernel/src/spawn-pipeline/spawn-agent.ts`. It requires an adapter bundle because the kernel does not know an app's catalog roots, tools, DB handle, or app session binding by itself.

The pipeline sequence is:

1. Resolve working directory and app session identity.
2. Load the parsed agent definition.
3. Resolve variables and render the system prompt.
4. Build or reuse a Pi session manager.
5. Load private and shared tool factories.
6. Create the Pi `AgentSession`.
7. Pre-insert Pi session and agent-run rows.
8. Emit system prompt and context lifecycle events.
9. Build and inject agent context when a resolver exists.
10. Subscribe to session events for streaming and turn limits.
11. Build `RunContext` and trigger the Pi turn.
12. Close the agent run and emit completion status.

## Run Context

`RunContext` is an async-local scope for one run. It carries kernel identity plus app-provided identity:

- `appSessionId`, `appSessionSlug`, `appSessionDir`
- `runId`, `parentRunId`, `agentName`
- `traceWriter`
- `piSessionsDir`, `workingDir`
- optional `stateManager`
- `piSessionUuid`, `containerId`, `phase`

The `stateManager` slot is app-provided. Spectre uses it for `SessionStateManager`; other apps can supply their own object or nothing.

## Context Assembly

The context builder gives an agent a typed `SpawnContext`, walks declared loaders through a `LoaderCatalog`, emits per-loader lifecycle events, and hands the loaded results to the agent's `assemble()` function.

Kernel base loaders are:

- `file`
- `directory`
- `skill`
- `command`
- `text`

Apps can register custom loaders by kind. A loader such as `checkpoint-slice` belongs in Spectre because it reads Spectre's workflow state.

## Subagents

The subagent manager coordinates foreground and background agent runs inside an active parent run. It owns:

- per-agent records
- background concurrency queue
- abort and stop behavior
- result delivery
- parent Pi session to child Pi session link markers
- `parentToolUseId` propagation

Subagent execution re-enters the same spawn adapter, so primary agents and subagents share the same runtime contracts.
