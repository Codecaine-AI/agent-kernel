# Pi extension-hook blocking spike

## Setup

- Command: `bun spikes/pi-hook-blocking/spike.ts`
- Runtime path: public `createAgentSession()` returning a real `AgentSession`; the spike does not call `pi-agent-core`'s loop directly.
- Packages: `@earendil-works/pi-coding-agent@0.82.1`, `@earendil-works/pi-agent-core@0.82.1`, and `@earendil-works/pi-ai@0.82.1`.
- Provider: a deterministic, in-memory provider registered through `ModelRegistry.registerProvider()` over a `ModelRuntime.create({ modelsPath: null })` runtime (0.82.1 replaced `AuthStorage`/`ModelRegistry.inMemory`). Its `streamSimple` returns Pi's `AssistantMessageEventStream`; no network calls occur.
- Script: provider request 1 returns two sequential calls to one trivial extension tool (one allowed and one vetoed), then provider request 2 returns a plain assistant message and stops.
- Hooks: `context`, `turn_start`, `turn_end`, `agent_end`, `tool_call`, and `tool_result` are registered by one inline `ExtensionFactory`. Each invoked handler sleeps about 300 ms, except `turn_end[0]`, which sleeps about 1000 ms.
- State: auth, settings, and session persistence are all in memory. Compaction and retries are disabled.
- Time base: every table entry uses monotonic `performance.now()`, relative to `prompt.start`.
- Drain note: the spike timestamps prompt resolution first, then awaits AgentSession's internal extension-event queue. On 0.82.1 these coincide (3740.3 ms) because lifecycle handlers now settle before `prompt()` resolves; on 0.70.6 they were ~1.6 s apart.

## Chronological timeline

| # | t (ms) | Event | Detail |
|---:|---:|---|---|
| 1 | 0.0 | prompt.start |  |
| 2 | 1.5 | turn_start[0].start |  |
| 3 | 303.6 | turn_start[0].end |  |
| 4 | 304.9 | context[1].start | messages=1 |
| 5 | 607.0 | context[1].end | messages=1 |
| 6 | 608.6 | provider[1].enter | messages=1, toolResults=0 |
| 7 | 611.8 | tool_call[call-allow].start | mode=allow |
| 8 | 919.4 | tool_call[call-allow].end | mode=allow |
| 9 | 920.4 | tool.execute[call-allow].start | mode=allow |
| 10 | 920.4 | tool.execute[call-allow].end | mode=allow |
| 11 | 921.3 | tool_result[call-allow].start | isError=false |
| 12 | 1222.5 | tool_result[call-allow].end | isError=false |
| 13 | 1223.9 | tool_call[call-veto].start | mode=veto |
| 14 | 1525.3 | tool_call[call-veto].end | mode=veto |
| 15 | 1526.0 | turn_end[0].start | sleep=1000ms |
| 16 | 2528.8 | turn_end[0].end | sleep=1000ms |
| 17 | 2529.5 | turn_start[1].start |  |
| 18 | 2832.2 | turn_start[1].end |  |
| 19 | 2832.4 | context[2].start | messages=4 |
| 20 | 3133.6 | context[2].end | messages=4 |
| 21 | 3133.9 | provider[2].enter | messages=4, toolResults=2 |
| 22 | 3134.1 | turn_end[1].start | sleep=300ms |
| 23 | 3435.2 | turn_end[1].end | sleep=300ms |
| 24 | 3435.7 | agent_end.start |  |
| 25 | 3738.6 | agent_end.end |  |
| 26 | 3740.3 | prompt.resolve |  |
| 27 | 3740.3 | extension_queue.drained |  |

## Verdicts

**Q1 — CONFIRMED-BLOCKING (unchanged from 0.70.6).** The 300 ms `context` hook sat on the critical path both times: request 1 entered the provider 1.6 ms after `context[1]` ended (607.0 → 608.6), request 2 entered 0.3 ms after `context[2]` ended (3133.6 → 3133.9).

**Q2 — NOW BLOCKING (REVERSED vs 0.70.6).** The slow `turn_end[0]` handler ran 1526.0 → 2528.8 ms (1002.8 ms) and the loop *waited*: `turn_start[1]` did not begin until 2529.5 ms, `context[2]` until 2832.4 ms, and provider request 2 until 3133.9 ms. On 0.70.6 provider request 2 entered while `turn_end[0]` still had ~700 ms left; on 0.82.1 it does not.

**Q3 — NO RACE (RESOLVED vs 0.70.6).** Execution is strictly sequential end to end: `turn_end[0]`.start 1526.0 → `turn_end[0]`.end 2528.8 → `turn_start[1]` 2529.5 → `context[2]` 2832.4 → `provider[2]` 3133.9 → `turn_end[1]` 3134.1 → `agent_end` 3435.7 → `prompt.resolve` 3740.3. Nothing from turn N+1 begins before turn N's lifecycle handlers settle.

**Q4 — SAFE BARRIER (REVERSED vs 0.70.6).** `await session.prompt(...)` resolved at 3740.3 ms — *after* `agent_end` settled (3738.6 ms) and coincident with the extension queue draining (3740.3 ms). On 0.70.6 it resolved ~1.6 s before `agent_end` settled. Awaiting `prompt()` is now a valid end-of-run barrier; 0.82.1 additionally adds an explicit `agent_settled` hook ("fired after an agent run has fully settled and no automatic retry, compaction, or queued continuation will run").

**Q5 — CONFIRMED-BLOCKING / VETO-CONFIRMED (unchanged from 0.70.6).** Tool execution began 1.0 ms after `tool_call` ended (919.4 → 920.4), confirming the hook is on the tool's critical path. The vetoed call returned `{ block: true, reason: "veto requested by spike" }`, its executor never ran, and Pi synthesized an error tool result. The `tool_result` hook fired for the allowed call only.
