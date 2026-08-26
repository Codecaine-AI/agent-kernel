---
covers: "Structural decisions in the subagent module: per-tool spawn grants (D77) and the AgentManager's runtime-host independence."
concepts: [subagents, spawner-tools, agent-manager, spawn-adapter]
code-ref: packages/kernel/src/subagents/
depends-on: [00-overview.md, ../../10-system-design/10-runtime-model.md]
---

# Subagents

`packages/kernel/src/subagents/` implements subagent orchestration — spawner-tool binding, the `AgentManager`, foreground/background dispatch, and steering. The behavior (dispatch semantics, queueing, identity forwarding, steering observability) is design: [10-runtime-model.md](../../10-system-design/10-runtime-model.md) § Subagents.

---

## Decisions

### Spawning is a tool declaration, not an agent flag (D77)

**Decision.** The only way an agent gains spawn capability is a spawner tool declared in its tools sidecar via `defineSpawnerTool({ name, parameters, spawns, execute })`, with `spawns` an explicit allowlist of agent names (`["*"]` is the loud general opt-in). The declaration compiles into an ordinary Pi-registerable tool; at session build time `bindSpawnerTools` replaces the placeholder execute with one holding the scoped `dispatch` handle. The agent-level `canSpawnSubagent` manifest boolean is retired, and the generic Pi subagent tools are disallowed for every kernel agent.

**Why.** An agent-level flag grants a capability without naming its targets, so nothing can validate the fan-out at boot and a typo becomes a silently errored record at runtime. A per-tool allowlist is boot-validated against the catalog and puts the grant on the action surface where the tool author already is.

**Applies to.** `packages/kernel/src/subagents/spawner-binding.ts`, spawner harvest in the registry, and every future spawner tool — new spawn capabilities must be declared this way, never as manifest flags.

### `AgentManager` takes a `spawnAgent` adapter

**Decision.** The manager does not import the spawn pipeline; it requires a `spawnAgent` function at construction.

**Why.** Subagent orchestration (records, queueing, stop/cleanup, steering) stays independent of the concrete runtime host and testable without one. The rejected alternative — the manager calling the pipeline directly — makes orchestration and spawning one unswappable unit.

**Applies to.** `packages/kernel/src/subagents/manager.ts` and any future orchestration feature: new manager behavior must go through the adapter, not reach into the pipeline.
