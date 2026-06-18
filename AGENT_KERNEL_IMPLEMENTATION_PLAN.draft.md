# Agent Kernel Implementation Plan

Status: Draft
Date: 2026-06-17

This is a working plan for turning Spectre's in-repo agent runtime into a reusable
agent kernel platform. It is based on:

- `docs/.drafts/agent-kernel-platform.design.md`
- `docs/.drafts/agent-kernel-contracts.design.md`
- The current code layout under `apps/backend/src/agent-kernel`,
  `apps/database`, `apps/tailer`, `apps/data-backend`, and `apps/frontend`

The core strategy is: make the platform boundaries true inside this repo first,
then split repositories only after the imports prove the boundary.

## Implementation Objective

Implement the in-repo agent-kernel platform extraction for Spectre up to a
local-ready state.

The objective is to set up neutral platform packages, move the runtime and
observability contracts behind those packages, keep Spectre working as the
reference app, and stop before splitting anything into separate repositories.
At completion, the repo should be ready for a future repo split/submodule or
package publishing discussion, but that split is not part of this objective.

### In Scope

1. Create neutral `packages/*` workspace packages for protocol, db, kernel,
   tailer, viewer-core, viewer-ui, and viewer-shell.
2. Preserve Spectre sessions as app/workflow objects while introducing kernel
   containers as runtime/observability objects.
3. Support arbitrary nested containers as durable rows plus timeline events.
4. Use explicit `createKernel(config)` instances with per-kernel concurrency
   limits.
5. Move kernel runtime code behind the kernel package API.
6. Move kernel-owned schema/query helpers into `packages/db`.
7. Move protocol contracts into `packages/protocol`.
8. Move tailer ingestion behind the platform package boundary.
9. Mount the kernel read API locally in Spectre, initially through
   `apps/data-backend`.
10. Adapt the current Spectre trace page into the base viewer packages.
11. Keep Spectre running locally end to end.
12. Add import-boundary enforcement so platform packages do not import
    `@spectre/*`.

### Out Of Scope

1. Splitting `packages/*` into separate repositories.
2. Publishing packages to a registry.
3. Designing a second application on the kernel.
4. Replacing Spectre's session/workflow model with containers.
5. Promoting Spectre's current pending-ask storage into required kernel core.

### Completion Criteria

The objective is complete when:

1. Spectre runs locally using the in-repo platform packages.
2. Agent spawning works through `packages/kernel`.
3. Trace/event contracts come from `packages/protocol`.
4. Kernel observability tables and query helpers live in `packages/db`.
5. Containers exist as kernel observability/runtime records and support nesting.
6. Spectre sessions remain intact and link to kernel containers.
7. The current trace viewer is functioning through viewer packages and kernel
   read API contracts.
8. Tests pass for backend kernel behavior, tailer ingestion, database actions,
   and viewer trace transforms.
9. Boundary enforcement prevents platform packages from importing Spectre app
   code.
10. The codebase is ready to evaluate repo split mechanics as a separate
    follow-up.

## Current Alignment

- The generic grouping noun is `container`.
- A container is a generalized bound around one or more agents, processes,
  orchestration steps, child containers, or other runtime activity. Containers
  may nest.
- We expect to implement the extraction as one coordinated effort, but each
  phase below should still have its own testable checkpoint so regressions are
  localized.
- `ui_ask_*` should remain a strong protocol candidate because human-agent
  interaction is common across agent platforms. The protocol should support a
  generic ask/suspend/resume event shape, while Spectre can still own its
  current pending-ask tables and workflow-specific ask widgets until the generic
  primitive is proven.
- `packages/db` should be a first-class package. The kernel is the running
  process/runtime for agents; database schema and query helpers should live in a
  separate package and be consumed by the kernel, tailer, read API, and apps.
- The kernel should be designed around explicit instances created with
  `createKernel(config)`. Spectre may use a temporary/default singleton adapter
  during migration, but the real platform API should allow multiple differently
  configured kernels in one process.
- We should try to preserve existing local/dev data through migrations because it
  gives us realistic sessions and traces for testing the viewer. If the migration
  becomes disproportionately expensive, data reset is acceptable because the data
  is useful but not valuable.
- Containers should be represented both as durable database rows and as timeline
  events. The table owns identity, metadata, status, and nesting; start/end
  events own timeline boundaries.
- Containers should support arbitrary nesting from day one.
- Generic asks are a protocol/add-on candidate rather than required kernel core
  behavior. The protocol can define portable ask events, while durable pending
  ask storage can remain app-side or move into an optional package later.
- `TraceSource` should have conventional constants but remain an open string to
  avoid enum migrations and allow extension by apps.
- Concurrency limits should be owned by each kernel instance. A shared scheduler
  can be introduced later if multi-kernel applications need cross-kernel
  resource coordination.
- Platform package names should be neutral immediately.
- Spectre should keep its own `sessions` concept. A Spectre session is a
  workflow/application object that can include spec/plan/build/docs state,
  project/worktree metadata, asks, and app UX. A kernel container is the
  observability/runtime grouping object for agents, processes, nested work, and
  trace timelines. They may often map 1:1, but `containerId` should not replace
  Spectre's `sessionUuid`.
- During the in-repo migration, mount kernel read routes in `apps/data-backend`
  first because it already owns UI-facing reads and trace/debug polling. Keep or
  bridge live streaming through `apps/backend` as needed until the trace writer
  and SSE ownership are cleaner.
- The current Spectre trace page is the best starting point for the base viewer.
  Viewer extraction should adapt the existing page/components into
  `viewer-core`/`viewer-ui` rather than creating a separate visual concept from
  scratch.
- Viewer packages should depend on protocol/API contracts, not database schema.
  The browser should consume kernel read API responses through `viewer-core`;
  Drizzle tables and DB query helpers stay server-side in `packages/db`.

## North Star

Spectre becomes the reference application on top of a reusable platform:

1. `packages/protocol` - event, trace, run, and API type contracts.
2. `packages/kernel` - spawn pipeline, agent registry, loaders, subagents,
   domain guard, and Pi session integration.
3. `packages/db` - kernel-owned Drizzle schema and query helpers.
4. `packages/tailer` - Pi JSONL to kernel trace ingestion.
5. `packages/viewer-core` - API client, SSE client, query hooks, trace transforms.
6. `packages/viewer-ui` - reusable trace/run/container UI components.
7. `packages/viewer-shell` - slot-bearing base viewer application.

Spectre keeps the application layer: agent definitions, workflow state machines,
domain tools, pending asks for v1, project/session UX, worktree/git behavior, and
phase-specific frontend panels.

## Guiding Principles

- Keep Spectre running at every step.
- Extract contracts before moving large folders.
- Prefer compatibility re-exports during transitions over big-bang import churn.
- Do not split repos until `packages/*` has an enforced no-`@spectre/*` boundary.
- Treat the viewer/read API as part of the platform, not an optional add-on.
- Keep workflow semantics app-side. The kernel owns observability identity,
  grouping, run trees, traces, and generic viewing primitives.

## Phase 0: Confirm Public Names

Goal: settle the names that will appear in package APIs, database tables, routes,
and docs.

Likely work:

1. Use `container` as the generic grouping noun.
2. Preserve Spectre `sessionUuid` as an app/workflow identity. Introduce
   `containerId` as a separate kernel observability/runtime identity, with
   explicit linkage between them.
3. Decide whether kernel read routes use `/containers` from day one.
4. Decide package names, for example `@agent-kernel/protocol`,
   `@agent-kernel/kernel`, `@agent-kernel/db`.

Done when:

- The draft design docs and this plan use the same names.
- We have a clear compatibility policy for old Spectre session naming.

## Phase 1: Add Package Scaffolding

Goal: make the monorepo able to host platform packages without changing behavior.

Likely work:

1. Change root `package.json` from `workspaces: ["apps/*"]` to include
   `packages/*`.
2. Add `packages/protocol` with package exports and TypeScript config.
3. Add a tiny import smoke test.
4. Leave all existing app code behavior unchanged.

Done when:

- Existing tests still pass.
- A package under `packages/` can be imported from apps.

## Phase 2: Extract Protocol

Goal: create the protocol package as the first real platform contract.

Likely work:

1. Move the trace envelope, trace levels, kernel event constants, core payload
   types, `SYSTEM_USER_ID`, and span/id helpers into `packages/protocol`.
2. Keep `apps/database/src/events` as a temporary compatibility re-export.
3. Keep a generic ask event family in the protocol if the shape can stay
   platform-neutral. Spectre-specific approval/review payloads can remain app
   extensions on top of that generic ask primitive.
4. Make event typing open-string friendly: known kernel event constants plus
   app/unknown event pass-through.
5. Update tailer, backend kernel, and frontend trace type imports toward
   protocol.

Done when:

- Tailer imports protocol event types.
- Backend kernel imports protocol event types.
- Frontend trace constants come from protocol instead of `@spectre/database`.
- Unknown/app event types can be stored, streamed, and rendered as generic JSON.

## Phase 3: Genericize Context Loading

Goal: remove Spectre workflow state from the kernel context-builder contract.

Likely work:

1. Change `SpawnContext.sessionData` to generic `TSessionData`.
2. Make `AgentContextResolver<TSessionData>` generic.
3. Open `LoaderDeclaration` enough for app-defined loader kinds.
4. Move `inputRefOf()` behavior from a closed switch into loader registration.
5. Remove `checkpoint-slice` from the kernel default catalog.
6. Register `checkpoint-slice` from Spectre as the first custom app loader.
7. Extract a narrow `SkillRegistry` interface; keep Spectre's current skill
   library as one implementation.

Done when:

- Context-builder tests pass.
- `agent-kernel/spawn-pipeline/context` no longer imports `@spectre/shared`.
- Kernel default loaders are only `file`, `directory`, `command`, `text`, and
   `skill`.
- Spectre proves custom loader registration with `checkpoint-slice`.

## Phase 4: Introduce Kernel Initialization

Goal: flip the kernel from reaching into Spectre to receiving app-provided
configuration.

Likely work:

1. Add an `initKernel(config)` surface.
2. Move path constants such as Pi sessions dir and Pi agent dir into kernel
   config.
3. Inject the loader catalog instead of constructing the complete default inside
   `spawnAgent`.
4. Inject shared tool factories instead of importing Spectre's shared tool
   registry.
5. Inject an app context factory instead of constructing Spectre state directly.
6. Consume `packages/db` instead of direct `@spectre/database/actions` imports.

Done when:

- Spectre initializes the kernel during backend boot.
- Kernel runtime code does not need to know Spectre paths, tools, or state
   classes.
- The remaining package extraction is mostly moving files and fixing imports.

## Phase 5: Replace RunContext State Coupling

Goal: make `RunContext` generic while preserving Spectre tools.

Likely work:

1. Change `RunContext.stateManager?: SessionStateManager` to
   `RunContext<TAppContext>.app?: TAppContext`.
2. Define Spectre's app context as something like:

   ```ts
   type SpectreAppContext = {
     stateManager: SessionStateManager;
   };
   ```

3. Move Spectre-specific typed access into a helper like
   `getSpectreRunContext()`.
4. Keep kernel tools limited to kernel fields such as run id, container id, trace
   writer, paths, and Pi session id.

Done when:

- `agent-kernel/run-context.ts` no longer imports Spectre's
  `SessionStateManager`.
- Ask, plan, and session-state tools still work, but they are clearly
  Spectre-side tools.

## Phase 6: Extract Agent Registry

Goal: move the already-generic registry and frontmatter parser into the kernel
package.

Likely work:

1. Move parsing and registry code into `packages/kernel`.
2. Support multiple catalog roots.
3. Have Spectre pass its current `agent-catalog/agents` root at boot.
4. Preserve flat namespace semantics.
5. Keep duplicate agent names as a boot-time error.

Done when:

- Registry tests pass.
- Kernel can boot from one or more roots.
- Spectre agent definitions remain in Spectre.

## Phase 7: Move Kernel Runtime Into `packages/kernel`

Goal: physically move the backend runtime after the contracts are clean.

Likely work:

1. Move spawn pipeline, subagents, domain guard, lifecycle emitter, session
   manager, context machinery, and registry into `packages/kernel`.
2. Keep Spectre concrete tools, services, routes, and agent definitions in
   `apps/backend`.
3. Replace relative imports with package imports.
4. Add a boundary test: `packages/kernel` cannot import `@spectre/*`.

Done when:

- Spectre spawns agents through the kernel package.
- Agent-kernel tests pass.
- Boundary test passes.

## Phase 8: Split Kernel DB From Spectre DB

Goal: make observability storage kernel-owned while Spectre workflow storage stays
app-owned.

Likely work:

1. Create `packages/db` as the home for kernel-owned schema and query helpers.
2. Add a kernel `containers` table.
3. Move or duplicate-then-transition ownership for `pi_agent_sessions`,
   `agent_runs`, and `trace_events`.
4. Keep Spectre `sessions`, phase slices, projects, and pending asks app-side.
5. Add a Spectre session FK to the kernel container row.
6. Backfill existing sessions into containers.
7. Transition trace reads from `session_id` toward `container_id`.
8. Keep compatibility views or aliases during migration if needed.

Done when:

- Kernel observability tables can be imported independently.
- Spectre app tables link to kernel containers while preserving Spectre session
  identity.
- Existing sessions still render.

## Phase 9: Carve Kernel Read API

Goal: stabilize the API contract that viewer-core will target.

Likely work:

1. Add a kernel Elysia route module.
2. Implement:
   - `GET /containers`
   - `GET /containers/:id`
   - `GET /containers/:id/runs`
   - `GET /runs/:id`
   - `GET /runs/:id/events`
   - `GET /containers/:id/stream`
   - `GET /agents`
3. Reuse existing data-backend trace query logic initially.
4. Point Spectre's trace page at these routes.

Done when:

- The trace UI no longer depends on Spectre-specific trace routes.
- Kernel API can render a generic container/run/event browser.

## Phase 10: Extract Viewer-Core

Goal: move frontend data and trace transformation logic before moving UI shell
code.

Likely work:

1. Move API client and SSE client.
2. Move query hooks.
3. Move protocol-based trace row/run/session types.
4. Move trace tree building logic.
5. Remove direct frontend imports from `@spectre/database`.

Done when:

- Spectre trace page uses `viewer-core`.
- Existing trace tests pass.
- No visual redesign is required for this phase.

## Phase 11: Extract Viewer-UI

Goal: move reusable rendering components while leaving Spectre-specific panels in
Spectre.

Likely work:

1. Move trace tree components.
2. Move run inspector components.
3. Move event detail panel components.
4. Move transcript pieces that are protocol-generic.
5. Add generic JSON rendering for unknown/app events.

Done when:

- Spectre trace/debug surfaces compose viewer-ui components.
- Ask widgets and phase-specific panels remain Spectre-side.

## Phase 12: Build Viewer-Shell

Goal: create the base viewer application with plugin slots.

Likely work:

1. Create `<KernelViewer />`.
2. Add plugin slots for:
   - phase panels
   - container header
   - run decorators
   - event renderers
3. Mount the shell inside Spectre.
4. Register Spectre panels for spec, plan, build, docs, and any other workflow
   phases.

Done when:

- Viewer works with zero plugins.
- Spectre customizes through slots instead of owning the whole trace shell.

## Phase 13: Enforce Boundaries

Goal: make accidental reverse imports impossible to miss.

Likely work:

1. Add import boundary tests or lint rules.
2. Forbid `@spectre/*` imports from platform packages.
3. Allow Spectre to import platform packages.
4. Require app events, loaders, and tools to register through public APIs.

Done when:

- CI fails on accidental reverse imports.
- Package boundaries are real enough to split repos.

## Phase 14: Split Repositories

Goal: move the platform out after the package boundaries have already been proven.

Likely work:

1. Move `packages/*` to a new `agent-kernel` repository.
2. Consume the new repository from Spectre as a submodule or pinned workspace link
   during continued development.
3. Publish packages only after the API stabilizes and a second consumer exists.

Done when:

- Spectre runs against the externalized kernel.
- No platform package reaches back into Spectre.
- A second app could plausibly start from kernel plus viewer shell.

## First Practical Milestone

The first milestone should be deliberately small and high-leverage:

1. Add `packages/protocol`.
2. Compatibility re-export from `@spectre/database/events`.
3. Move tailer and backend kernel event imports to protocol.
4. Make context `sessionData` generic.
5. Move `checkpoint-slice` out of the kernel default loader catalog.
6. Keep Spectre `sessionUuid` and kernel `containerId` conceptually separate in
   new contracts, even when they temporarily share values during migration.

This should create the first real platform boundary without touching database
migrations, the viewer shell, or repo topology.

## Open Questions

### Naming

1. Resolved: use `container` as the generic grouping noun.
2. Resolved: `containerId` should not replace Spectre `sessionUuid`. Spectre
   sessions remain app/workflow identities; kernel containers are separate
   observability/runtime identities linked to sessions.
3. Should the kernel read API routes use `/containers` from the first extracted
   route module?

### Protocol

4. Should app event registration include runtime schemas in v1, or should v1 be
   TypeScript-only with unknown event JSON fallback?
5. Working direction: keep a generic ask event family in protocol, while leaving
   Spectre-specific ask persistence and widgets app-side until the shape is
   proven.
6. Working direction: `TraceSource` should expose conventional constants but
   remain typed/stored as an open string.

### Kernel Configuration

7. Working direction: expose an explicit `createKernel(config)` instance API.
   Spectre can use a temporary/default singleton adapter during migration, but
   the platform should support multiple kernels in one process.
8. Working direction: create `packages/db` as a first-class package rather than
   hiding database access behind ad hoc injected helpers.
9. Working direction: concurrency limits are per kernel instance. A shared
   scheduler can be added later only if multi-kernel apps need cross-kernel
   resource coordination.
10. Should shared tool factories be registered globally at kernel init, or passed
   per spawn/application?

### Data Model

11. Working direction: preserve existing data if practical, but allow reset if
    migration complexity outweighs testing value.
12. Working direction: containers are durable rows plus `container_start/end`
    events. The table owns identity/metadata/status/nesting; events own timeline
    boundaries.
13. Working direction: containers support arbitrary nesting from day one.
14. Working direction: introduce containers around the viewer/read API extraction,
    when the UI starts depending on generic container/run/event concepts.
15. Should `trace_events.session_id` be renamed/replaced with `container_id`, or
    should a compatibility view preserve old naming for a while?
16. Working direction: generic ask events may live in protocol as an add-on
    primitive, but durable pending ask storage remains app-side or optional until
    portability is clearer.

### Viewer

17. Resolved: viewer extraction starts from the current Spectre trace page,
    adapting its structure into the base viewer rather than creating a separate
    visual concept from scratch.
18. Which plugin slots are mandatory for v1: phase panels, container header, run
    decorators, event renderers?
19. Should `viewer-shell` depend on Elysia route shapes directly, or only on
    `viewer-core` client interfaces?

### Read API Hosting

20. Where should Spectre mount the kernel read API during the in-repo migration:
    existing `apps/data-backend`, existing `apps/backend`, or a new service?
    Long term, this should be an exported route module from the platform; the
    question is only about the first host while Spectre still has separate
    orchestration and UI-read services.
    Working direction: mount read routes in `apps/data-backend` first; keep or
    bridge live streaming through `apps/backend` temporarily if needed.

### Repo Split

21. Resolved: platform packages should use neutral names immediately.
22. Should the eventual external dependency be a git submodule first, or a private
    package registry from the beginning?
