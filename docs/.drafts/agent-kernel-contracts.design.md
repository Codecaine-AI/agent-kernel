---
covers: "Draft interface contract source material for the protocol, runtime, loader, database, and viewer package extraction."
concepts: [draft, contracts, protocol, runtime, source-material]
---

# Agent Kernel — Interface Contracts

**Status:** Draft / proposal
**Date:** 2026-06-10
**Parent:** `agent-kernel-platform.design.md`
**Scope:** The concrete contract surface of the kernel — what `packages/protocol` and
the kernel's public API actually contain. Each contract is anchored to its current
implementation in this repo, with the delta required to make it platform-generic.

The contracts are the prerequisite for everything downstream: the viewer renders the
event protocol, the tailer ingests it, the DB stores it, and every app programs
against the spawn/definition/loader contracts. UI packaging waits until these are
fixed.

---

## 0. Inventory

| # | Contract | Current home | Genericness today |
|---|----------|--------------|-------------------|
| 1 | Event protocol (envelope + event catalog) | `apps/database/src/events/` | ~80% — envelope generic; catalog mixes kernel + app events |
| 2 | Spawn contract (`SpawnOptions`/`SpawnResult`) | `agent-kernel/spawn-pipeline/spawn-agent.ts` | ~90% — naming + opaque-label typing |
| 3 | Run context (ALS scope) | `agent-kernel/run-context.ts` | One coupling: `SessionStateManager` |
| 4 | Agent definition (frontmatter, module, registry) | `agent-catalog/parsing/`, `agent-catalog/registry/` | 100% — moves as-is |
| 5 | Context resolver + spawn context | `agent-kernel/spawn-pipeline/context/types.ts` | One coupling: `sessionData` phase types; closed loader union |
| 6 | Loader catalog | `agent-kernel/spawn-pipeline/context/loaders/` | Closed `kind` union must open |
| 7 | Trace writer sink | `agent-kernel/subagents/types.ts` | 100% |
| 8 | App-facing interfaces (`StateManagerLike`, `SkillRegistry`) | implicit today | To be defined |
| 9 | Kernel DB schema | `apps/database/src/schema/` (mixed) | Needs table split |
| 10 | Read API (viewer-core ↔ kernel routes) | scattered in `apps/backend/src/api/` | To be defined |

Headline finding: **the protocol package half-exists already.** `apps/database/src/events/`
contains a generic `TraceEvent` envelope, typed `eventData` payloads, and — notably —
`container_start/end` and `phase_start/end` event types. The container/phase vocabulary
from the platform doc is already in the event model. Extraction is mostly an ownership
move plus separating app-specific event types.

---

## 1. Event Protocol → `packages/protocol`

### 1.1 Envelope (moves nearly as-is)

Current (`apps/database/src/events/envelope.ts`):

```ts
export interface TraceEvent {
  eventId: string;
  sessionId: string;          // → containerId (naming decision, §8 of platform doc)
  userId: string;
  type: EventType;
  source: TraceSource;        // currently "spectre" | "agent" → "platform" | "agent"
  agentId?: string;
  traceLevel: TraceLevel;
  eventData: EventData;
  spanId?: string;
  parentEventId?: string;
  timestamp: string;          // ISO 8601
  piSessionUuid?: string;     // transport-only; resolved to FK at flush
}
```

Deltas: rename `sessionId` per the container-naming decision; de-brand `TraceSource`.
Span semantics (`spanId`/`parentEventId`) are already generic.

### 1.2 Event catalog — split kernel-core from app-extended

**Kernel-core events** (defined in `packages/protocol`, emitted by kernel, rendered by
base viewer):

- Lifecycle: `agent_session_start/end`, `agent_run_start/end`, `pi_agent_start/end`,
  `pi_turn_start/end`
- Spawn pipeline: `system_prompt_resolved`, `context_build_started`,
  `context_input_resolved`, `context_build_completed`
- Conversation: `user_message`, `assistant_message`, `tool_call_start/end`,
  `pre_tool_hook`, `post_tool_hook`
- Grouping: `container_start/end`, `phase_start/end` (already exist — confirm shape
  matches the phase-vocabulary model)
- Diagnostics: `error`, `warning`

**App-extended events** (defined by the app, registered into the protocol):

- Spectre's `ui_ask_requested/answered` + the Ask payload family (`AskQuestion`,
  `AskExchange`, `UIAskKind`, approval payloads) move app-side with the ask feature.

**Required mechanism:** the protocol's `EventType`/`EventData` unions are closed
today. They must become **open**: kernel-core types are a fixed enum; apps register
additional `type` strings + payload schemas + (optionally) viewer renderers for them.
The envelope, tailer, and DB treat app event types opaquely; only the app's registered
viewer panels interpret them. Unregistered/unknown types must still flow end-to-end
(store, stream, render as generic JSON) — forward compatibility is part of the
contract.

### 1.3 Emitter input shapes

`agent-kernel/events/event-payloads.ts` is already just structural aliases of the
event-data interfaces. Once those interfaces live in `packages/protocol`, the
lifecycle emitter imports protocol types directly and the `@spectre/database/events`
dependency disappears (platform doc §6.4). `SYSTEM_USER_ID` and `newSpanId` also move
to protocol (id/actor conventions are protocol concerns).

---

## 2. Spawn Contract → `packages/kernel`

Current (`spawn-agent.ts`): `SpawnOptions` is already nearly generic. Contract after
extraction:

```ts
export interface SpawnOptions {
  workingDir?: string;
  maxTurns?: number;
  thinkingLevel?: string;
  signal?: AbortSignal;
  variables?: Record<string, unknown>;
  domain?: DomainRule[];

  // Identity + grouping (kernel-owned, app-interpreted)
  containerId?: string;        // today: sessionUuid + containerId, partially duplicated
  containerSlug?: string;      // today: sessionSlug — display only
  phase?: string;              // opaque label from the container's phase vocabulary
  displayLabel?: string;
  parentRunId?: string;
  parentPiSessionUuid?: string;
  parentToolUseId?: string;

  // Storage roots (today from @spectre/shared constants → injected config)
  sessionDir?: string;         // app artifact dir, opaque to kernel
  piSessionsDir?: string;

  // Plumbing (unchanged)
  traceWriter?: TraceWriterSink;
  sessionManager?: SessionManager;
  onToolActivity?; onTextDelta?; onSessionCreated?; onTurnEnd?;

  // Resume (unchanged — generic human-in-the-loop hook even while ask stays app-side)
  resumeFromToolResult?: { toolUseId; toolName; content; contentBlocks? };
  reuseExistingSession?: boolean;
}

export interface SpawnResult {
  responseText: string;
  session: AgentSession;       // Pi SDK type — kernel's public API admits the Pi dependency
  aborted: boolean;
}
```

Decisions encoded here:

- `sessionUuid`/`sessionSlug` collapse into `containerId`/`containerSlug` (one
  identity, two names today).
- `resumeFromToolResult` **stays in the kernel** even though ask is app-side: it is
  the generic suspend/resume mechanism; ask is one app feature built on it. This is
  what makes ask promotable later without kernel changes.
- The kernel does not hide the Pi SDK: `AgentSession` appears in the public surface.
  The pi-session-factory remains the single construction seam, but pretending the SDK
  is swappable would be a fiction — out of scope.

---

## 3. Run Context → `packages/kernel`

Current coupling: `RunContext.stateManager?: SessionStateManager | null`.

Contract: the kernel defines a generic extension slot instead of knowing the app's
state class:

```ts
export type RunContext<TAppContext = unknown> = {
  containerId: string;
  containerSlug: string;
  runId: string;
  parentRunId?: string;
  agentName: string;
  traceWriter: TraceWriterSink;
  sessionDir?: string;
  piSessionsDir?: string;
  workingDir?: string;
  piSessionUuid?: string;
  phase?: string;
  app?: TAppContext;           // replaces stateManager — app-owned, kernel-opaque
};
```

The app supplies an `AppContextFactory` at kernel init
(`(opts) => TAppContext`, replacing `run-context-builder.ts`'s hardwired
`new SessionStateManager(...)`). Spectre's factory returns
`{ stateManager: SessionStateManager }`; its tools read it via a typed
`getRunContext<SpectreAppContext>()` helper. Tools that today call
`getRunContext().stateManager` are app-side tools anyway (ask, session-state), so the
typed accessor lives with them.

---

## 4. Agent Definition Contract → `packages/kernel` (moves as-is)

Already fully generic; becomes the kernel's headline public contract:

- `AgentFrontmatter` — `name`, `description`, `model`, `tools` allowlist,
  `disallowed_tools`, `extensions`, `can_spawn_subagent`, `variables`
  (declaration + default), `max_turns`, `run_in_background`, `thinking`
- `ParsedAgent`, `DomainRule` (path-ACL: read/upsert/delete)
- `AgentModule` / `AgentRegisterFn` — `index.ts` exports `register(pi: ExtensionAPI)`;
  invoked per spawn, no cross-spawn state
- `AgentDefinition` — parsed agent + absolute paths to colocated `context.ts` /
  `index.ts` (registry stores paths; consumers dynamic-import)
- `AgentRegistry` — `get`/`tryGet`/`list`/`catalogRoot`; boot-time walk-parse-validate,
  startup failure on violations (`RegistryError`)

Contract addition: the kernel accepts **multiple catalog roots** at init
(`initAgentRegistry({ roots: [...] })`) so a platform can compose kernel-shipped
agents (if any), app agents, and shared agent libraries. Flat namespace + collision =
boot error, preserving current semantics.

---

## 5. Context Resolver Contract → `packages/kernel`

Current `AgentContextResolver` is the right shape and stays:

```ts
export interface AgentContextResolver<TSessionData = unknown> {
  loaders: LoaderDeclaration[];
  assemble(loaded: LoadedMap, ctx: SpawnContext<TSessionData>): string | Promise<string>;
}
```

`SpawnContext` deltas:

- `sessionData?: { plan?: PlanPhase; build?: BuildPhase; git?: GitContext; ... }`
  → `sessionData?: TSessionData | null`. Spectre instantiates
  `SpawnContext<SpectreSessionData>` in its resolvers; the kernel never sees phase
  types.
- `RuntimeState` (`sessionId`, `topic`, `phase`, `status`, `sessionDir`, `cwd`,
  `priorSessions`) is string-typed and already effectively generic — rename
  `sessionId` → `containerId`, keep the rest as opaque app-populated strings.
- `LoadedInput` / `LoadedMap` / `BuildContextResult` / `InputsSummaryEntry` move
  unchanged — they are pure data and feed the `context_input_resolved` /
  `context_build_completed` protocol events (§1).

---

## 6. Loader Catalog Contract → `packages/kernel`

The catalog mechanism is generic, but two closed points must open:

1. **`LoaderDeclaration` kind union** is closed (`file | directory | skill |
   checkpoint-slice | command | text`). Becomes: base declarations defined in kernel;
   apps register custom kinds with their own declaration shapes
   (`LoaderDeclaration = BaseLoaderDeclaration | { kind: string; [k: string]: unknown }`
   refined per registered kind).
2. **`inputRefOf()`** switches over the closed union. Becomes part of the loader
   registration: each loader supplies `{ kind, load(decl, ctx), inputRef(decl) }`.

Kernel ships: `file`, `directory`, `command`, `text`, `skill` (against `SkillRegistry`,
§8). Spectre registers: `checkpoint-slice` (reads Spectre plan/build state — the
reference implementation for custom loaders).

---

## 7. Trace Writer Sink (already minimal — moves as-is)

```ts
export interface TraceWriterSink { submit(event: TraceEvent): void; }
```

Retyped against the protocol package's `TraceEvent`. This is the only emission
contract tools/subagents need.

---

## 8. App-Facing Interfaces (new — defined by kernel, implemented by app)

| Interface | Replaces | Surface |
|-----------|----------|---------|
| `AppContextFactory<TAppContext>` | hardwired `SessionStateManager` construction | `(spawnOpts) => TAppContext \| null` |
| `SkillRegistry` | implicit duck type used by skill loader | `get(name): { content: string; path: string } \| null`, `list(): string[]` (extract from current `skill-library/` usage) |
| `KernelConfig` | `@spectre/shared` path constants | `{ piSessionsDir, agentDirs/roots, defaultModel?, turnLimits? }` injected at `initKernel()` |
| App event registration | closed `EventType` union | `registerEventTypes([{ type, schema }])` (§1.2) |
| Loader registration | closed loader union | `catalog.register({ kind, load, inputRef })` (§6) |

---

## 9. Kernel DB Schema → `packages/db`

Kernel-owned tables (exported Drizzle objects; app composes into its own drizzle
config — platform doc §4):

- `containers` — new; absorbs the grouping half of Spectre's `sessions` (id, slug,
  label, working dir/worktree, status, phase vocabulary, opaque metadata JSONB)
- `pi_agent_sessions` — as-is
- `agent_runs` — as-is, with `container_id` FK and opaque `phase`/`display_label`
- `trace_events` — as-is; `type` column stays open-string for app event types

App keeps: session workflow state (phase slices), pending asks, anything FK-ing into
the above. Query-helper surface (`upsertPiAgentSession`, `createAgentRun`,
`updateAgentRunStatus`, trace insert/query used by tailer + read API) moves with the
tables.

---

## 10. Read API Contract → kernel route module (consumed by `viewer-core`)

Kernel ships an Elysia route module the app mounts (platform doc §8 resolved
affirmatively). Minimum v1 surface, derived from what the base viewer must render
with zero plugins:

```
GET  /containers                          list + status + phase vocabulary
GET  /containers/:id                      container detail + phase summary
GET  /containers/:id/runs                 run tree (parent_run_id reconstruction)
GET  /runs/:id                            run detail + pi session linkage
GET  /runs/:id/events?level=&type=        trace events (paginated)
GET  /containers/:id/stream               SSE: live trace events + run status
GET  /agents                              registry listing (definitions, for design-time viewing)
```

Versioned with the protocol package; `viewer-core` pins a protocol version. App
routes (Spectre's spec/plan/build APIs) live entirely outside this module.

---

## 11. Contract-First Sequencing

Refines platform doc §7 step 1 — the order *within* contract extraction:

1. **Protocol package**: move envelope + kernel-core event types out of
   `apps/database/src/events/`; split ask/app events Spectre-side; open the
   `EventType` union. Everything else types against this.
2. **Loader + resolver genericization** (§5, §6): `TSessionData`, open loader
   registration, move `checkpoint-slice` to Spectre.
3. **Spawn + run-context surface** (§2, §3): container naming, `AppContextFactory`,
   `KernelConfig` injection.
4. **DB split** (§9): `containers` table, move kernel tables + helpers.
5. **Read API** (§10): carve from existing routes; point Spectre's frontend trace
   views at it — this is the proof the contract is sufficient, before any
   viewer-shell work begins.

Each step keeps Spectre green; no step depends on the repo split having happened.
