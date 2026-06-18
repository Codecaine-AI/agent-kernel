<current_state>
<last_updated>2026-06-17</last_updated>

<status>
    - Phase 1 baseline audit is complete.
    - Phase 2 package scaffold and protocol extraction is complete.
    - Phase 3 kernel DB package and nested container model is complete.
    - Phase 4 explicit kernel instance checkpoint is complete: Spectre now installs an explicit kernel instance and routes public spawns through it.
    - Phase 5 kernel read API checkpoint is complete: data-backend now mounts a neutral `/kernel/trace-sessions` read API backed by platform query helpers, and the current trace viewer fetches that API.
    - Phase 6 viewer package checkpoint is complete for the active trace page: the current trace route and embedded session debug trace now use `@agent-kernel/viewer-core`, `@agent-kernel/viewer-ui`, and `@agent-kernel/viewer-shell`.
    - Tailer package ownership checkpoint is complete: reusable Pi JSONL mapping, cursoring, watching, queueing, and health code now lives in `@agent-kernel/tailer`; `apps/tailer` is the Spectre wrapper/entrypoint.
    - Boundary enforcement and backend runtime cleanup checkpoints are complete: package imports are guarded, Spectre app loaders/state/paths are installed from app adapters, and platform packages remain free of `@spectre/*` imports.
    - Strict runtime extraction resumed after the premature completion call: `@agent-kernel/db` now uses generic app session identity for PI agent sessions, `@agent-kernel/kernel` owns the reusable spawn runtime/orchestrator, and agent registry/parsing mechanics now live in the kernel package.
    - Final sign-off is complete for the local-ready extraction: Spectre adapters remain in `apps/backend` by design; package runtime/DB/tailer/viewer surfaces use generic app identity and current trace reads prefer `containerId`.
</status>

<completed>
    - Draft implementation plan exists at `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`.
    - Supporting draft designs exist at `docs/.drafts/agent-kernel-platform.design.md` and `docs/.drafts/agent-kernel-contracts.design.md`.
    - Settled decisions: use `container`; keep Spectre sessions separate from kernel containers; use explicit `createKernel(config)` instances; use per-kernel concurrency; use neutral package names; mount kernel read API first in `apps/data-backend`; adapt the current trace page as the base viewer starting point.
    - Data preservation is preferred for testing value, but local/dev data reset is acceptable if migration cost becomes disproportionate.
    - Baseline dirty files identified and should not be reverted as part of this objective unless they become directly relevant:
      `apps/frontend/src/app/(dashboard)/sessions/[sessionId]/_phases/spec/timeline/SpecTimeline.tsx`,
      `apps/frontend/src/app/(dashboard)/sessions/[sessionId]/_phases/spec/views/interview/ChatTab.tsx`,
      and local `.spectre/sessions/.../logs/*` files.
    - Baseline focused validation before extraction edits:
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests.
    - Baseline coupling map:
      `apps/backend/src/agent-kernel`, `apps/tailer`, and frontend trace types import event contracts from `@spectre/database/events`;
      `apps/database/src/schema` mixes Spectre app tables with kernel-shaped observability tables;
      `apps/data-backend/src/index.ts` owns the current Spectre-specific trace/read routes;
      `apps/frontend/src/app/(dashboard)/traces` consumes those Spectre-specific routes and database-shaped DTOs;
      `apps/backend/src/agent-kernel` still imports Spectre app state, shared paths, and `checkpoint-slice` loader code.
    - Added neutral workspace packages:
      `@agent-kernel/protocol`, `@agent-kernel/db`, `@agent-kernel/kernel`,
      `@agent-kernel/tailer`, `@agent-kernel/viewer-core`,
      `@agent-kernel/viewer-ui`, and `@agent-kernel/viewer-shell`.
    - Extracted event protocol contracts/factories to `packages/protocol/src`.
      `apps/database/src/events/*` now re-export `@agent-kernel/protocol` for compatibility.
    - Protocol `EventType`, `EventData`, and `TraceSource` are open-string/open-payload friendly. The initial extraction preserved a `"spectre"` compatibility source value; the later trace-source cleanup removed it from protocol and storage surfaces.
    - Updated direct event-contract consumers in backend kernel, tailer, frontend trace types, and database trace actions to import `@agent-kernel/protocol`.
    - Boundary smoke:
      `rg -n "@spectre/" packages` produced no matches.
    - Post-protocol focused validation:
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun test apps/database/src/events` passed with 7 tests.
    - Added `@agent-kernel/db` schema/actions/types for kernel observability tables:
      `containers`, `pi_agent_sessions`, `agent_runs`, and `trace_events`.
      Spectre's `@spectre/database` now re-exports compatibility schema/actions for those kernel-owned tables.
    - Added durable nested `containers` schema with `parent_container_id`, metadata, phase vocabulary, open status, timestamps, and indexes.
    - Added app-side `sessions.kernel_container_id` link so Spectre sessions remain workflow rows while linking each to a root kernel container.
    - Added migration `apps/database/migrations/0022_agent_kernel_containers.sql`.
      It creates `containers`, adds `sessions.kernel_container_id` and `trace_events.container_id`,
      backfills one `spectre-session:<session_id>` root container per existing Spectre session,
      links sessions to those root containers, and backfills existing trace rows to the root container.
    - New Spectre sessions create/link a root kernel container in `apps/database/src/actions/sessions.ts`.
    - Trace writes now populate `container_id` through Spectre compatibility paths:
      backend writer uses the `insertTraceEventsBatch` wrapper and tailer direct inserts fall back to `spectre-session:<session_id>`.
    - Post-DB focused validation:
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `rg -n "@spectre/" packages` produced no matches.
    - Added neutral `createKernel(config)` API in `packages/kernel/src/index.ts`.
      It exposes a spawn adapter boundary, per-instance `maxBackgroundAgents` concurrency config,
      manager-like injection, runtime concurrency updates, and disposal.
    - Added package-level coverage in `packages/kernel/src/index.test.ts`;
      `bun test packages/kernel/src` passed with 2 tests.
    - Added Spectre backend adapter `apps/backend/src/agent-kernel/kernel-instance.ts`.
      `createSpectreKernel()` builds a `@agent-kernel/kernel` instance using the current Spectre `spawn-pipeline` as the runtime adapter and an instance-owned `AgentManager`.
    - Backend boot now calls `initSpectreKernel()` instead of directly initializing an `AgentManager`.
      The legacy public `spawnAgent`, `initAgentManager`, `getAgentManager`, and `__resetAgentManagerForTests` exports delegate through the installed Spectre kernel instance.
    - `AgentManager` now accepts an injected spawn adapter while defaulting to the current `spawn-pipeline` export for isolated tests.
      The deep `subagents/manager-singleton.ts` compatibility module also delegates to the installed kernel instance.
    - The durable-ask resume path now imports `spawnAgent` from the `agent-kernel` public barrel, so resumed asks route through the explicit kernel instance.
    - Phase 4 checkpoint validation:
      `bun test packages/kernel/src` passed with 2 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `rg -n "@spectre/" packages` produced no matches,
      `rg -n "import \\{ spawnAgent \\} from .*spawn-pipeline|from .*spawn-pipeline/spawn-agent" apps/backend/src -g '*.ts'` produced no remaining runtime deep-spawn imports.
    - Phase 4 broad backend validation initially exposed order-sensitive test mock leakage in
      `services/spec/__tests__/notify-spec-revised.test.ts` and
      `agent-kernel/spawn-pipeline/context/__tests__/fresh-spawn-injection.test.ts`.
      This was later hardened before final root validation.
    - Extracted the Spectre trace span transform into `packages/viewer-core/src`.
      The package now owns neutral viewer DTOs in `types.ts`, `buildTraceSpans()`, and trace-builder helpers for pairing events, run bucketing, phase/container grouping, nesting, span attributes, and span factories.
    - Added `packages/viewer-core/src/trace-builder/linkage-resolution.test.ts` to cover explicit container/phase/tool-use linkage behavior in the package.
      The test preserves current behavior where explicit `container_id` wins and orphan spans can still fall back to the tightest time-containing container.
    - Updated Spectre frontend compatibility types:
      `apps/frontend/src/types/trace-event.ts` and `apps/frontend/src/types/pi-agent-session.ts` now re-export viewer-core DTOs instead of inferring browser types from `@spectre/database` Drizzle schema.
    - Updated `apps/frontend/src/app/(dashboard)/traces/session/[id]/_hooks/useTraceData.ts` to import `buildTraceSpans()` and the detail response contract from `@agent-kernel/viewer-core`.
      This means the current trace page uses the viewer-core package for its data transform while retaining the existing UI components.
    - Viewer-core checkpoint validation:
      `bun test packages/viewer-core/src` passed with 7 tests,
      `bunx tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bun run --cwd apps/frontend build` passed,
      `rg -n "@spectre/database" apps/frontend/src/types apps/frontend/src/app/\(dashboard\)/traces packages/viewer-core/src -g '*.ts' -g '*.tsx'` produced no matches,
      `rg -n "@spectre/" packages` produced no matches.
    - Post-viewer-core focused validation:
      `bun test packages/kernel/src` passed with 2 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun test apps/database/src/events` passed with 7 tests.
    - Added `packages/viewer-core/src/api.ts` with `KERNEL_TRACE_READ_PATHS` for `/kernel/trace-sessions`, `/kernel/trace-sessions/:id`, and `/kernel/containers/:containerId/trace`.
      Expanded viewer-core DTOs with `KernelContainerSummary`, `KernelTraceSessionSummary`, `KernelTraceSessionListResponse`, and container fields on `KernelTraceSessionDetail`.
    - Added `packages/db/src/actions/read-api.ts` with platform query helpers:
      `listContainerTree()` and `getKernelTraceReadRows()`.
      The helper reads root/descendant containers, PI sessions, agent runs, and trace events by container identity, with an injected `legacySessionId` bridge so backfilled Spectre session rows still render.
    - Added `packages/kernel/src/read-api.ts`, a neutral Elysia route factory `createKernelTraceReadApi()`.
      It accepts an injected `KernelTraceReadService`, exposes list/detail/container-trace routes, clamps limits, and has route-module coverage in `packages/kernel/src/read-api.test.ts`.
    - Mounted the kernel read API in `apps/data-backend/src/index.ts`.
      The Spectre adapter resolves either `sessions.id` or `sessions.kernel_container_id` to the root kernel container, maps rows into viewer-core DTOs, and preserves the old `/traces/spectre-sessions` routes for compatibility.
    - Updated the active trace viewer data path:
      `apps/frontend/src/app/(dashboard)/traces/page.tsx` now fetches `KERNEL_TRACE_READ_PATHS.listTraceSessions`,
      and `apps/frontend/src/app/(dashboard)/traces/session/[id]/_hooks/useTraceData.ts` now polls `KERNEL_TRACE_READ_PATHS.traceSessionDetail(id)`.
    - Kernel read API checkpoint validation:
      `bun test packages/kernel/src` passed with 5 tests,
      `bun test packages/viewer-core/src` passed with 7 tests,
      `bunx tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bun run test:data-backend` passed with 2 tests,
      `bun run --cwd apps/frontend build` passed,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `bunx tsc -p apps/data-backend/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/db/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/kernel/tsconfig.json --noEmit` passed.
    - Boundary scans after the kernel read API checkpoint:
      `rg -n "@spectre/" packages -g '*.ts' -g '*.tsx' -g 'package.json'` produced no matches,
      `rg -n "@spectre/database" apps/frontend/src/types apps/frontend/src/app/\(dashboard\)/traces packages/viewer-core/src -g '*.ts' -g '*.tsx'` produced no matches,
      `rg -n "/traces/spectre-sessions" apps/frontend/src/app/\(dashboard\)/traces apps/frontend/src/types packages/viewer-core/src -g '*.ts' -g '*.tsx'` produced no matches.
    - Extracted reusable trace viewer UI into `packages/viewer-ui/src`:
      `TreeView`, `SpanCard`/variants, span style helpers, trace tree utilities,
      and `SpanDetailPanel` with neutral JSON/prompt/detail renderers.
      The package has no Spectre app imports or app path aliases.
    - Added `packages/viewer-shell/src/KernelTraceViewer.tsx`, a mountable split-pane base trace viewer with trace-level controls, expand/collapse, selected-span detail, and initial plugin slots (`containerHeader`, `treeToolbarTrailing`, `emptyState`, `detailPlaceholder`).
    - Updated Spectre consumers:
      `apps/frontend/src/app/(dashboard)/traces/session/[id]/page.tsx` mounts `KernelTraceViewer`,
      and `apps/frontend/src/app/(dashboard)/sessions/[sessionId]/_components/debug/DebugToolbar.tsx` uses the same shell for embedded debug traces.
    - Retired duplicated app-local trace viewer/trace-builder copies after all active imports moved to packages:
      removed `apps/frontend/src/components/trace-viewer`,
      `apps/frontend/src/app/(dashboard)/traces/session/[id]/_components/{PrismTreeViewPanel,SpanDetailPanel,TraceAgentActivityTree}.tsx`,
      app-local trace detail-panel files, and app-local `_lib` trace-builder/span helper files.
    - Viewer UI/shell checkpoint validation:
      `bunx tsc -p packages/viewer-ui/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/viewer-shell/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bun test packages/viewer-core/src` passed with 7 tests,
      `bun run --cwd apps/frontend build` passed,
      `bun run test:data-backend` passed with 2 tests,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun test apps/database/src/events` passed with 7 tests.
    - Boundary scans after the viewer UI/shell checkpoint:
      `rg -n "@spectre/" packages -g '*.ts' -g '*.tsx' -g 'package.json'` produced no matches,
      `rg -n "@spectre/database|components/trace-viewer|_components/PrismTreeViewPanel|_components/SpanDetailPanel|_components/detail-panel|_lib/buildTraceSpans|_lib/trace-builder|_lib/findSpan|_lib/filterSpansByTraceLevel|_lib/spanStyle|_lib/correlateToolCalls" apps/frontend/src/app/\(dashboard\)/traces apps/frontend/src/types packages/viewer-core/src packages/viewer-ui/src packages/viewer-shell/src -g '*.ts' -g '*.tsx'` produced no matches.
    - Moved tailer implementation ownership into `packages/tailer/src`:
      generic `createTailerConfig()`, `EventMapper`, `EventQueue`, `CursorStore`, `FileReader`, `DirectoryWatcher`, Pi JSONL types, and health route live in `@agent-kernel/tailer`.
      The package receives config, event binding names, and persistence callbacks instead of importing Spectre paths or database modules.
    - Left `apps/tailer` as the Spectre integration wrapper:
      it supplies `PI_SESSIONS_DIR`/`TAILER_SNAPSHOT_PATH`, configures the current `spectre-session`, `spectre:pi-lifecycle`, and `spectre:subagent-link` JSONL custom events, preserves Spectre metadata aliases for compatibility, and keeps Drizzle `onConflictDoNothing()` trace-event writes app-side.
    - Tailer ownership checkpoint validation:
      `bunx tsc -p packages/tailer/tsconfig.json --noEmit` passed,
      `bunx tsc -p apps/tailer/tsconfig.json --noEmit` passed,
      `bun run test:tailer` passed with 133 tests,
      `rg -n "@spectre/" packages -g '*.ts' -g '*.tsx' -g 'package.json'` produced no matches.
    - Added boundary enforcement in `scripts/check-package-boundaries.ts`.
      The root `package.json` now exposes `bun run test:boundaries`, and root `bun run test` starts with the package boundary check before backend/tailer/data-backend suites.
    - Backend runtime cleanup moved Spectre-only context out of portable default wiring:
      `SpawnContext.sessionData` is an app-owned structural snapshot,
      portable `createDefaultCatalog()` registers only base loaders,
      `checkpoint-slice` lives under `apps/backend/src/agent-catalog/loaders/`,
      and `createSpectreContextCatalog()` registers the Spectre loader app-side.
    - Backend spawn defaults now enter through the Spectre adapter:
      `apps/backend/src/agent-kernel/kernel-instance.ts` owns `PI_AGENT_DIR`,
      `PI_SESSIONS_DIR`, and lazy `SessionStateManager` loading, while lower
      spawn pipeline code consumes injected `piAgentDir`, `piSessionsDir`, and
      structural `RunStateManagerLike` options.
    - Backend runtime observability writes now import platform DB actions:
      `apps/backend/src/agent-kernel/spawn-pipeline/spawn-agent.ts` imports
      `updateAgentRunStatus` from `@agent-kernel/db/actions`.
    - Final boundary/package validation on 2026-06-17:
      `bun run test:boundaries` passed,
      `rg -n "@spectre/" packages -g '*.ts' -g '*.tsx' -g 'package.json'` produced no matches,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun test packages/viewer-core/src` passed with 7 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `bunx tsc -p packages/tailer/tsconfig.json --noEmit` passed,
      `bunx tsc -p apps/tailer/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/viewer-ui/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/viewer-shell/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/db/tsconfig.json --noEmit` passed,
      `bunx tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      and `bunx tsc -p apps/data-backend/tsconfig.json --noEmit` passed.
    - Final focused app validation on 2026-06-17:
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      and `bun run --cwd apps/frontend build` passed.
      The frontend build emitted only Vite's existing large-chunk warning.
    - Hardened the broad backend suite's order-sensitive tests:
      `apps/backend/src/api/spec/apply-hunk.ts` now exposes test-only injection hooks for
      `notifySpecRevised` and filesystem access, spec route tests use those hooks instead
      of process-wide mocks, the completion-service filesystem mock passes through real
      unmocked functions, and fresh-spawn injection tests isolate temp cwd/session paths.
    - Mock-leakage focused validation on 2026-06-17:
      `bun test apps/backend/src/api/spec/__tests__/apply-hunk.notify.test.ts apps/backend/src/api/spec/__tests__/apply-hunk.test.ts apps/backend/src/api/spec/__tests__/reject-hunk.test.ts apps/backend/src/services/completion/__tests__/completion-service.test.ts apps/backend/src/agent-kernel/spawn-pipeline/context/__tests__/fresh-spawn-injection.test.ts`
      passed with 25 tests.
    - Broad backend/root validation on 2026-06-17:
      `bun run test:backend` passed with 649 tests, and
      `bun run test` passed the boundary check plus backend, tailer, and data-backend suites
      with 649 backend tests, 133 tailer tests, and 2 data-backend tests.
    - Final viewer boundary scan on 2026-06-17:
      `rg -n "@spectre/database|components/trace-viewer|_components/PrismTreeViewPanel|_components/SpanDetailPanel|_components/detail-panel|_lib/buildTraceSpans|_lib/trace-builder|_lib/findSpan|_lib/filterSpansByTraceLevel|_lib/spanStyle|_lib/correlateToolCalls" apps/frontend/src/app/\(dashboard\)/traces apps/frontend/src/types packages/viewer-core/src packages/viewer-ui/src packages/viewer-shell/src -g '*.ts' -g '*.tsx'`
      produced no matches.
    - Corrected the DB identity leak in the kernel PI-session surface:
      `packages/db/src/schema/pi-agent-sessions.ts`, db actions, read API helpers,
      viewer-core DTOs, tailer/data-backend/backend callers, and related tests now use
      `appSessionId` / `app_session_id` instead of `spectreSessionId` /
      `spectre_session_id` for the PI agent session link.
    - Added migration `apps/database/migrations/0023_pi_agent_sessions_app_session_id.sql`.
      It drops the old Spectre-named FK/index, renames `spectre_session_id` to
      `app_session_id`, and creates `ix_pi_agent_sessions_app_session_id`.
    - Moved the reusable backend runtime into `packages/kernel/src/spawn-pipeline/`:
      `createSpawnAgent(adapters)` owns the spawn ordering, system prompt resolution,
      Pi session factory, lifecycle/context/agent-run trace emission, session manager
      creation, durable ask resume helpers, turn-limit streaming, runtime state, run
      context construction, domain guard, model resolution, tool scoping, and PI lifecycle
      logging.
    - `apps/backend/src/agent-kernel/spawn-pipeline/spawn-agent.ts` is now a Spectre
      adapter over `createSpawnAgent()`. It supplies Spectre agent loading, private/shared
      tool factories, `createSpectreContextCatalog()`, `getSpectreDb()`, `.spectre`
      prior-session path behavior, `spectre-session` / `spectre:pi-lifecycle` custom
      event names, and app logger wiring.
    - App-side compatibility modules under `apps/backend/src/agent-kernel/spawn-pipeline`
      now mostly re-export package-owned runtime modules. Spectre-specific adapter code
      remains in `kernel-instance.ts`, `spawn-agent.ts`, agent module resolver files,
      app context/catalog wrappers, and Spectre loader/tool wiring.
    - Added Pi SDK dependencies to `packages/kernel/package.json` because the kernel
      package now owns Pi session creation directly.
    - Runtime extraction checkpoint validation on 2026-06-17:
      `bunx --bun tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:boundaries` passed,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bunx --bun tsc -p packages/db/tsconfig.json --noEmit` passed,
      and `rg -n "@spectre|\\.spectre|spectre|skill-library|agent-catalog|apps/backend" packages/kernel/src -g '*.ts'`
      produced no matches.
    - Cleaned up trace source branding after the strict runtime pass:
      `packages/protocol/src/envelope.ts` no longer exports `SPECTRE_COMPAT`;
      protocol factories emit `TraceSource.KERNEL` / `TraceSource.AGENT`;
      `packages/db/src/schema/trace-events.ts` stores `source` as open `varchar`;
      and tailer queue writes normalize legacy `"spectre"` source rows to `"kernel"`.
    - Added migration `apps/database/migrations/0024_trace_source_varchar.sql`.
      It converts stored `source='spectre'` rows to `source='kernel'`, changes the
      trace source column to `varchar`, and drops the old enum type.
    - Removed the Spectre-specific loader kind from kernel-owned context types:
      `packages/kernel/src/context/loaders/types.ts` now exposes base kernel loader
      declarations plus generic custom loader declarations; `checkpoint-slice` is
      defined and registered in the Spectre app layer.
    - Moved generic agent definition parsing and registry mechanics into
      `packages/kernel/src/agent-registry/`. The package now owns frontmatter parsing,
      variable validation, private-tool declaration enforcement, registry construction,
      and the registry singleton. It requires an app-provided catalog root rather than
      defaulting to Spectre paths.
    - Spectre's `apps/backend/src/agent-catalog/parsing/*` and
      `apps/backend/src/agent-catalog/registry/*` are now compatibility wrappers over
      `@agent-kernel/kernel/agent-registry`; `registry.ts` is the app adapter that
      supplies the Spectre agents directory as the default catalog root.
    - Clarified the PI-session app identity API:
      `packages/db/src/actions/pi-agent-sessions.ts` now exposes
      `listPiAgentSessionsForAppSession()` without a session-named package alias.
      Spectre's `apps/database/src/actions/pi-agent-sessions.ts` keeps
      `listPiAgentSessionsForSession()` as an app-side compatibility export only.
    - Removed the trace-event app identity compatibility leak:
      `packages/protocol`, `packages/db`, viewer DTOs, data-backend adapters,
      frontend trace details, tailer wrappers, and database compatibility
      actions now use `appSessionId` / `app_session_id` for the host app
      identity instead of legacy `sessionId` / `session_id` on kernel trace
      events.
    - Added migration `apps/database/migrations/0025_trace_events_app_session_id.sql`.
      It drops the old `trace_events.session_id` indexes and FK to Spectre
      `sessions`, renames the column to `app_session_id`, and creates the
      app-session indexes under neutral names.
    - Tightened the generic trace-event insert helper in `@agent-kernel/db`:
      package code no longer derives `container_id` from `app_session_id`.
      Spectre's compatibility action and tailer wrapper still provide
      `spectre-session:<session_id>` root-container ids app-side.
    - Resumed validation after the trace identity/FK cleanup on 2026-06-17:
      `bunx --bun tsc -p packages/protocol/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/db/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-ui/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-shell/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p apps/data-backend/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p apps/tailer/tsconfig.json --noEmit` passed,
      `bun run test:boundaries` passed,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun run test:backend` passed with 649 tests,
      and `bun run --cwd apps/frontend build` passed with Vite's existing large-chunk warning.
    - Resumed package semantic scans on 2026-06-17:
      `rg -n "@spectre/|\\.spectre|spectre|Spectre|SPECTRE|apps/backend|agent-catalog|checkpoint-slice|SessionStateManager" packages/kernel/src packages/db/src packages/protocol/src -g '*.ts' -g '*.tsx' -g 'package.json'`
      produced no matches. A current-schema scan for legacy trace/session DB names under
      `packages/db`, `packages/protocol`, viewer-core, database schema/actions,
      data-backend, tailer, and frontend trace surfaces found only app-side
      `pending_asks.session_id`.
    - Post-resume validation on 2026-06-17:
      `bunx --bun tsc -p packages/protocol/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/db/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/tailer/tsconfig.json --noEmit` passed,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun test apps/backend/src/agent-catalog/parsing apps/backend/src/agent-catalog/registry` passed with 27 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      `bun run test:tailer` passed with 133 tests,
      `bun run test:data-backend` passed with 2 tests,
      `bun test apps/database/src/events` passed with 7 tests,
      `bun run test:boundaries` passed,
      `bun run test` passed boundary + backend 649 + tailer 133 + data-backend 2 tests,
      and `bun run --cwd apps/frontend build` passed with Vite's existing large-chunk warning.
    - Post-resume package semantic scans on 2026-06-17:
      `rg -n "@spectre|\\.spectre|spectre|Spectre|SPECTRE|apps/backend|agent-catalog|checkpoint-slice|SessionStateManager" packages/kernel/src packages/db/src packages/protocol/src -g '*.ts'`
      produced no matches, and `bun run test:boundaries` confirmed no `@spectre/*`
      references under `packages/`.
    - Final kernel app-identity contract cleanup on 2026-06-17:
      `packages/kernel` now carries preferred `appSessionId` / `appSessionSlug`
      / `appSessionDir` fields through `RunContext`, subagent spawn options,
      runtime state, lifecycle emitters, and agent-run trace helpers. The older
      `sessionUuid` / `sessionSlug` / `sessionDir` names have been removed from
      package surfaces and remain only in Spectre app adapters/callers/tests.
      `createSpawnAgent()` now fails explicitly when `appSessionId` is missing
      from the DB-backed spawn path instead of passing an undefined identity
      into PI-session/run tracking.
    - Final kernel identity validation on 2026-06-17:
      `bunx --bun tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun run test:agent-kernel` passed with 189 tests,
      and `bun run test:boundaries` passed.
    - Final package identity cleanup on 2026-06-17:
      `packages/db/src/actions/pi-agent-sessions.ts` no longer exports
      `listPiAgentSessionsForSession`; the compatibility name is isolated to
      `apps/database/src/actions/pi-agent-sessions.ts`.
    - Final semantic scans on 2026-06-17:
      `rg -n "@spectre/" packages -g '*.ts' -g '*.tsx' -g 'package.json'`
      produced no matches;
      `rg -n "@spectre|\\.spectre|spectre|Spectre|SPECTRE|apps/backend|agent-catalog|checkpoint-slice|SessionStateManager" packages/kernel/src packages/db/src packages/protocol/src packages/tailer/src -g '*.ts' -g '*.tsx' -g 'package.json'`
      produced no matches;
      `rg -n "sessionUuid|sessionSlug|sessionDir|spectreSessionId|spectre_session_id|listPiAgentSessionsForSession" packages/kernel/src packages/tailer/src packages/viewer-core/src packages/db/src packages/protocol/src -g '*.ts' -g '*.tsx'`
      produced no matches.
    - Final validation on 2026-06-17:
      `bunx --bun tsc -p packages/protocol/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/db/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/kernel/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/tailer/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-core/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-ui/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p packages/viewer-shell/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p apps/data-backend/tsconfig.json --noEmit` passed,
      `bunx --bun tsc -p apps/tailer/tsconfig.json --noEmit` passed,
      `bun run test:boundaries` passed,
      `bun test packages/kernel/src` passed with 5 tests,
      `bun test packages/viewer-core/src` passed with 7 tests,
      `bun run test` passed boundary + backend 649 + tailer 133 + data-backend 2 tests,
      and `bun run --cwd apps/frontend build` passed with Vite's existing large-chunk warning.
</completed>

<final_sign_off>
    - Local runtime ownership now matches the intended package/app layering for the audited surfaces: package-owned kernel code drives spawns, context building, agent registry/parsing, PI session creation, subagent management, DB observability writes, tailer internals, read API contracts, and viewer packages through app-provided adapters.
    - Spectre owns the adapter layer: `.spectre` paths, `SessionStateManager`, Spectre agent catalog/module loading, workflow tools, compatibility JSONL event names, app DB binding, and compatibility read/routes.
    - No repo split, submodule conversion, or package publishing has been started; that remains the next objective.
</final_sign_off>

<next_actions>
    - Keep Spectre-only concerns app-side: session/workflow state, `@spectre/shared/paths`, Spectre agent catalog loaders, workflow tools, and compatibility route adapters.
    - Consider moving ancillary app queries such as `usePiSessionLabels` from `/traces/spectre-sessions/:id` to the kernel read API or a narrower app adapter.
    - In a follow-up objective, evaluate repo split/submodule/package mechanics using the current in-repo package boundaries as the source of truth.
</next_actions>

<risks_or_open_questions>
    - App event registration schema depth is not finalized: runtime schemas vs TypeScript-only plus JSON fallback.
    - `@agent-kernel/db` still stores `app_session_id` on trace rows as a generic host-app correlation field. Current trace reads prefer `containerId` and only use app-session identity as a compatibility bridge for existing Spectre rows.
    - Full runtime movement is not the same as removing all app adapters: Spectre app adapters still own app-specific state manager loading, shared paths, agent-catalog loaders, and workflow tools by design.
    - The package spawn orchestrator depends on the Pi SDK directly. That is intentional for this checkpoint, but should be called out explicitly in any repo-split/package design.
    - Kernel read API list/detail routes are mounted and active for the trace viewer, but ancillary phase timeline consumers still use the compatibility `/traces/spectre-sessions/:id` route through `usePiSessionLabels`.
    - Viewer plugin slots are intentionally minimal v1 slots; future app needs may require expanding `KernelViewerPlugins`.
    - Externalization mechanism after local-ready state remains out of scope: git submodule vs registry is a later decision.
</risks_or_open_questions>

<important_paths>
    - `objectives/agent-kernel-platform-extraction/goal.md`
    - `objectives/agent-kernel-platform-extraction/context/`
    - `packages/kernel/src/read-api.ts`
    - `packages/kernel/src/agent-registry/`
    - `packages/kernel/src/spawn-pipeline/spawn-agent.ts`
    - `packages/db/src/actions/read-api.ts`
    - `packages/db/src/actions/pi-agent-sessions.ts`
    - `packages/viewer-core/src/api.ts`
    - `packages/viewer-ui/src/`
    - `packages/viewer-shell/src/`
    - `packages/tailer/src/`
    - `scripts/check-package-boundaries.ts`
    - `apps/tailer/src/`
    - `apps/data-backend/src/index.ts`
    - `apps/backend/src/agent-kernel/kernel-instance.ts`
    - `apps/backend/src/agent-catalog/loaders/`
    - `apps/frontend/src/app/(dashboard)/traces/`
    - `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`
    - `docs/.drafts/agent-kernel-platform.design.md`
    - `docs/.drafts/agent-kernel-contracts.design.md`
</important_paths>
</current_state>
