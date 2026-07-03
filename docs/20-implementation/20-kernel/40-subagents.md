---
covers: "Subagent implementation: spawner tools (D77), AgentManager, foreground/background spawn, concurrency queue, parent tool-call linkage, run context propagation, steering, cleanup, and notifications."
concepts: [subagents, spawner-tools, agent-manager, background-agents, spawn-and-wait, parent-tool-use-id, run-context]
code-ref: packages/kernel/src/subagents/
depends-on: [10-spawn-pipeline.md]
---

# Subagents

Subagents are managed agent runs spawned from inside another agent's turn.

---

## Spawner Tools (D77)

Spawning is granted per tool, not per agent. The old agent-level
`canSpawnSubagent` boolean is retired; there is no manifest flag that makes an
agent generally able to spawn. Instead, a `tools.ts` sidecar declares a
spawner tool with `defineSpawnerTool({ name, parameters, spawns, execute })`,
where `spawns` is the explicit allowlist of agent names the tool may dispatch
(`["*"]` is the loud opt-in for a deliberately general spawner).

The declaration compiles into an ordinary Pi-registerable tool. At session
build time the kernel wraps the register function with `bindSpawnerTools`,
which replaces the placeholder execute with one that hands the author a
scoped `dispatch(agentName, prompt, opts?)` handle over the `AgentManager`.
The handle enforces the allowlist, validates the target exists in the agent
catalog (a wildcard spawner cannot turn a typo into a silently errored
record), and auto-forwards `parentToolUseId` (the enclosing tool call id),
`trigger: "parent-tool"`, and run-context identity — captured at dispatch
time and passed explicitly, so a queued background spawn keeps its own
parent's identity no matter when (or from whose async context) the queue
drains. The tool author cannot get these wrong.

Foreground dispatch awaits completion and resolves with the agent record.
`opts.background: true` maps onto the manager's background queue and resolves
immediately with a `SpawnerBackgroundHandle` — `{ id, agentName, status,
done }`, where `done` always exists and resolves with the final record when
the child actually completes (including queued children, which have no record
promise until they start, and queued children aborted before starting).

Spawner declarations are harvested at registry boot (targets are validated
against the catalog), and the emitter marks spawner tool calls with
`toolKind: "spawner"` + `spawns` in trace eventData. The generic Pi subagent
tools (`Agent`, `get_subagent_result`, `steer_subagent`) are disallowed for
every kernel agent.

## AgentManager

`AgentManager` owns:

- agent records
- foreground `spawnAndWait`
- background `spawn`
- background concurrency limits
- queued background work
- stop and cleanup behavior
- tool-use counters
- result and error storage

It requires a `spawnAgent` adapter. That keeps subagent orchestration independent from the concrete runtime host.

## Foreground And Background

Foreground agents bypass the background queue and are awaited directly.

Background agents enter a FIFO queue when the concurrency limit is reached. The default limit is 4, and the kernel instance can adjust it.

## Parent Linkage

When a subagent is spawned from a tool call, the manager forwards:

- the current `containerId` from `RunContext`
- current phase
- `parentToolUseId`
- optional parent run id
- the run `trigger`, defaulting to `parent-tool`

It also writes a custom parent/child Pi session marker to the parent Pi session when both session ids are known. The backfill mapper uses that marker to link Pi sessions into a tree.

## Steering

The manager can store steering messages before a subagent session exists and flush them once the session is created. This lets callers interact with long-running subagents without breaking the runtime abstraction.

Steering is a control action, so it is observable: each steering message emits exactly one `run_steered` trace event, with `delivery: "delivered"` when it steered a live session or `delivery: "queued"` when it was held until the session existed. Queued emissions wait for the run's trace identity and flush with it.
