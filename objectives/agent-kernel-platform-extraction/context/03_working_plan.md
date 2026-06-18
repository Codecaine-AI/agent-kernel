<working_plan>
    <overview>
        1. baseline_and_boundary_audit - Reinspect current code, dirty state, and tests before editing.
        2. package_scaffold_and_protocol - Add neutral package scaffolding and extract protocol contracts.
        3. db_and_container_model - Create `packages/db`, split kernel observability schema, and introduce nested containers.
        4. kernel_runtime_extraction - Move reusable runtime code into `packages/kernel`; keep Spectre as an adapter layer.
        5. tailer_and_read_api - Move ingestion/read contracts behind platform packages and mount read routes in `apps/data-backend`.
        6. viewer_extraction - Adapt the current trace page into viewer-core/ui/shell packages.
        7. boundary_enforcement_and_validation - Add import checks, run validation ladder, and update handoff state.
    </overview>

    <operating_principles>
        - Keep Spectre runnable after each checkpoint.
        - Use compatibility re-exports/adapters when they reduce migration blast radius.
        - Do not rely on memory; inspect current files before each phase.
        - Prefer package boundaries that make repo split boring later.
    </operating_principles>

    <phase id="1" name="baseline_and_boundary_audit">
        <objective>
            - Establish current-state evidence before implementation.
        </objective>
        <inputs>
            - `git status --short`
            - `rg` searches for `@spectre/database/events`, `@spectre/shared`, `SessionStateManager`, `checkpoint-slice`, `TraceEvent`, `EventType`, `agent_runs`, `pi_agent_sessions`.
            - Current package scripts and relevant tests.
        </inputs>
        <process>
            - Identify unrelated dirty files and avoid reverting them.
            - Record current import couplings that must be broken.
            - Run the smallest useful baseline tests before high-risk moves.
        </process>
        <outputs>
            - Updated `current_state.md` with baseline commands and coupling map summary.
        </outputs>
        <gate>
            - Implementation surfaces and unrelated dirty files are known.
        </gate>
        <failure_handling>
            - If baseline tests fail before edits, record failures and decide whether they block platform extraction or are pre-existing.
        </failure_handling>
    </phase>

    <phase id="2" name="package_scaffold_and_protocol">
        <objective>
            - Establish `packages/*` and move event/protocol contracts behind a neutral package.
        </objective>
        <inputs>
            - `apps/database/src/events/`
            - Tailer/backend/frontend imports of event contracts.
        </inputs>
        <process>
            - Add workspace scaffolding.
            - Create `packages/protocol`.
            - Move/copy event contracts, then make `@spectre/database/events` a compatibility surface.
            - Keep protocol open for app/unknown events and open-string trace sources.
            - Update direct low-risk consumers to protocol.
        </process>
        <outputs>
            - `packages/protocol/`
            - Compatibility exports in `apps/database/src/events/`
            - Updated imports where safe.
        </outputs>
        <gate>
            - Tailer and backend kernel event tests pass or failures are localized and documented.
        </gate>
        <failure_handling>
            - If runtime DB enum constraints conflict with open protocol values, keep emitted values backward-compatible and defer storage widening to the DB phase.
        </failure_handling>
    </phase>

    <phase id="3" name="db_and_container_model">
        <objective>
            - Create kernel DB ownership and introduce durable nested containers.
        </objective>
        <inputs>
            - `apps/database/src/schema/`
            - Existing migrations and current trace/session data.
        </inputs>
        <process>
            - Create `packages/db` for kernel observability tables/query helpers.
            - Add `containers` with parent container nesting, metadata/status, and Spectre linkage.
            - Keep Spectre session tables app-side.
            - Design compatibility/backfill path from existing Spectre sessions and trace rows.
        </process>
        <outputs>
            - Kernel DB package.
            - Migration/backfill plan and implementation.
            - Updated schema/query imports.
        </outputs>
        <gate>
            - Existing sessions still render or a deliberate reset path is documented and accepted.
        </gate>
        <failure_handling>
            - If preservation becomes too costly, stop and document exact reset consequences before proceeding.
        </failure_handling>
    </phase>

    <phase id="4" name="kernel_runtime_extraction">
        <objective>
            - Move the reusable runtime into explicit kernel instances and remove Spectre app coupling from kernel-owned code.
        </objective>
        <inputs>
            - `apps/backend/src/agent-kernel/`
            - `apps/backend/src/agent-catalog/`
            - Spectre shared tools and state manager.
        </inputs>
        <process>
            - Introduce `createKernel(config)`.
            - Move agent manager, spawn pipeline primitives, context builder/loaders, system prompt resolver, runtime/session/trace helpers, and generic interfaces into `packages/kernel`.
            - Keep only app adapters in `apps/backend`: Spectre paths, `SessionStateManager`, Spectre agent catalog loaders, workflow tools, app DB binding, and compatibility exports.
            - Make context `sessionData` generic.
            - Move `checkpoint-slice` to Spectre as an app loader.
            - Replace `SessionStateManager` coupling with app context factory.
            - Keep Spectre wrappers/adapters where needed during migration.
        </process>
        <outputs>
            - `packages/kernel/`
            - Spectre kernel initialization code.
            - Updated app tools/loaders.
        </outputs>
        <gate>
            - Agent spawning works through runtime code imported from `@agent-kernel/kernel`; app-side files are adapters, not the runtime owner.
            - `bun run test:agent-kernel` passes or failures are documented.
            - `rg` confirms no Spectre-named runtime/DB core surface remains under `packages/kernel` or `packages/db` except explicitly documented generic compatibility fields.
        </gate>
        <failure_handling>
            - If a module cannot move cleanly, create a temporary adapter with a dated TODO and keep the platform package free of `@spectre/*` imports.
        </failure_handling>
    </phase>

    <phase id="5" name="tailer_and_read_api">
        <objective>
            - Make ingestion and read APIs platform-owned locally.
        </objective>
        <inputs>
            - `apps/tailer/`
            - `apps/data-backend/src/index.ts`
            - Backend SSE/trace writer code.
        </inputs>
        <process>
            - Move tailer logic behind `packages/tailer` or wrap it with a package API.
            - Add kernel read route module.
            - Mount read routes in `apps/data-backend`.
            - Keep or bridge live streaming from `apps/backend` until ownership is clean.
        </process>
        <outputs>
            - `packages/tailer/`
            - Kernel read API route module.
            - Spectre data-backend mount.
        </outputs>
        <gate>
            - Generic container/run/event reads power the trace page data path.
        </gate>
        <failure_handling>
            - If SSE migration is risky, leave streaming bridged and document the remaining ownership gap.
        </failure_handling>
    </phase>

    <phase id="6" name="viewer_extraction">
        <objective>
            - Adapt the current Spectre trace page into reusable viewer packages.
        </objective>
        <inputs>
            - `apps/frontend/src/app/(dashboard)/traces/`
            - `apps/frontend/src/types/trace-event.ts`
            - Current trace-builder tests.
        </inputs>
        <process>
            - Extract API/SSE clients and trace transforms into `viewer-core`.
            - Extract reusable trace/run/container components into `viewer-ui`.
            - Build `viewer-shell` with plugin slots.
            - Keep Spectre phase panels and workflow-specific widgets app-side.
        </process>
        <outputs>
            - `packages/viewer-core/`
            - `packages/viewer-ui/`
            - `packages/viewer-shell/`
            - Spectre trace page using viewer packages.
        </outputs>
        <gate>
            - Current trace page behavior is preserved while imports flow through viewer packages and protocol/API DTOs.
        </gate>
        <failure_handling>
            - If visual parity is uncertain, use side-by-side route or screenshots before replacing the old route.
        </failure_handling>
    </phase>

    <phase id="7" name="boundary_enforcement_and_validation">
        <objective>
            - Prove local-ready state and leave repo-split-ready handoff.
        </objective>
        <inputs>
            - All package code and Spectre integration surfaces.
            - Validation commands in `context/04_validation_and_handoff.md`.
        </inputs>
        <process>
            - Add import boundary checks.
            - Run validation ladder.
            - Update docs/current state with final package map and remaining follow-up decisions.
        </process>
        <outputs>
            - Boundary enforcement.
            - Passing validation evidence.
            - Updated `current_state.md`.
        </outputs>
        <gate>
            - Completion criteria in `goal.md` are proven from current files and command output.
        </gate>
        <failure_handling>
            - If validation fails, keep the goal active, record the failing gate, and continue from the smallest failing package boundary.
        </failure_handling>
    </phase>
</working_plan>
