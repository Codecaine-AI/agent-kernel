---
covers: "Spawn pipeline implementation: createSpawnAgent adapter contract, system prompt resolution, Pi session creation, DB pre-insert, lifecycle emissions, context injection, run context, and turn trigger."
concepts: [spawn-pipeline, create-spawn-agent, pi-session, lifecycle-emitter, run-context, db-preinsert, context-injection]
code-ref: packages/kernel/src/spawn-pipeline/spawn-agent.ts, packages/kernel/src/spawn-pipeline/pi-session-factory/, packages/kernel/src/spawn-pipeline/session/, packages/kernel/src/spawn-pipeline/runtime/
depends-on: [00-overview.md, 30-context-loaders.md]
---

# Spawn Pipeline

`createSpawnAgent(adapters)` builds the runtime function that executes one agent prompt through Pi.

---

## Adapter Contract

The spawn pipeline is portable because app-specific operations are injected:

| Adapter | Why It Is Injected |
|---|---|
| `loadAgent` | App controls catalog roots and agent names |
| `loadAgentResolver` | App controls where `context.ts` sidecars live |
| `buildPrivateRegisterFactory` | App loads per-agent `index.ts` private tool sidecars and binds app-owned dependencies |
| `buildToolFactories` | App controls shared tools and allowlists |
| `createContextCatalog` | App can register custom loaders |
| `createSpawnContext` | App can attach app session snapshots and paths |
| `getDb` | Host app owns DB connection lifecycle |
| `createAppSessionBinding` | App controls JSONL metadata used by the tailer |

Private tools should be declared in `agent.md` and implemented in the same agent directory's `index.ts`. The adapter usually resolves the agent through the registry, imports `agent.indexModulePath`, and returns an `ExtensionFactory` that calls the sidecar `register()` function with any app-owned runtime services it needs.

## Sequence

1. Resolve `cwd` from `opts.workingDir` or parent Pi context.
2. Require `appSessionId` for DB-backed tracking.
3. Build runtime state from app session identity.
4. Load the parsed agent definition.
5. Resolve variables and render the static system prompt.
6. Build or reuse a Pi session manager.
7. Load context and private tool sidecars.
8. Build the scoped tool factory list.
9. Create a Pi `AgentSession`.
10. Pre-insert `pi_agent_sessions` and `agent_runs`.
11. Resolve the lifecycle emitter.
12. Emit `system_prompt_resolved`.
13. Build context and inject one `agent-context` custom message if needed.
14. Subscribe to Pi session events for streaming and turn limits.
15. Build async-local `RunContext`.
16. Emit `agent_run_start`.
17. Trigger the Pi turn.
18. Update run status and emit `agent_run_end`.

## Context Injection

Dynamic context is inserted as a custom message entry, guarded by agent name. Reusing a Pi session should not duplicate context blocks.

System prompts are frozen at Pi session creation time. Context is assembled per spawn and stored in the Pi transcript so future turns can replay it.

## Observability Ordering

The pipeline creates DB rows before emitting run events or triggering the Pi turn. That lets later kernel events and tailer-ingested agent events refer to existing session/run records.

This is the key difference between a runnable agent helper and a debuggable kernel runtime.
