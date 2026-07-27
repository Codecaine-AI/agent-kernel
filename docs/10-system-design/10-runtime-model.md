---
covers: "Runtime model for the kernel: createKernel config, the agent bundle, spawn pipeline, run context, context assembly, variants and model aliases, and subagents."
concepts: [runtime-model, create-kernel, agent-bundle, spawn-pipeline, run-context, context-loader, subagents, pi-session, variants, model-aliases, tool-profiles]
code-ref: packages/kernel/src/index.ts, packages/kernel/src/spawn-pipeline/, packages/kernel/src/context/, packages/kernel/src/subagents/
depends-on: [../00-foundation/30-boundaries.md, 15-identity-model.md]
---

# Runtime Model

The runtime model is intentionally layered. The kernel owns the shape of a run, but the host app supplies app state, agent catalogs, tool runtimes, database access, and domain behavior.

---

## Shape

```text
Host app
  createKernel(config) — one config object, no adapter bundle
        |
        v
@agent-kernel/kernel
  registry -> prompt resolver -> Pi session factory
  context builder -> run context -> emitter -> turn trigger
  subagent manager re-enters the same spawn path
        |
        v
Pi SDK
  owns the model turn loop and JSONL session output
```

## Kernel Instance

`createKernel(config)` absorbs what used to be a separate eight-adapter spawn bundle. The config carries:

- `id` — stable kernel id (namespaces container derivation)
- `db` — kernel SQLite database handle (`openKernelDatabase` from `@agent-kernel/db`)
- `catalog.roots` — directories scanned for `agent.json` bundles at first use
- `models.aliases` — model aliases resolved at spawn; `models.prices` — per-model price table powering cost estimates
- `toolProfiles` — named tool bundles referenced by manifest `toolProfiles`
- `loaders` — app context loaders registered into the default loader catalog
- `sharedTools` — extension factories appended to every spawned session
- `toolRuntime` — runtime handle passed to each agent's private `tools.ts` register function
- `appContext` — per-spawn app injection (state manager / session data)
- `piSessionsDir`, `piAgentDir`, `defaultUserId`, `concurrency`, `createSessionBinding`, `logger`

Injected functions remain only for genuinely app-shaped slots (`appContext`, `loaders`, `sharedTools`, `createSessionBinding`); everything else is data.

The instance exposes `spawnAgent`, `container()` (deterministic container upsert), `agentManager`, `traceWriter`, `readApiService`, `registry()`, `doctor()`, `setMaxBackgroundAgents()`, and `dispose()`. The `createSpawnAgent` adapter bundle is no longer a public surface.

## The Agent Bundle

An agent is a directory discovered by its manifest:

```text
agent-catalog/<agent-name>/
  agent.json                              manifest: data, JSON-Schema validated (agent-kernel/agent-v1)
  prompt.json    | prompt/prompt.json     canonical PromptDocument (content-addressed)
  prompt.rendered.md | prompt/system.md   generated markdown render — do not edit
  context.ts     | context/index.ts       optional context sidecar
  tools.ts       | tools/index.ts         optional private-tools sidecar
  state.ts       | state/index.ts         optional state sidecar
```

Each section has two legal shapes — a single file, or a folder with an `index.ts` entry point — resolved file-first (D98). The bundle mirrors the request: prompt is section ①, context is section ②, state is section ③, and tools are the action surface between them. A base agent is `agent.json` plus a prompt; the absence of the other sections is the statement that it is a plain agent. Resolution details: [20-agent-registry.md](../20-implementation/20-kernel/20-agent-registry.md).

The manifest declares name, description, model (an id or a kernel-config alias), thinking, turn limits, core tools, tool profiles, variables, and named `variants`. `defineAgent` survives as a validator/normalizer helper for tooling that constructs manifests programmatically.

## Spawn Pipeline

The pipeline sequence is:

1. Resolve working directory; require `containerId` (from options or the parent run context).
2. Resolve the run `trigger` (`operator` by default, `parent-tool` when spawned from a tool call).
3. Resolve the agent config through the registry — applying the selected `variant` and resolving model aliases.
4. Resolve variables and render the static system prompt from the prompt revision.
5. Build or reuse a Pi session manager; write the session-binding marker (always carrying `containerId` + `runId`).
6. Load private and shared tool factories.
7. Create the Pi `AgentSession`.
8. Pre-insert the Pi session row (stamping `prompt_hash` and the resolved model) and the agent-run row (with `trigger`).
9. Attach the in-process kernel emitter, which maps live session events to protocol events with identity from the run context.
10. Emit `system_prompt_resolved` (carrying `prompt_hash`) and context lifecycle events; inject agent context when a resolver exists.
11. Subscribe to session events for streaming and turn limits.
12. Build `RunContext` and trigger the Pi turn.
13. Close the agent run — recording the outbound event, run status, and usage rollup — and emit `agent_run_end`.

## Run Context

`RunContext` is an async-local scope for one run:

- `containerId` (required), `runId`, `trigger`
- `agentName`, `parentRunId`, `agentId`
- `traceWriter`
- `sessionDir`, `piSessionsDir`, `workingDir`
- optional `stateManager` (app-provided)
- `piSessionUuid`, `userId`, `phase`

Emit sites build envelope identity through `currentTraceIds()` / `traceIdsOf()` — never by hand. The kernel stamps `containerId` and `runId` onto every event from this scope, so adapters cannot mislabel identity.

## Variants, Aliases, Tool Profiles

`spawnAgent(name, prompt, ctx, { variant })` selects a named variant from the manifest — a sanctioned per-spawn override of model, thinking, turn limits, background behavior, or display label. Model strings (from the manifest or a variant) resolve through `models.aliases` at spawn; the *resolved* model lands on the session row and in turn usage, so fleet-wide retargeting is one config edit and cost attribution stays truthful. Manifest `toolProfiles` expand into tool allowlists from the kernel-config profile map at registry boot.

## Context Assembly

The context builder gives an agent a typed `SpawnContext`, walks declared loaders through a `LoaderCatalog`, emits per-loader lifecycle events, and hands the loaded results to the agent's `assemble()` function.

Kernel base loaders are `file`, `directory`, `skill`, `command`, and `text`. Apps register custom loaders through the `loaders` config slot; a loader that reads app workflow state belongs in the app.

Scope note — superseded by D81–D84 (`explainers/state-shapes.html` v4): assembled context is the *reference* section of a request (section ②), rebuilt per request rather than injected once. The dynamic working picture and the conversation window move to section ③, produced by an agent's optional `state.ts` sidecar (`seed`/`update`/`render`). Loaders that today deliver working state — not reference material — retire into state as agents adopt the sidecar.

## Subagents

Spawning is granted per tool, not per agent (D77): a `tools.ts` sidecar declares a spawner tool with an explicit `spawns` allowlist of agent names (`["*"]` is the loud general opt-in), and the kernel injects a scoped `dispatch` handle at session build time. There is no agent-level spawn permission flag.

The subagent manager coordinates foreground and background agent runs inside an active parent run. It owns per-agent records, the background concurrency queue, abort and stop behavior, result delivery, parent-to-child Pi session link markers, and `parentToolUseId` propagation.

Subagent execution re-enters the same spawn path with inherited identity: the parent's `containerId`, `parentRunId`, and a `parent-tool` trigger. Primary agents and subagents share the same runtime contracts.
