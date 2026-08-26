---
covers: "Design of the prompt system: the prompt-kit/kernel split, agent bundles and their data artifacts, prompt documents and revisions, variables, context, tools, variants, and the agent state model (D81-D99) that owns what the model sees each request."
concepts: [prompt-system, prompt-kit, agent-bundle, agent-manifest, prompt-document, prompt-revisions, context-resolver, private-tools, spawner-tools, variants, state-model, three-section-request, state-sidecar, window-policy]
depends-on: [../00-foundation/30-boundaries.md, 10-runtime-model.md, 15-identity-model.md, 50-app-adapter-model.md]
---

# Prompt System Model

This document owns the design of the prompt system: the layer that turns typed agent bundles into rendered prompts, bound context, registered tools, and — through the state model — the exact request the model sees each turn.

It has two parts. The prose sections state the settled model. The decision record at the end (D81–D99) preserves the state-model and viewer decisions with their rationale. Decisions D1–D80 from the earlier design interviews are folded into the prose; their numbering is retained where later entries cite them.

---

## The Split: Prompt-Kit and the Kernel

The prompt system is not a second kernel runtime. It is a typed authoring and rendering layer that the Agent Kernel consumes.

The generic layer lives in `@codecaine-ai/prompt-kit` — a sibling repo in the Core workspace, consumed by the kernel as a workspace dependency. Prompt-kit owns the prompt document model, canonicalization and hashing, the renderers, builders, transforms, validation, and the generic templates and archetypes. It knows nothing about Pi, agents, tools, subagents, traces, context loaders, or app sessions.

The kernel owns the runtime-facing agent model: bundle discovery and the registry, manifest validation, variable resolution, context binding, private tool binding into Pi registration, session creation and run lifecycle, subagent orchestration, and the trace and viewer contracts.

The dependency direction is one-way: the kernel may depend on prompt-kit; prompt-kit must never depend on the kernel. Kernel-specific prompt helpers exist only when they truly depend on kernel concepts.

## The Agent Bundle

An agent is a directory: an `agent.json` manifest plus four sections — prompt, context, tools, state — mirroring the request the model receives. The full tree, its resolution rules, and their rationale are D98; the short form:

```text
catalog/<agent>/
  agent.json                              the index: model, thinking, maxTurns, window
  prompt.json    | prompt/prompt.json     ① source of truth
  prompt.rendered.md | prompt/system.md   generated markdown render — never hand-edited
  context.ts     | context/index.ts       ② the inventory of standing context
  tools.ts       | tools/index.ts         the action surface
  state.ts       | state/index.ts         ③ how each turn is handled
```

The manifest is data, validated by a shared JSON Schema (`agent-kernel/agent-v1`). `defineAgent` survives as the typed generator/validator for these files, and the authoring surface uses camelCase field names throughout. The code sidecars attach by filename convention; frontmatter and a separate `config.ts` are not part of the model.

There is no authored `agent.md`, ever. System prompt, dynamic context, tools, and user turn have different lifetimes; tool implementations are executable sidecars, not prompt text; and a visible authored markdown file implies it is safe to edit by hand when the document is the source of truth. The agent viewer is the inspection surface: it renders the composed typed agent — manifest, rendered prompt, tool metadata, context contract, resolved variables, validation state — rather than an editable artifact.

## Prompt Documents

The canonical authored prompt artifact is the serialized `PromptDocument` JSON (`prompt.json`), not TypeScript builder code. Notion-style structural editing must persist, and edited documents cannot round-trip into hand-authored builder calls. The builders remain exported as the programmatic construction library — scripts, generators, tests — but what is committed and loaded by the registry is the document. `validatePrompt` with the agent's declared variables performs, at boot and in the editor, the checks the type system used to perform.

The document model is a small recursive AST, not string templating:

- Base nodes: `section`, `paragraph`, `bulletList`, `orderedList`, `field`, `codeBlock`, `example`, `raw`. Specialized nodes such as `phase`, `step`, `constraint`, and `outputFormat` are typed helpers built on top.
- List items are full node containers with optional leading text, so a bullet can hold nested lists, paragraphs, or examples without falling back to string formatting.
- Nodes carry stable ids separate from rendered XML tag names. Tags describe rendered semantics; ids support replacement, insertion, diffing, and viewer selection.
- Array order is the canonical ordering model. Transforms may insert, replace, or reorder programmatically, but nodes carry no persistent `before`/`after`/`priority` hints.
- Dynamic references are typed variable nodes — `variable("userPrompt")` — never raw `{{placeholder}}` strings.
- Documents carry an explicit schema version (`schemaVersion: "prompt-kit/v1"`) as the migration hook.

The default renderer outputs XML-tagged Markdown: readable prose with clear parseable boundaries. Renderers own output formatting — indentation, blank lines, bullet markers, numbering, fences, XML spacing — so the structure and its rendered representation stay separate, and other renderers can target other formats from the same tree.

### Body shape

The rendered system prompt uses Markdown with semantic XML tags. The standard section vocabulary:

```xml
<purpose> … </purpose>
<rules> … </rules>
<key_knowledge> … </key_knowledge>
<goal> … </goal>
<background> … </background>
<workflow>
    <inputs> … </inputs>
    <steps> … </steps>          <!-- or <phases> for agent-loop execution -->
    <global_constraints> … </global_constraints>
</workflow>
<tool_policy> … </tool_policy>
<state_protocol> … </state_protocol>
<output_format> … </output_format>
<success_criteria> … </success_criteria>
<reminders> … </reminders>
```

Sections are omitted when they do not earn their token cost. The design principle is "typed spine, flexible sections": archetypes define the expected shape, common primitives handle repeated structure, and escape hatches allow custom XML sections when a prompt genuinely needs something unusual. Validation catches broken references and malformed sections; it does not force every prompt into the same maximum template.

### Taxonomy

Two broad archetypes: `singleOutput` and `workflow`. **Steps** describe internal reasoning inside one completion; **phases** describe external execution across tools, state, turns, and subagents — which keeps the taxonomy close to the kernel's runtime reality, where every run executes an agent definition but some definitions are simple enough to behave like a single task.

Three terms with distinct meanings: an *archetype* is a broad execution/structure family; a *template* is a reusable parameterized layout for a prompt pattern (extraction, evaluation, classification, critique/revise, summarization begin here, not as archetypes); an *example* is a concrete prompt in an actual app. Concrete coordinator or scout prompts are examples, never archetypes.

## Prompt Revisions and Editing

Every prompt state is content-addressed. The canonical document is hashed (`"pk1-" + sha256(canonicalBytes)`) and stored as a `prompt_revisions` row with the document and rendered text. Agent sessions record the hash at creation time — the system prompt is frozen at Pi session creation, so revisions bind to sessions, not runs. Each agent bundle also commits a derived rendered-markdown snapshot, enforced by test, so PR diffs show the rendered contract.

The prompt UI reads and writes `prompt.json` directly. There is no codegen back into builder code, ever. Saves go through a catalog write API that validates against the PromptDocument JSON Schema and the declared variables, canonicalizes, writes the file, and records a revision.

The editor's only surface is the Agent XML flow — a code-editor rendering of exactly what the agent receives, with block and keyboard editing layered on as interaction, never as an alternative document view (D78, in the decision record below, records the retirement of the Sections and Raw views).

Operational manifest fields — currently `description` and `model` — are editable from the agent viewer through a dev-gated `PUT /kernel/catalog/agents/:name/manifest`, following the prompt-save pattern: schema-validated merge, canonical `agent.json` rewrite, registry hot-reload so the next spawn uses the new values, old entry and file preserved on failure. This is field-level editing of operational configuration, not a general manifest editor: variables, tools, spawner declarations, and renames stay file-edited, and renames are rejected by hot-reload. Widening the editable set is a future decision, not a default.

## Variables

Runtime variables are declared in the manifest, because they are part of the agent's runtime contract. The prompt references them through typed variable nodes; validation fails when a prompt references an undeclared variable, when a required variable has neither default nor caller-provided value, or when caller variables include unknown names.

Variables are required by default:

- No `default` and no `optional: true` means required.
- A variable with a `default` is optional at spawn time.
- `optional: true` without a default means the variable may be absent, and the prompt and context must handle absence explicitly.
- Required variables must be provided before the model run starts.

## Context

`context.ts` owns dynamic context shape, loader declarations, and context rendering. The prompt owns instructions for how to *use* the injected context — it may reference a context block by id/tag with usage rules, but it never redeclares the schema `context.ts` already declares. Double-counting makes traces noisy and lets copies drift.

The contract around loaders:

- `context.ts` supports a runtime-bound factory pattern, like `tools.ts`, so app-owned services, paths, and loader catalogs inject cleanly while the bound result still matches the kernel's resolver contract.
- Context is structured-first with a raw-string escape hatch: typed helper builders sit on top of generic loader declarations, and the kernel operates on the generic form.
- Loader helpers may carry rendering metadata — tag name, viewer label, requiredness, empty behavior, truncation policy — but most metadata is optional with defaults derived from the helper id and loader type.
- Context sections are optional by default, with explicit policies (`onMissing` / `onEmpty` / `onError`, each `"optional" | "warn" | "error"` as applicable). Unlike variables, external data sources are often legitimately empty; a section is marked required only when missing data should block the run.
- Problems surface through both boot validation and runtime trace events. Boot validation eagerly checks what is knowable before a run — catalog shape, duplicate section ids, malformed configs, package-relative resources. Session-relative files, app state, database-backed context, and working memory are checked at runtime, where the section's failure policy decides between blocking and warning.

Under the state model, the boundary between reference material and working state is drawn, not blurry: `context.ts` declares section ② — reference material visible on every request — and no longer holds working state, working memory, or conversation slices, which are section ③, owned by the state sidecar (D81–D84).

## Tools

The manifest declares shared/core tool access as a flat explicit list of tool names — access to tools that exist outside the agent (core runtime tools, shared app tools, provider/MCP tools). `tools.ts` defines private tools that belong to the agent; a tool defined there is part of the agent's capability surface and is never repeated in an allowlist. The two are different things: shared access is permission/configuration; private tools are implementation plus declaration. No aliases, bundles, or tool groups.

Private tool definitions stay directly compatible with Pi's `registerTool(...)` shape — `defineTool(...)` is at most a very thin wrapper — so registration is boring and reliable: the kernel compiles the export into an extension factory that registers each tool. Tools use runtime-bound factories (`defineToolSet((runtime) => [...])`) so app services inject cleanly while still producing ordinary Pi tool definitions. Tool metadata does not need to be statically inspectable without a runtime; validation binds a real or stub runtime when the registry or viewer needs metadata.

### Spawner tools

Spawning is granted per tool, not per agent; there is no manifest-level `canSpawnSubagent` boolean. A tool that dispatches subagents is declared with `defineSpawnerTool({ ..., spawns: [agent names] })` in `tools.ts`; the kernel injects a scoped `dispatch` handle at session build time that enforces the declared allowlist and auto-forwards `parentToolUseId`, `trigger: "parent-tool"`, and run-context identity.

Agent platforms default to "everything can spawn general subagents"; this kernel does not. A permission boolean says an agent may spawn, but not what, through which tool, or with what identity plumbing. Spawner declarations are harvested at registry boot — every non-`"*"` target must exist in the catalog or boot fails — and the harvested map rides on the runtime config. A deliberately general spawner remains possible via `spawns: ["*"]`, but it is a loud opt-in visible in the declaration, the harvest, and the trace. Spawner calls are distinguishable in traces: `tool_call_start` / `tool_call_end` eventData gains optional `toolKind: "spawner"` + `spawns` — additive optional fields on the existing payloads, no new event types, no envelope change — so viewers can render agent dispatch differently from ordinary tools.

## Variants and Run Overrides

Durable agent definitions own relatively stable configuration: name, description, model and settings, prompt source, variable schema, context assembler, private tool registrations, spawn declarations, turn limits, background behavior. Run invocations own dynamic values: caller-provided variables, the current message or assignment, session identity and paths, runtime inputs, parent/subagent linkage.

Run invocations casually override only the dynamic inputs. Prompt structure, tool access, variable schema, context shape, spawn declarations, model, thinking level, max turns, and background behavior are configuration and cost/control semantics — differing values are an explicit variant or an administrative override, not ordinary run input.

Variants represent different configurations of the same prompt/context/tool identity — split testing, cost/performance tuning, phase-specific operational settings. They may override model, thinking level, max turns, background behavior, display label, and future cost/concurrency hints; they may not override prompt, context assembler, tools, variable schema, or spawn declarations. If behavior diverges materially, that is a distinct agent, not a variant. Prompt A/B testing is out of scope for the core variant model; if it matters later it is separate experiment tooling or explicit temporary agents.

## Identity, Storage, and Emission

Contracts decided here that other design pages carry in full:

- **Sessions are containers.** There is no separate app-session identity; an app session is a container of `kind: "session"`, container ids derive deterministically from `(kernelId, kind, key)`, and the trace envelope requires `containerId`. See [15-identity-model.md](15-identity-model.md).
- **Per-kernel local database.** Each kernel owns a local SQLite database (`.agent-kernel/trace.db`, WAL). Postgres remains a supported dialect for shared planes but is not the default; a future central observer federates over per-kernel read APIs rather than a shared database.
- **Extension-primary emission.** Kernel-spawned sessions emit trace events in-process through a Pi extension that has `RunContext` identity at emit time; marker-based session binding is retired. Pi's agent loop runs off an in-memory message array — the JSONL transcript is a write-behind log, read only at session load, resume, or fork, never per turn — so the extension observes everything the transcript contains plus identity it never will. The JSONL remains the durable raw transcript.
- **Transcript recovery lives in the kernel.** The former tailer package is dissolved; re-deriving trace rows from Pi's JSONL is the kernel's `agent-kernel-backfill` command, for disaster rebuild, import of sessions run outside the kernel, and schema re-derivation. Co-locating the recovery mapper with the live emitter turns their id-parity guarantee into an intra-package test, so the two mappings cannot version-skew.

---

## Amendments — 2026-07-27 State Model Interview

These decisions come from the state-model design interview on 2026-07-27 and
supersede earlier entries where noted. The entries below are the design
record for the state model. As-built implementation:
[docs/20-implementation/20-kernel/00-overview.md](../20-implementation/20-kernel/00-overview.md).

### D81. The State Is the Observation (new)

Status: decided.

Decision: Each turn, the agent is dropped into the current state and asked
for the next step — the state is the observation, the model is the policy,
as in a PPO setup. The consequence that orders everything after it: **the
messages are part of the state**. Conversation history is not a store that
sits beside the state; it is one component of it, alongside whatever domain
components the agent has. There is one state object per agent, and one
moving piece in every request: the render of that object.

Rationale: v1 optimizes for context control. Every request is deliberately
constructed and nothing accumulates, so there is no compaction step to
design and no ever-growing transcript to compress. Restart stays the honesty
test — a state that cannot restart the work is not the state — and the
interface falls out of getting the representation right.

### D82. The Request Is Three Sections (revises D27)

Status: decided.

Decision: Every provider request the kernel builds has exactly three
sections, and the kernel builds all three:

- ① **system prompt** — the agent's instructions in XML tags; effectively
  fixed for the session (frozen at Pi session creation, per D72).
- ② **context message** — reference material that should be visible on every
  request: capabilities, skills, style guides, reference sheets. Rebuilt each
  request from a kernel-held set (id → content), never accumulated in the
  transcript.
- ③ **rendered state** — the working picture plus however much recent
  conversation the renderer chooses to emit. Re-rendered every request by
  `render(state)`.

D27 modeled dynamic material as one "runtime input packet" and accepted a
deliberately blurry boundary between context, conversation history, and the
current turn. That boundary is now drawn: reference material is ②,
everything that moves is ③, and the conversation lives inside ③ because it is
part of the state (D81).

Two mechanics make this honest. ② is rebuilt, not pinned: adding a skill
mid-run adds an entry, losing one removes it, and nothing stale can linger
because nothing is attached to history. ③ may contain real messages —
conceptually the recent conversation is state being rendered, but the
renderer emits it as genuine user/assistant/tool messages, because providers
require real structure for tool-call pairing and models reason better over
real turns. The in-flight turn is always real messages.

Bookkeeping for the ② set — entry ids, the skill add/remove API — is decided
at the kernel build stage.

Implementation note (as built): the rebuilt-② mechanic is scoped
to sessions where the state extension is active. There, an agent's
`context.ts` result becomes the context-set entry `agent-context:<name>` and
is rendered into one `<context>` message per request. Pass-through agents
(D83) keep the legacy path: context is injected once as an `agent-context`
custom message and pinned in the transcript, guarded by agent name. That path
is current behavior, not the target — see
[docs/20-implementation/20-kernel/00-overview.md](../20-implementation/20-kernel/00-overview.md).

### D83. No Universal State Schema; the Base Agent Is a Normal Agent (new)

Status: decided.

Decision: The kernel defines no state schema. An agent with no `state.ts` is
a completely normal agent: its state is its messages, no state block, no XML
ceremony, nothing imposed. A rich agent extends the same object with its own
domain shape, which the kernel never looks inside.

"Normal agent" comes in two flavors, and the difference is opt-in
configuration (D85), never a kernel default:

- **Pass-through** — no `state.ts` and no window config. The kernel registers
  nothing and the session behaves byte-identically to a session run before
  the state layer existed: unbounded history, no window, no elision marker.
  Strict back-compat is the point.
- **Base module** — window config but no `state.ts`. The kernel supplies a
  bookkeeping-only state and the default renderer, which emits the
  conversation as a rolling window of real messages with one elision marker
  where history was cut.

This is the load-bearing piece of the model. The schema-free base case is
what lets one kernel serve a plain conversational agent and a board editor
with the same contract and no special cases — the difference is which
components the agent's state has, not which code path runs.

Inside a window, images past a newest-K cap degrade to one-line stubs before
whole turns drop. There is no compaction step anywhere, because nothing
accumulates to compact — and an agent that opts into no window is not
compacted either, it is simply left as it is today.

Implementation note (as built): `stateExtensionEnabled` is the
gate — a `state.ts` sidecar or a `state.window` manifest block. Neither means
the extension is not registered at all, which is what makes the pass-through
guarantee mechanical rather than a promise. Contract:
[docs/20-implementation/20-kernel/00-overview.md](../20-implementation/20-kernel/00-overview.md).

### D84. The `state.ts` Contract — seed / update / render (new; extends D76)

Status: decided.

Decision: An agent that wants more than the base behavior ships a `state.ts`
sidecar in the agent directory, attached by filename convention like
`context.ts` and `tools.ts`, exporting three functions:

```ts
seed(ctx: SpawnContext, prior?: S): S;
update(state: S, event: SessionEvent): S;
render(state: S, ctx: RenderContext): RenderOutput;
```

The kernel decides *when* these run; the agent decides *what* they mean. `S`
is the agent's own type and the kernel never inspects it. One requirement
holds over it: `S` must be JSON-serializable, because it snapshots to
`state.json` (D88).

`render` owns the entire request body after ① and ② — the state block and
whatever recent conversation it chooses to emit as real messages. There is
no kernel-side renderer competing with it for that region, and no kernel
opinion about what a state block looks like.

The exact `SessionEvent` shape `update` receives is deliberately left to the
kernel build stage.

Implementation note (as built): `render` returns either a bare
`AgentMessage[]` — every message counts as conversation tail — or
`{ messages, stateMessageCount }`, where the leading `stateMessageCount`
messages are the state block(s) and the rest is the tail. That count is how
the renderer declares the split *within* section ③, which is what the
three-section builder turns into `state` and `tail` boundaries and the viewer
renders structurally (D90). The kernel still has no opinion about what a
state block contains — only about where the renderer says it ends.

### D85. Window Policy Is Per-Agent Configuration (new)

Status: decided.

Decision: How much conversation renders is per-agent configuration, not a
kernel rule. The kernel ships sizing strategies — turn count, token budget,
more as they are needed — and each agent's config picks and tunes one.
Default sizes per strategy are decided at the kernel build stage.

One invariant is kernel-owned and not configurable: **cuts land only on turn
boundaries**. An assistant `toolCall` and its `toolResult` are never split,
because providers reject orphaned halves.

### D86. Update Per Event, Catch-Up in `context`, Render Per Request (new)

Status: decided.

Decision: `update` is fed one event at a time, in order, as the session
advances — user message, tool call, tool result, turn boundary — driven by
Pi's blocking hooks. `render` runs once per provider request, inside the
`context` hook. Before rendering, `context` applies any events `update` has
not yet seen (catch-up) and only then renders; when everything is current
this costs one comparison.

Rationale: measured on `@earendil-works/pi-*@0.82.1`, the message and turn
hooks block the loop in order, and `context` is the only hook that can
rewrite the outgoing message array — non-destructively, affecting exactly one
request and never feeding forward. Per-event update keeps the state current
without a batch step; the catch-up line is what makes a retry, or the first
request of a new prompt, unable to render stale state.
The measurements live in `spikes/pi-hook-blocking/RESULTS.md`. Two facts
from them carry the design: the `context` hook's result lands in a
per-request copy (Pi hands handlers a `structuredClone` and uses the result
for exactly one request), so state can never live in the message array — it
lives in kernel storage and is rendered in; and `await session.prompt()`
resolves only after every lifecycle handler settles (0.82.1 also ships an
explicit `agent_settled` hook), so end-of-run is a real barrier.

Implementation note (as built): there is no per-`tool_call` hook
in the wiring. User-message, tool-call, and tool-result events are *derived*
from the session message array and folded by pumps hung on `message_end`,
`tool_result`, `turn_end`, and `context`; only the turn boundary is
hook-derived, because the transcript cannot reconstruct one. Because every
pump folds from a single cursor to the array's end, catch-up is idempotent by
construction rather than by dedupe bookkeeping — the property the decision
was after. Same ordering, same guarantee, fewer hooks.

### D87. Seeding Comes From SpawnContext; Prior State Only When Passed (new)

Status: decided.

Decision: `seed` receives the same `SpawnContext` the context loaders receive
today — session data, agent config, cwd — plus, optionally, a prior run's
final state passed in explicitly by the caller. The kernel never auto-loads a
previous state file.

Rationale: automatic rehydration would make a spawn's starting state a
function of whatever happened to be on disk, which is precisely the kind of
invisible input the trace cannot explain. Continuity is a caller decision and
should be visible as one.

### D88. Persistence v1 Is a `state.json` Snapshot (new)

Status: decided.

Decision: v1 persists state as a snapshot only — `state.json`, written after
each update batch under `.agent-kernel/state/<container>/<agent>/`, through
the emission sink seam (D92). No action log and no artifact byte-store yet.

The snapshot is also what enforces the JSON-serializable requirement on `S`
from day one, and what makes state inspectable as an ordinary file while the
model is being piloted.

### D89. No Kernel-Shipped State Tools (new)

Status: decided.

Decision: The kernel ships no state-mutation tools. An agent that wants a
notes channel, a scratchpad, or an explicit memory write declares its own
tool in `tools.ts` and handles the resulting event in `update` like any other
event.

This is an explicit rejection of the kernel-provided `remember`-style tool
considered during the interview. Such a tool would put a second writer on
state the kernel is not allowed to look inside, and would add a capability to
every agent's tool surface that most agents do not want. `update` is already
the single writer; keeping it the only one is what makes state transitions
explainable from the event stream.

### D90. Full Request Snapshots Stay and Gain Section Tags (new)

Status: decided.

Decision: Per-turn request snapshots keep capturing the full outgoing window
into content-addressed trace blobs. The builder additionally marks where ①,
②, and ③ begin, so the viewer can render the exact context window a turn ran
on as three sections — the turn renderer.

Demoting snapshots to a hash receipt — store the hash, drop the bytes — was
considered and rejected. The point of the pilot is being able to read the
window the model actually saw; a receipt only proves that two windows
differed, at exactly the moment the question is *how*.

### D91. Resume Means Multi-Prompt Continuity, Not Crash Recovery (new)

Status: decided.

Decision: "Resume" in v1 means a long-running session taking message after
message: state lives in the extension across prompts and `update` keeps
folding it forward. This is inherent in the model rather than a feature.

Crash recovery — rebuilding a live agent from persisted state after process
death — is explicitly out of scope for v1. `state.json` (D88) is written for
inspection and transfer, not as a resume image.

### D92. One Sink Shape Now, Remote Sink at the Sandbox Stage (extends D74, D75)

Status: decided.

Decision: Trace events, request snapshots, and state writes all emit through
the same *sink shape* — `submit()`/`flush()` behind a serialized promise
tail, the pattern the kernel already had in `TraceWriterSink`. In v1 the
binding is local: `trace.db` plus `state.json`. The sandbox stage adds the
remote binding — spool file → drain loop → POST — as a sink swap, with no
conditional paths in the emitter and the same durability semantics in both
topologies.

Two channels ride the seams: the state channel is acked and deduped on the
state version; the observability channel is droppable under backpressure. Ack
and backpressure specifics are decided at the sandbox stage.

Rationale: getting runs, traces, and state out of a sandbox is designed with
v1 and built at stage 5 (D97). Designing it later is what produces a fork
between local and sandbox emission; building it later against a seam that
already exists does not.

The boundary the sandbox stage draws is a lifetime split, not a format
change: `trace.db` is the durable record and must not share the sandbox's
fate, while Pi's session JSONL and the app's session directories are
run-local and presumed lost with the machine. In a sandbox the kernel writes
only a run-local directory and the trace database lives with the receiver;
on a single machine the two collapse back into one `.agent-kernel/` folder —
a deployment concern, not a code fork. The remote binding's emit step is a
local spool-file append, never a network call, so it cannot block the agent;
the drain loop reads forward from a committed cursor and advances it only on
success.

Implementation note (as built): this is two structurally
identical seams, not one interface — `TraceWriterSink` (trace events, request
snapshots) and `StateSink` (state snapshots), each `submit()`/`flush()` with
a serialized tail, each swappable independently. That satisfies what the
decision was for: transfer-out is a binding change on both seams, with no
conditional paths in the emitter or the state extension. Whether the two
collapse into one interface is open, and is a sandbox-stage call — it only
matters once a single remote transport carries both channels.

### D93. The Canvas Layout-Editor Is the v1 Pilot (new)

Status: decided.

Decision: The canvas layout-editor is the pilot agent for the state model.
The core code lives in the kernel; the pilot only supplies its own `state.ts`.

Section split: `capabilities`, `style_guide`, and the exemplar /
contact-sheet images stay in section ② as reference material. The
`board_state`, `editor_state`, and `user_requests` spawn loaders retire as
loaders and become state, seeded from the same `sessionData` they read today.

Section ③ policy: **full board every turn** (so it is never stale),
**close-ups on demand** through the `look` tool, **diff always visible**.
State tracks the work *around* the canvas document — scope, applied ops,
lints, views, the request queue — and never holds a copy of the document,
which stays authoritative where it lives and is re-derived into the board
block each request. Close-up policy and image caps are decided at the canvas
build stage.

### D94. Retired: the Fold / Projection Vocabulary and the Three-Store Model (retires the fold/projection explainer's model)

Status: decided.

Decision: The fold/projection vocabulary and the three-store framing — a
state document, the diffs not yet folded into it, and the message history,
compiled together per request — are retired. "Fold" is `update`; "project"
is `render`; the three stores collapse into one state object whose
components include the messages (D81).

The explainer that carried the fold/projection model is retired with it. The
measured Pi 0.82.1 hook behavior that still underpins the wiring survives in
`spikes/pi-hook-blocking/RESULTS.md` and is summarized in D86.

Rationale: three stores meant three places a fact could live and sync rules
between them. The unfolded-diff store existed only because folding was
assumed too expensive to run on the critical path; the 0.82.1 measurements
removed that assumption, and with it the store.

### D95. Rejected: a Universal State Frame (new)

Status: decided.

Decision: A kernel-imposed universal state frame — every agent's state
carrying the same top-level fields, sketched during the interview as
focus / actions / decisions — was considered and rejected. The kernel defines
no fields.

Rationale: such a frame only fits agents whose work happens to decompose that
way. A board editor's state is a board; a plain agent's state is its messages.
A universal frame forces both into vocabulary that describes neither, and
makes the kernel responsible for the meaning of state it cannot interpret.
D83 is the positive form of this decision.

### D96. Rejected: State as a Transcript-Derived Cache (new)

Status: decided.

Decision: Modeling state as a derived cache over an append-only transcript —
the transcript remaining the source of truth, state being a recomputable
compression of it — was considered and rejected. The state object is the
source of truth, and the messages are one of its components (D81).

Rationale: a derived cache has to answer what happens when it disagrees with
its source, and the answer is always "rebuild it", which brings replay,
invalidation, and versioning along behind it. It also inverts what the model
is for: a board's current geometry is not a compression of the conversation
that produced it, and domain state that no message contains would have no
home at all.

### D97. Build Order — Docs, Kernel, Viewer, Canvas, Sandbox (new)

Status: decided.

Decision: The state model ships in five stages, in this order:

1. **Docs** — the design record, iterated until the state representation is
   right. Sign-off gates everything after it.
2. **Kernel** — the seed/update/render contract, the three-section builder,
   window policies, snapshot section tags, state through the sink seam.
   Proves base agents behave like normal agents.
3. **Viewer** — the three-section turn view. Proves every window is visible
   while piloting.
4. **Canvas** — board v1 `state.ts`; the three picture loaders retire. Proves
   the rich case on a real agent.
5. **Sandbox** — spool/drain/remote sink and the acked state channel, built
   and verified working rather than only designed.

### D98. The Bundle Is Four Sections, Mirroring the Request (extends D5, D76)

Status: decided.

Decision: An agent bundle is `agent.json` plus four sections — prompt,
context, tools, state — and each section has two legal shapes: a single file,
or a folder with an `index.ts` entry point.

```text
catalog/<agent>/
  agent.json                              the index: model, thinking, maxTurns, window
  prompt.json    | prompt/prompt.json     ① source of truth
  prompt.rendered.md | prompt/system.md   generated markdown render — never hand-edited
  context.ts     | context/index.ts       ② the inventory of standing context
  tools.ts       | tools/index.ts         the action surface
  state.ts       | state/index.ts         ③ how each turn is handled
```

The bundle mirrors the request (D82): read the tree top to bottom and you
read the request left to right. Everything that defines *one* agent is one
vertical slice narrowed by runtime role — rather than horizontal repo layers
where all loaders live together, all styles live together, and nothing is
attributable to the agent it serves.

The rules that make the tree load-bearing rather than cosmetic:

- **`prompt.json` is the source of truth; the markdown beside it is
  generated.** It is rendered through the same prompt-kit `renderXmlMarkdown`
  the registry uses to build the system prompt, so the file on disk is
  byte-for-byte the prompt body the model receives, under a generated-file
  header. It is committed for reading and diffing, never hand-edited, and
  never parsed.
- **Scale-down rule.** Every folder collapses back to a single file, and the
  file form stays permanently legal — `state.ts` alone is not a legacy shape.
  A base agent is `agent.json` plus a prompt; the *absence* of the other
  sections is the statement that it is a plain agent (D83).
- **File-first resolution.** Per section the file form is tried first, the
  folder form second. When both exist the file wins **silently** — that is
  what lets a migration leave a one-line re-export shim at the old path —
  and the losing path is recorded so `doctor --catalog` can report it. A
  prompt missing in *both* forms is a boot error naming both paths. Folder
  internals are unconstrained and invisible to discovery: `index.ts` is the
  only entry point, and `prompt/system.md` is never consulted.
- **Declarations live in bundles; loader implementations stay
  app-registered.** The vertical slice owns what *this* agent's context
  contains, not the machinery that loads it — the D25/D40 boundary is
  unchanged by the tree. That includes spawn-rendered artifacts: a contact
  sheet that exists only at runtime lives in the bundle as the *recipe* that
  produces and attaches it.
- **Sharing is the rule of two.** An asset lives inside one agent's bundle
  until a second agent needs it; then the *bytes* promote to
  `catalog/_shared/`, while each consumer still declares it in its own
  context section. Library *code* stays in `src/`. The test: does this feed a
  section of *this* agent's request, or is it machinery any agent could run?

A convention the pilot set and rich bundles follow: tools, update rules, and
render blocks pair by name — `tools/apply-operation.ts` defines an action,
`state/rules/operations.ts` defines what that action makes true, and
`state/render/ops.ts` defines how that truth is shown. One concern, three
files, same name.

Rationale: the four sections were already the runtime's real decomposition —
D82 named them in the request, D84 gave three of them a contract — but the
bundle still expressed them as four flat files, which caps an agent at
however much fits in one file per section. A rich agent's context inventory,
per-event update rules, and per-block renderers each want their own files;
without folders they either sprawl into one unreadable module or leak
sideways into shared repo layers where they stop being attributable to an
agent. Folders make the slice hold at any size, and the file-first rule means
nothing about the simple case changes.

Implementation note (as built): resolution lives in
`agent-registry/registry/bundle-layout.ts`; `AgentDefinition` gained
`bundleLayout` (resolved form + shadowed path per section) and
`renderedPromptFile`. `agent-registry/prompt-snapshot.ts` and the
`agent-kernel-render-prompts` bin generate the markdown render (with a
`--check` mode for CI); `runCatalogDoctor` and `doctor-cli --catalog
[--strict]` audit layouts. Every bundle in both repos is folder-form; the
canvas layout-editor — the exemplar, in its own repo — matches the tree
above.
Implementation:
[docs/20-implementation/20-kernel/00-overview.md](../20-implementation/20-kernel/00-overview.md).

---

## Amendments — 2026-07-28 Viewer Overhaul

The trace viewer was reworked across roughly twenty review rounds with Ford.
Almost all of it is UX and belongs to the viewer's design record — the layout
standard, the rejected alternatives, and the review outcomes live in the
[viewer model](40-viewer-model.md), and the structural decisions behind the
viewer packages are recorded under
[docs/20-implementation/60-viewer/](../20-implementation/60-viewer/00-overview.md).
Only the one decision that crossed into the kernel and the protocol is
recorded here.

### D99. Kernel-Authored Request Lines Are Wire-Marked (new; extends D82, D90)

Status: decided.

Decision: The synthetic messages the three-section builder puts into a request
— the rebuilt ② context message and whatever section ③'s renderer emits around
the conversation tail — are authored as Pi **custom messages**: `role:
"custom"` with a `kernel:`-prefixed `customType`, carrying `display: false`.
Pi's `convertToLlm` converts them to ordinary user messages with the same
content blocks on the way to the provider, so they are provider-valid on the
wire while remaining distinguishable everywhere else.

The customType constants live in `@agent-kernel/protocol`
(`kernel-messages.ts`), not in the kernel, because the marker is **wire-
visible**: it survives into the sanitized message blobs a request snapshot
references, and the viewer reads it back to badge those lines KERNEL instead
of USER. Two constants are defined — `kernel:context` for section ② and
`kernel:state` for section ③ — plus the prefix test `isKernelAuthoredMessage`,
which deliberately ignores custom messages an app extension authored.

The same module owns the **image-elision envelope**. When the window replaces
an old image block with a text placeholder (D85), the replacement is plain
text with no structural marker of its own, so producer and consumer must share
the exact envelope: `imageElisionMarkerText(description)` builds it and
`isImageElisionMarker(value)` recognizes it. The description is deliberately
opaque, so adding an image MIME type or a byte-size unit does not require a
viewer release.

Rationale: before this, the only way for a reader to tell a kernel-authored
line from something the user said was position — "it fell inside the snapshot's
state range". Position is the right rule for *authorship of a section* (D90's
section tags), but it is the wrong rule for *authorship of a message*: a
provider that transports an attached-render message as `role: "user"` makes a
kernel line indistinguishable from a user turn the moment it moves. A
wire-visible marker makes the answer intrinsic to the message and survives
every hop the message takes. Putting it in the protocol package rather than
the kernel is what keeps producer and consumer from drifting: the viewer never
re-derives the rule, it imports it.

Source: as-built — `packages/protocol/src/kernel-messages.ts`,
`packages/kernel/src/state/kernel-messages.ts`, and viewer-ui's
`snapshot-message-view.tsx` / `turn/turn-block-content.tsx`. UX context:
detail-view-options.html §6 (the deferred "badge the state render's
attachments correctly" row, now closed at the producer).
