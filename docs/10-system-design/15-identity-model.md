---
covers: "The kernel identity model: containers with kinds as the single grouping primitive, agent sessions, runs, turns, and the linkage invariants the trace doctor enforces."
concepts: [identity-model, containers, container-kind, agent-sessions, agent-runs, turns, linkage-invariants, trace-doctor]
depends-on: [20-observability-model.md]
---

# Identity Model

One grouping primitive, four nested entities, explicit linkage everywhere.

---

## The Nesting

```text
Container (kind + key, forms a tree)      the only grouping primitive
  Agent session (Pi conversation)         promptHash, frozen system prompt
    Run (message in -> response out)      trigger, status, usage rollup
      Turn (one model call)               input/output/cache tokens
```

There is no separate "app session" identity. An app session is a container of
`kind: "session"`. A worker slot is a container of `kind: "worker"`. The kind
vocabulary belongs to the host app; the container mechanics belong to the
kernel.

## Container Identity

Containers are identified deterministically from `(kernelId, kind, key)`:

```ts
const container = await kernel.container({
  kind: "epoch",
  key: [projectId, sessionId, runId, epochId],
  parent: runContainer,
  label: `Epoch ${epochId}`,
});
// container.id === uuidv5(kernelNamespace(kernelId), `${kind}\n${key.join("\n")}`)
```

The call is an upsert: the same kind and key always resolve to the same
container. Host apps never mint or hash their own grouping ids.

## Entity Meanings

| Entity | Created | Closed | Carries |
|---|---|---|---|
| Container | first `kernel.container()` upsert | app decision | kind, key, label, phase, metadata, usage rollup |
| Agent session | Pi session creation | agent retired | agent name, model, `promptHash`, parent session + tool linkage |
| Run | inbound message delivered | final response, abort, error, or turn limit | trigger, inbound/outbound event refs, status, usage rollup |
| Turn | Pi turn start | Pi turn end | per-call token usage, model |

A run is one processing loop: a message goes in, the agent works, a response
comes out. A session holds many runs. The system prompt is frozen when the
session is created, so `promptHash` lives on the session; every run inherits
it.

Run triggers: `operator` (a user/operator message), `parent-tool` (a subagent
assignment from a parent's tool call), `steer` (a steering message into a
running agent), `resume` (resumption with a tool result), `system` (kernel- or
app-initiated maintenance work).

## Linkage Rules

If a relationship is known at emit time, it is written explicitly. The kernel
runtime stamps identity from `RunContext` automatically — adapters do not fill
envelope identity fields by hand.

- every trace event carries `containerId`; events inside a run carry `runId`
- every run carries `piSessionId` and `containerId`
- a subagent's session carries `parentSessionId` and `parentToolUseId`
- a subagent's run carries `parentRunId` and `parentToolUseId`
- timestamps order events; they never prove parentage

## Trace Doctor Invariants

`agent-kernel doctor` checks a kernel database against the linkage rules:

| # | Invariant |
|---|---|
| 1 | Every `trace_events.container_id` exists in `containers` |
| 2 | Every `agent_runs.container_id` and `.pi_session_id` resolve |
| 3 | Every child session's `parent_session_id` resolves and carries `parent_tool_use_id` |
| 4 | Every run reaches a terminal status, or its session is still active |
| 5 | Every `tool_call_start` has a matching end, or its run ended abnormally |
| 6 | The container tree has no cycles; every container has a `kind` |
| 7 | Every `trace_events.run_id` resolves to an existing run |
| 8 | Turn usage sums equal run rollups equal session rollups equal container rollups |

## Worked Example

A research harness receives an operator request:

1. It upserts `kernel.container({ kind: "session", key: [reqId] })` — the root.
2. It spawns `research-coordinator` in that container. The kernel creates an
   agent session (recording the coordinator prompt's hash) and opens run 1
   with `trigger: "operator"`.
3. The coordinator's `spawn_research_scouts` tool call spawns two scouts. Each
   scout gets its own session whose `parentSessionId` is the coordinator's
   session and whose `parentToolUseId` is that tool call; each scout run
   carries `parentRunId` = coordinator run 1.
4. Every event any of them emits carries the root `containerId` (or a child
   container's, if the harness groups scouts into sub-containers) and its own
   `runId`.
5. The operator sends a follow-up. The coordinator's existing session opens
   run 2 with `trigger: "operator"` — same session, same `promptHash`, new run.
