---
covers: "Agent state implementation: the StateModule seed/update/render contract, session events and the catch-up cursor, window strategies, the L2 context set, three-section request assembly, state.json persistence through the sink seam, and how a spawn activates the state extension."
concepts: [agent-state, state-module, state-sidecar, session-event, window-policy, context-set, three-section-request, state-snapshot, state-sink, pass-through-gate]
code-ref: packages/kernel/src/state/, packages/kernel/src/agent-definition/index.ts, packages/kernel/src/spawn-pipeline/spawn-agent.ts
depends-on: [10-spawn-pipeline.md, 30-context-loaders.md, ../../10-system-design/60-prompt-system-model.md]
---

# Agent State

`packages/kernel/src/state/` implements the state model decided in D81–D92. One state object per agent; the messages are part of it; every provider request is three sections and the kernel builds two of them.

Design record: `docs/10-system-design/explainers/state-shapes.html` (v4). Decisions: D81–D92 in [60-prompt-system-model.md](../../10-system-design/60-prompt-system-model.md).

---

## Activation Gate

`stateExtensionEnabled({ module, window })` returns true only when the bundle ships a state sidecar (`state.ts` or `state/index.ts`, D98) **or** declares a `state.window` block in `agent.json`. When it returns false the extension is never registered in `createPiSession`, and the session behaves exactly as it did before the state layer existed — the pass-through guarantee.

This is why "base agent" is not a code path: an agent with neither a sidecar nor window config runs no state code at all. An agent with window config but no sidecar gets `baseStateModule` — bookkeeping counters plus a rolling-window renderer.

## The Contract

The state section exports a `StateModule<S>` (`defineState` in `@agent-kernel/kernel/agent-definition` is the typed identity helper, alongside `defineContext` / `defineTools`):

```ts
seed(ctx: SpawnContext, prior?: S): S;
update(state: S, event: SessionEvent): S;
render(state: S, ctx: RenderContext): RenderOutput;
window?: WindowPolicy;      // the module's own default; manifest/spawn config wins
```

`S` is the agent's own type; the kernel never inspects it. It must be JSON-serializable because it snapshots to `state.json`.

`render` may return a bare `AgentMessage[]` (every message counts as tail) or a `RenderResult { messages, stateMessageCount }` — the leading `stateMessageCount` messages are section ③'s state block(s), the rest is the conversation tail. `normalizeRenderOutput` clamps the count to the array length.

`RenderContext` carries `agentName`, optional `containerId`, `messages` (the array Pi is about to send — renderers window over it rather than duplicating it into `S`), `turnIndex`, and the resolved window policy.

## Base Module

`base.ts` is the default when window config is present but no sidecar is. `BaseState` is bookkeeping only (`turns`, `userMessages`, `toolCalls`, `toolErrors`, `lastEventSeq`) — nothing in the request derives from it. `renderRollingWindow` applies the window to `ctx.messages` and prefixes at most one elision-marker message, reported as `stateMessageCount: 1`.

## Session Events

`SessionEvent` is a four-member union, kernel-owned and deliberately small:

| Kind | Derived from | Payload beyond the base fields |
|---|---|---|
| `user_message` | a `user` transcript message | `text` (flattened), `imageCount` |
| `tool_call` | each `toolCall` block of an `assistant` message | `toolCallId`, `toolName`, `input` |
| `tool_result` | a `toolResult` message | `toolCallId`, `toolName`, `isError`, `text`, `imageCount` |
| `turn_end` | Pi's blocking `turn_end` hook | `turnIndex`, optional `stopReason` |

Every event carries `seq` (monotonic within one extension instance), `messageIndex`, and `timestamp`. `custom`, `bashExecution`, `branchSummary`, and `compactionSummary` messages produce no events — transcript furniture, not state input.

The first three kinds are derived from the session message array by `deriveEvents(message, index)`. `turn_end` is hook-derived and cannot be reconstructed from the transcript by design: turn boundaries belong to the kernel, not the message log.

### Catch-up is idempotent by construction

`pump()` folds every message from a single `cursor` to `messages.length`, then advances the cursor. Consequences:

- Re-running `pump()` when nothing new landed costs one length comparison and folds nothing — this is the steady state.
- Catch-up in the `context` hook is therefore not a special path; it is the same call, and there is no dedupe bookkeeping to get wrong.
- If the array *shrank* (fork / tree navigation), the cursor re-anchors to the new length rather than re-folding history the state already contains.

## Hook Wiring

`createStateExtension` registers one Pi `ExtensionFactory` (measured behavior on `@earendil-works/pi-*@0.82.1`):

| Hook | What the extension does |
|---|---|
| `message_end` | `pump()` |
| `tool_result` | `pump()` |
| `turn_end` | `pump()`, fold a `turn_end` event, advance `turnIndex`, `snapshot()` |
| `context` | `pump(event.messages)` (catch-up), then `build(event.messages)` and return `{ messages }` |
| `agent_settled` | `snapshot()` — end-of-prompt |

Every handler is wrapped: on error it logs and continues, and the `context` handler returns `undefined` so Pi sends the request untouched rather than the request failing. Compaction is disabled in `createPiSession`; nothing here compacts.

`create-session.ts` appends the extension factory to `extensionFactories` and calls `bindSession(session)` after the session exists, which is how the extension reads the live transcript.

## Window Strategies

`window.ts` ships two strategies. The invariant that is *not* configurable: **cuts land only on turn boundaries**. That is structural rather than checked — `segmentTurns` never closes a turn while a `toolCall` is unanswered (a user message arriving mid-flight is absorbed into the open turn), and every strategy returns a *turn* index, so an assistant `toolCall` and its `toolResult` can never be split.

| Strategy | Behavior |
|---|---|
| `turns` | keep the last `maxTurns` turns |
| `token-budget` | walk newest → oldest, keeping turns until `maxTokens` would be exceeded; the newest turn always survives |

Defaults (`DEFAULT_WINDOW`) — **tuning-open**; these are first-pass numbers chosen at the kernel stage, not measured optima:

| Field | Default | Meaning |
|---|---|---|
| `strategy` | `"turns"` | |
| `maxTurns` | `8` | turns kept verbatim |
| `maxTokens` | `60000` | ceiling for `token-budget` |
| `charsPerToken` | `4` | estimator divisor |
| `imageTokens` | `1600` | tokens charged per image block |
| `maxImages` | `4` | newest-K image cap; `null` keeps all |
| `elisionMarker` | `true` | emit `[turns 1–N elided]` when history was cut |

Images beyond the newest-K cap inside the surviving window become one-line text stubs (`[image elided — image/png, 41.2 KB]`) before whole turns drop. `stubOldImages` walks newest → oldest and clones only the messages it changes.

`applyWindow` returns the kept messages plus `totalTurns`, `elidedTurns`, the marker text, and `stubbedImages`.

## The Context Set (Section ②)

`context-set.ts` holds the L2 set: an id → entry map rendered into **one** kernel-authored message per request, `<context>` … `</context>`, entries in `order` then insertion order, each optionally wrapped in its own XML tag via `label`. Entry images are appended as image blocks after the text. `render()` returns `null` when the set is empty, and the builder then omits section ②.

Re-adding the same id replaces the entry in place and keeps its insertion position, so a skill can be swapped without reordering the message. `remove(id)` drops it. Nothing is pinned to history, which is the whole point of D82.

At spawn, when an agent has a `context.ts` resolver *and* the state extension is active, the built context lands as the entry `agent-context:<name>` instead of being injected into the transcript. Without the state extension, the old `injectAgentContext` path still runs (see [10-spawn-pipeline.md](10-spawn-pipeline.md)).

## Kernel-Authored Messages

The two synthetic lines in a built request — the ② context message and whatever the ③ renderer emits around the tail (a state block, or the base renderer's `[turns 1–N elided]` marker) — are not things the user said, but they must reach the provider as valid user turns.

`kernel-messages.ts` sends them down Pi's custom-message channel: `role: "custom"` with a `kernel:`-prefixed `customType` (`kernel:context`, `kernel:state`) and `display: false`. Pi's `convertToLlm` converts a `custom` message into a plain user message with the same content blocks, so the wire form is ordinary — while the marker survives into the request snapshot. The constants and the `isKernelAuthoredMessage()` predicate live in `@agent-kernel/protocol` (`kernel-messages.ts`) because they are wire-visible: the viewer reads them back to badge those lines **KERNEL** instead of **USER**.

## Three-Section Assembly

`buildRequest({ contextMessage, rendered })` concatenates ② then ③ and reports boundaries as half-open `[start, end)` ranges over the returned message list:

- `context` — present only when the L2 set rendered a message.
- `state` — the leading `stateMessageCount` messages of the render.
- `tail` — everything after the state block.

Empty sections are omitted rather than emitted as zero-length ranges, and the sections are emitted in order and never overlap. Section ① (the system prompt) is Pi's and is captured separately by the snapshot recorder, so it never appears in this list.

`RequestSection` is structurally identical to protocol's `PiRequestSnapshotSection`, so a built request's sections stamp straight onto a snapshot. Every build notifies `onRequestBuilt` listeners — the seam the request-snapshot recorder uses (see [70-request-snapshots.md](70-request-snapshots.md)).

## Persistence

`store.ts` implements the v1 snapshot-only persistence of D88:

```text
<root>/.agent-kernel/state/<containerId>/<agentName>/state.json
```

`createFileStateSink({ root })` returns a `StateSink` with the same `submit()` / `flush()` shape and serialized-tail pattern as `TraceWriterSink` — the D92 seam, so the sandbox stage swaps in a remote sink without touching the extension. `submit` is synchronous, serializes eagerly (the agent may keep mutating the same object), never throws into the agent loop, and logs serialization or write failures.

The written `StateSnapshot` carries `containerId`, `agentName`, optional `runId`, a 1-based `version` incremented per snapshot within one extension instance, `updatedAt`, and the opaque `state`.

`readStateSnapshot(root, containerId, agentName)` reads one back. Nothing auto-loads it — it exists so a caller can pass `priorState` explicitly (D87). `createMemoryStateSink()` is the test/no-filesystem sink.

Path segments are sanitized (`[^A-Za-z0-9._-]` → `_`) because container ids and agent names are external input.

## Spawn Wiring

`agent.json` may carry an optional `state` block; the only field today is `state.window`, validated by the manifest schema (unknown keys under `state` or `state.window` are validation errors). The registry discovers the state sidecar in the agent directory by convention — `state.ts` first, then `state/index.ts` — and imports it, accepting a default export or a named `state` export; the module must expose `seed`, `update`, and `render` or registry boot fails with the offending path. `ParsedAgent`-side fields are `stateModule`, `stateModulePath`, and `stateConfig`.

Precedence for the window policy is spawn option → manifest `state.window` → the module's own `window` → `DEFAULT_WINDOW`.

Relevant `spawnAgent` options:

| Option | Effect |
|---|---|
| `window` | per-spawn window policy; wins over the manifest |
| `priorState` | handed to `seed(ctx, prior)`; never auto-loaded |
| `stateRoot` | filesystem root for the `state.json` tree; defaults to the spawn's `workingDir` |
| `stateSink` | replaces the file sink (remote sink, tests) |

Persistence is **default-ON** (D88): a spawn whose state extension is active always snapshots. `resolveStateSink` picks the sink — an explicit `stateSink` wins, else a file sink rooted at `stateRoot`, else one rooted at the spawn's working directory. The options choose *where*, never *whether*. A pass-through agent has no state extension and therefore writes nothing at all. `createKernel({ stateRoot })` sets the fleet-wide default.

`seed` receives the same `SpawnContext` the context loaders get — the pipeline builds it once and hands it to both (D87).

The extension handle also exposes `getState()`, `lastRequest()`, `catchUp()`, `build()`, `snapshot()`, and `flush()`; `flush()` is awaited on both the normal and the error path of a run.
