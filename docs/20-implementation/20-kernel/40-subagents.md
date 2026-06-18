---
covers: "Subagent implementation: AgentManager, foreground/background spawn, concurrency queue, parent tool-call linkage, run context propagation, steering, cleanup, and notifications."
concepts: [subagents, agent-manager, background-agents, spawn-and-wait, parent-tool-use-id, run-context]
code-ref: packages/kernel/src/subagents/
depends-on: [10-spawn-pipeline.md]
---

# Subagents

Subagents are managed agent runs spawned from inside another agent's turn.

---

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

- current app session identity from `RunContext`
- current container id
- current phase
- `parentToolUseId`
- optional parent run id

It also writes a custom parent/child Pi session marker to the parent Pi session when both session ids are known. The tailer uses that marker to link Pi sessions into a tree.

## Steering

The manager can store steering messages before a subagent session exists and flush them once the session is created. This lets callers interact with long-running subagents without breaking the runtime abstraction.
