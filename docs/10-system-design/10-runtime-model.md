---
covers: "Runtime model for the kernel: createKernel config, the agent bundle and registry, spawn pipeline, run context, context assembly, the agent state model and three-section requests, variants and model aliases, and subagents."
concepts: [runtime-model, create-kernel, agent-bundle, agent-registry, spawn-pipeline, run-context, context-loader, agent-state, state-module, window-policy, context-set, three-section-request, subagents, spawner-tools, pi-session, variants, model-aliases, tool-profiles]
code-ref: packages/kernel/src/index.ts, packages/kernel/src/agent-registry/, packages/kernel/src/spawn-pipeline/, packages/kernel/src/context/, packages/kernel/src/state/, packages/kernel/src/subagents/
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
  context builder -> state extension -> run context -> emitter -> turn trigger
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
- `piSessionsDir`, `piAgentDir`, `defaultUserId`, `concurrency`, `createSessionBinding`, `stateRoot`, `logger`

Injected functions remain only for genuinely app-shaped slots (`appContext`, `loaders`, `sharedTools`, `createSessionBinding`); everything else is data.

The instance exposes `spawnAgent`, `container()` (deterministic container upsert), `agentManager`, `traceWriter`, `readApiService`, `registry()`, `doctor()`, `setMaxBackgroundAgents()`, and `dispose()`. The `createSpawnAgent` adapter bundle is no longer a public surface.

## The Agent Bundle

An agent is a directory discovered by its `agent.json` manifest. The bundle has four sections beside the manifest — a prompt, and optional context, tools, and state sidecars — and the bundle mirrors the request: prompt is section ①, context is section ②, state is section ③, and tools are the action surface between them. A base agent is `agent.json` plus a prompt; the absence of the other sections is the statement that it is a plain windowed agent. On-disk layout rules (file-or-folder section forms, file-first resolution, D98) are implementation structure: [20-kernel/00-overview.md](../20-implementation/20-kernel/00-overview.md).

The manifest is pure data: name, description, model (an id or a kernel-config alias), thinking, turn limits, core tools, tool profiles, variables, an optional `state` block, and named `variants`. There is no code entry point and no Markdown/frontmatter path — the manifest file itself is the registry entry, JSON-Schema validated. (`canSpawnSubagent` is retired: spawning is granted per tool, D77.)

`prompt.json` is the canonical prompt artifact (a prompt-kit `PromptDocument`) and the source of truth. The registry validates it, renders it to XML-tagged Markdown, and computes its content hash (`pk1-<sha256>` over the canonical bytes). The rendered markdown beside it is a committed *generated* snapshot — never hand-edited, never parsed by the registry — so PR diffs show the behavioral contract in the format the model receives.

## The Registry

The registry turns the catalog into validated runtime definitions. `createKernel` builds it from `catalog.roots` on first use and caches it. A root is either a plain path (listed by default) or `{ path, listed: false }`; an unlisted root still participates in validation, prompt-revision registration, direct detail lookup, prompt editing, and spawn-by-name — it is omitted only from browse-oriented agent lists, because the flag controls discovery, not authorization.

Each bundle normalizes into a parsed agent: config, rendered prompt body, and `promptHash`. The `tools` allowlist is fully expanded at boot: manifest `coreTools`, tool profiles expanded from the kernel-config profile map, and harvested private tool names. At boot the registry also upserts one `prompt_revisions` row per agent, keyed by content hash, so re-booting an unchanged catalog is a no-op — and the spawn pipeline later stamps the same hash onto the session, closing the loop between authored prompts and observed runs.

Registry boot fails with an aggregate of per-agent errors — unparseable manifests or prompts, prompt validation errors, variable drift, unknown tool profiles, spawner tools naming agents missing from the catalog (D77), name collisions, malformed sidecar exports. The goal is for broken agent definitions to fail at boot, not halfway through a user run.

## Spawn Pipeline

The pipeline sequence is:

1. Resolve working directory; require `containerId` (from options or the parent run context).
2. Resolve the run `trigger`: explicit option, else `parent-tool` when `parentToolUseId` is set, else `operator`.
3. Resolve the agent config through the registry — applying the selected `variant` and resolving model aliases.
4. Resolve variables and render the static system prompt from the prompt revision.
5. Create the state extension when the bundle activates one (see State Model below); otherwise nothing is registered and the session stays pass-through.
6. Build or reuse a Pi session manager; write the session-binding marker (always carrying `containerId` + `runId`).
7. Load private and shared tool factories.
8. Create the Pi `AgentSession` (the state extension's factory rides in the extension list and is bound to the live session).
9. Pre-insert the Pi session row (stamping `prompt_hash` and the resolved model) and the agent-run row (with `trigger`).
10. Attach the in-process kernel emitter and the per-turn request-snapshot recorder, which map live session events to protocol events with identity from the run context.
11. Emit `system_prompt_resolved` (carrying `prompt_hash`) and context lifecycle events; build and deliver agent context when a resolver exists.
12. Subscribe to session events for streaming and turn limits.
13. Build `RunContext` and trigger the Pi turn.
14. Close the agent run — recording the outbound event, run status, and usage rollup — emit `agent_run_end`, and flush the snapshot recorder and the state sink.

The pipeline creates DB rows before emitting run events or triggering the Pi turn, so every later event can refer to existing session and run records. That ordering is the difference between a runnable agent helper and a debuggable kernel runtime.

System prompts are frozen at Pi session creation time — which is why `prompt_hash` binds to the session, not the run.

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

The context builder is the reference half of an agent request: it loads runtime data and hands it to an agent-owned assembler. A context sidecar exports:

```ts
interface AgentContextResolver {
  loaders: LoaderDeclaration[];
  assemble(loaded: LoadedMap, ctx: SpawnContext): string | Promise<string>;
}
```

`loaders` declares the inputs; `assemble()` decides how to render them into model-facing context. `SpawnContext` carries the agent name, caller variables and identity, runtime state (`cwd`, `containerId`, phase, session dir), paths, and optional app session data. Its `containerId` is the spawn's primary grouping identity — loaders that key work off the current grouping read it from `ctx`, not from a separate app-session id. `sessionData` is opaque to the kernel; the `appContext` config slot and tests may prefill it to avoid duplicate DB reads or support synthetic sessions.

The loader catalog is an in-memory registry keyed by `kind`: duplicate kinds fail at registration time, unknown kinds fail at resolution time. Kernel base loader kinds are `file`, `directory`, `skill`, `command`, and `text`. Apps register custom kinds through the `loaders` config slot; declarations beyond `kind` are loader-specific parameters the kernel passes through opaquely. A loader that reads app workflow state belongs in the app.

The builder emits `context_build_started`, `context_input_resolved` (once per loader), and `context_build_completed`, so context debugging is visible in the same trace stream as tool calls and messages.

Delivery depends on the state extension (D82, decided in [60-prompt-system-model.md](60-prompt-system-model.md)):

- **State extension active** — built context lands as the entry `agent-context:<name>` in the kernel-held context set and is rebuilt into section ② on every request. Nothing is pinned to history.
- **Pass-through agent** — built context is injected once as an `agent-context` custom message into the transcript, guarded by agent name so reusing a Pi session cannot duplicate context blocks.

Assembled context is *reference* material. The dynamic working picture and the conversation window are section ③, produced by the state model below; loaders that deliver working state rather than reference material retire into state as agents adopt the sidecar (D81–D84, [60-prompt-system-model.md](60-prompt-system-model.md)).

## State Model

The state layer implements D81–D92 ([60-prompt-system-model.md](60-prompt-system-model.md)): one state object per agent, the messages are part of it, and every provider request is three sections — ① system prompt (Pi's), ② context, ③ state plus conversation tail — with the kernel building ② and ③.

### Activation

The state extension activates only when the bundle ships a state sidecar **or** the manifest declares a `state.window` block. Otherwise the extension is never registered and the session behaves exactly as it did before the state layer existed — the pass-through guarantee. "Base agent" is not a code path: an agent with neither runs no state code at all. An agent with window config but no sidecar gets the base module — bookkeeping counters plus a rolling-window renderer, with nothing in the request derived from the counters.

### The Contract

The state sidecar exports a `StateModule<S>` (`defineState` is the typed identity helper):

```ts
seed(ctx: SpawnContext, prior?: S): S;
update(state: S, event: SessionEvent): S;
render(state: S, ctx: RenderContext): RenderOutput;
window?: WindowPolicy;      // the module's own default; manifest/spawn config wins
```

`S` is the agent's own type; the kernel never inspects it. It must be JSON-serializable because it snapshots to `state.json`. `render` may return a bare message array (every message counts as tail) or `{ messages, stateMessageCount }` — the leading `stateMessageCount` messages are section ③'s state block(s), the rest is the conversation tail. `RenderContext` carries the agent name, optional `containerId`, `messages` (the array Pi is about to send — renderers window over it rather than duplicating it into `S`), `turnIndex`, and the resolved window policy.

`seed` receives the same `SpawnContext` the context loaders get — the pipeline builds it once and hands it to both (D87).

### Session Events

`SessionEvent` is a four-member union, kernel-owned and deliberately small:

| Kind | Derived from | Payload beyond the base fields |
|---|---|---|
| `user_message` | a `user` transcript message | `text` (flattened), `imageCount` |
| `tool_call` | each `toolCall` block of an `assistant` message | `toolCallId`, `toolName`, `input` |
| `tool_result` | a `toolResult` message | `toolCallId`, `toolName`, `isError`, `text`, `imageCount` |
| `turn_end` | Pi's blocking `turn_end` hook | `turnIndex`, optional `stopReason` |

Every event carries `seq` (monotonic within one extension instance), `messageIndex`, and `timestamp`. `custom`, `bashExecution`, `branchSummary`, and `compactionSummary` messages produce no events — transcript furniture, not state input. `turn_end` is hook-derived and cannot be reconstructed from the transcript by design: turn boundaries belong to the kernel, not the message log.

Catch-up is idempotent by construction: the extension folds every message from a single cursor to the end of the array, then advances the cursor. Re-running when nothing new landed folds nothing; catch-up before a request build is the same call, with no dedupe bookkeeping to get wrong; if the array *shrank* (fork / tree navigation), the cursor re-anchors rather than re-folding history the state already contains. Every extension handler is wrapped: on error it logs and continues, and the request-build hook falls back to sending the request untouched rather than failing the turn. Compaction is disabled on kernel sessions; nothing here compacts.

### Windows

Two strategies ship: `turns` (keep the last `maxTurns` turns) and `token-budget` (walk newest → oldest, keeping turns until `maxTokens` would be exceeded; the newest turn always survives). The invariant that is *not* configurable: **cuts land only on turn boundaries** — a turn never closes while a `toolCall` is unanswered, and every strategy returns a turn index, so a tool call and its result can never be split.

Defaults are tuning-open first-pass numbers, not measured optima: `strategy: "turns"`, `maxTurns: 8`, `maxTokens: 60000`, `charsPerToken: 4`, `imageTokens: 1600`, `maxImages: 4` (newest-K image cap; `null` keeps all), `elisionMarker: true` (emit `[turns 1–N elided]` when history was cut). Images beyond the cap inside the surviving window become one-line text stubs before whole turns drop.

Window-policy precedence is spawn option → manifest `state.window` → the module's own `window` → the kernel default.

### The Context Set (Section ②)

The kernel holds an id → entry map rendered into **one** kernel-authored message per request, `<context>` … `</context>`, entries in `order` then insertion order, each optionally wrapped in its own XML tag. Re-adding the same id replaces the entry in place and keeps its position, so a skill can be swapped without reordering the message; removing an id drops it. When the set is empty, section ② is omitted. Nothing is pinned to history — the point of D82.

### Kernel-Authored Messages

The synthetic lines in a built request — the ② context message and whatever the ③ renderer emits around the tail — are not things the user said, but they must reach the provider as valid user turns. They travel down Pi's custom-message channel with a `kernel:`-prefixed marker that survives into the request snapshot, so the viewer can badge them KERNEL rather than USER (D99). The marker is part of the wire contract: [30-event-protocol.md](30-event-protocol.md).

### Three-Section Assembly

The builder concatenates ② then ③ and reports boundaries as half-open `[start, end)` ranges over the returned message list — `context` (present only when the set rendered a message), `state` (the leading `stateMessageCount` messages), and `tail` (everything after). Empty sections are omitted, sections are emitted in order and never overlap, and section ① never appears in the list because the system prompt is Pi's, captured separately by the snapshot recorder. A built request's section ranges stamp straight onto its request snapshot ([20-observability-model.md](20-observability-model.md)).

### Persistence

State snapshots to `<root>/.agent-kernel/state/<containerId>/<agentName>/state.json` (v1 snapshot-only persistence, D88). The written snapshot carries `containerId`, `agentName`, optional `runId`, a 1-based `version` incremented per snapshot within one extension instance, `updatedAt`, and the opaque `state`. Persistence is **default-ON**: a spawn whose state extension is active always snapshots; spawn options (`stateRoot`, `stateSink`) choose *where*, never *whether*. A pass-through agent has no state extension and therefore writes nothing at all. Nothing auto-loads a snapshot — a caller passes `priorState` explicitly to `seed` (D87). Path segments are sanitized because container ids and agent names are external input.

## Subagents

Spawning is granted per tool, not per agent (D77): a `tools.ts` sidecar declares a spawner tool with an explicit `spawns` allowlist of agent names (`["*"]` is the loud general opt-in), and the kernel injects a scoped `dispatch(agentName, prompt, opts?)` handle at session build time. There is no agent-level spawn permission flag, and the generic Pi subagent tools are disallowed for every kernel agent.

The dispatch handle enforces the allowlist, validates the target exists in the catalog (a wildcard spawner cannot turn a typo into a silently errored record), and auto-forwards `parentToolUseId`, `trigger: "parent-tool"`, and run-context identity — captured at dispatch time and passed explicitly, so a queued background spawn keeps its own parent's identity no matter when, or from whose async context, the queue drains. The tool author cannot get these wrong.

The subagent manager coordinates foreground and background agent runs inside an active parent run. Foreground dispatch awaits completion and resolves with the agent record. Background dispatch resolves immediately with a handle whose `done` promise always exists and resolves with the final record when the child actually completes — including queued children, which have no record promise until they start, and queued children aborted before starting. Background work enters a FIFO queue when the concurrency limit (default 4, adjustable on the kernel instance) is reached. The manager also owns abort and stop behavior, result delivery, parent-to-child Pi session link markers, and `parentToolUseId` propagation.

Callers can steer a subagent before its session exists: the manager stores steering messages and flushes them once the session is created. Steering is a control action, so it is observable — each steering message emits exactly one `run_steered` trace event, with `delivery: "delivered"` for a live session or `delivery: "queued"` for a held message; queued emissions wait for the run's trace identity and flush with it.

Subagent execution re-enters the same spawn path with inherited identity: the parent's `containerId`, `parentRunId`, and a `parent-tool` trigger. Primary agents and subagents share the same runtime contracts.
