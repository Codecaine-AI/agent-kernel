---
covers: "Spawn pipeline implementation: kernel config resolution, container/trigger identity, system prompt resolution, Pi session creation, DB pre-insert, in-process emitter, context injection, run context, and turn trigger."
concepts: [spawn-pipeline, create-kernel, pi-session, kernel-emitter, run-context, run-trigger, db-preinsert, context-injection, prompt-hash]
code-ref: packages/kernel/src/spawn-pipeline/spawn-agent.ts, packages/kernel/src/spawn-pipeline/pi-session-factory/, packages/kernel/src/spawn-pipeline/session/, packages/kernel/src/emitter/
depends-on: [00-overview.md, 30-context-loaders.md]
---

# Spawn Pipeline

The spawn pipeline executes one agent prompt through Pi. `createKernel(config)` assembles it internally; `kernel.spawnAgent()` is the public entry.

---

## Config, Not Adapters

The pipeline used to take an eight-adapter bundle. Those slots are now kernel config:

| Former adapter | Now |
|---|---|
| `loadAgent` / `loadAgentResolver` | registry built from `catalog.roots`, variant + model-alias resolution via `resolveSpawnConfig` |
| `buildPrivateRegisterFactory` | registry `tools.ts` sidecars bound to config `toolRuntime` |
| `buildToolFactories` | config `sharedTools` |
| `createContextCatalog` | default catalog + config `loaders` |
| `createSpawnContext` | config `appContext` (state manager / session data injection) |
| `getDb` | config `db` |
| `createAppSessionBinding` | config `createSessionBinding` (default marker: `agent-kernel:session-binding`; the pipeline always merges `containerId` + `runId` into the payload) |
| `logger` | config `logger` |

Private tools live in the agent bundle's tools sidecar — `tools.ts`, or `tools/index.ts` in a folder-form bundle — and attach by convention. The registry harvests private tool names at boot and includes them in the expanded tool allowlist.

## Sequence

1. Resolve `cwd` from `opts.workingDir` or parent Pi context.
2. Require `containerId` — from `opts.containerId` or the parent run context; derive one with `kernel.container({ kind, key })`.
3. Resolve the run `trigger`: explicit option, else `parent-tool` when `parentToolUseId` is set, else `operator`.
4. Resolve the agent config (variant overrides + model aliases applied).
5. Resolve variables and render the static system prompt.
6. Create the state extension — only when the bundle ships a `state.ts` sidecar or a `state.window` block ([60-agent-state.md](60-agent-state.md)); otherwise nothing is registered and the session stays pass-through.
7. Build or reuse a Pi session manager; write the session-binding marker.
8. Load context and private tool bindings; build the scoped tool factory list.
9. Create a Pi `AgentSession` (the state extension's factory rides in `extensionFactories`, and the handle is bound to the live session).
10. Pre-insert `pi_agent_sessions` (with `prompt_hash` and the resolved model) and `agent_runs` (with `trigger`).
11. Attach the in-process kernel emitter and the per-turn request-snapshot recorder ([70-request-snapshots.md](70-request-snapshots.md)); with a state extension present, the recorder captures the builder's request instead of the raw transcript.
12. Emit `system_prompt_resolved` carrying `prompt_hash`.
13. Build context. With the state extension active it becomes an `agent-context:<name>` entry in the context set (section ②, rebuilt per request); otherwise it is injected as one `agent-context` custom message as before.
14. Subscribe to Pi session events for streaming and turn limits.
15. Build async-local `RunContext`; emit `agent_run_start`.
16. Trigger the Pi turn.
17. Update run status, record the outbound event and usage rollup, and emit `agent_run_end`; flush the snapshot recorder and the state sink.

## In-Process Emitter

The emitter (`packages/kernel/src/emitter/`) is the primary trace path. It subscribes to the live Pi session stream and maps user/assistant messages, tool call start/end, and turn start/end (with `TurnUsage`) to protocol events, stamped with identity from the run context.

Event ids are the deterministic ids from `@agent-kernel/protocol` `ids.ts`: the emitter recovers each JSONL entry id at emit time so its ids are identical to what the backfill mapper would derive — a later backfill of the same session inserts zero duplicate rows. When an entry id cannot be verified, it falls back to a deterministic live-stream id (never random) and logs a warning. Per-turn usage feeds the run/session/container rollups, with `costEstimate` filled from the config price table when the provider reports none.

## Context Injection

Dynamic context is inserted as a custom message entry, guarded by agent name. Reusing a Pi session should not duplicate context blocks.

System prompts are frozen at Pi session creation time — which is why `prompt_hash` binds to the session, not the run. Context is assembled per spawn and stored in the Pi transcript so future turns can replay it.

Superseded by D82 (`docs/10-system-design/explainers/state-shapes.html` v4): the context message becomes section ② of the request, rebuilt from a kernel-held set on every request instead of being pinned into the transcript at spawn. Per-spawn injection is the current implementation, not the target.

## Observability Ordering

The pipeline creates DB rows before emitting run events or triggering the Pi turn. That lets every later event refer to existing session/run records.

This is the key difference between a runnable agent helper and a debuggable kernel runtime.
