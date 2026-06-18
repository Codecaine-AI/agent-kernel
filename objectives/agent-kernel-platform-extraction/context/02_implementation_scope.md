<implementation_scope>
    <owned_surfaces>
        - `package.json`: workspace expansion to include `packages/*` when implementation begins.
        - `packages/protocol/`: event, trace, run, and API contracts.
        - `packages/db/`: kernel-owned Drizzle schema and query helpers.
        - `packages/kernel/`: spawn pipeline, registry, loaders, subagents, Pi session integration, domain guard, kernel instance API.
        - `packages/tailer/`: Pi JSONL to kernel trace ingestion package boundary.
        - `packages/viewer-core/`: API/SSE clients, query hooks, protocol DTOs, trace transforms.
        - `packages/viewer-ui/`: reusable trace/run/container UI components.
        - `packages/viewer-shell/`: mountable base viewer with plugin slots.
        - `apps/backend/`: Spectre orchestration integration with `createKernel(config)` and migration adapters.
        - `apps/data-backend/`: first host for kernel read API route module.
        - `apps/frontend/`: adapt current trace page to viewer packages.
        - `apps/database/`: split Spectre app schema from kernel DB package while preserving compatibility as needed.
        - `apps/tailer/`: consume platform tailer package or become wrapper around it.
    </owned_surfaces>

    <read_only_references>
        - `docs/.drafts/agent-kernel-platform.design.md`: architectural direction.
        - `docs/.drafts/agent-kernel-contracts.design.md`: contract inventory.
        - `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`: aligned decisions and phase sketch.
        - `docs/20-implementation/`: current system documentation; update only when implementation makes it stale and the change is in scope.
    </read_only_references>

    <commands_and_entrypoints>
        - `bun run test:agent-kernel`: backend kernel behavior slice.
        - `bun run test:tailer`: tailer ingestion slice.
        - `bun run test:data-backend`: data/read route slice.
        - `bun run test:backend`: broad backend validation.
        - `bun run test`: full non-frontend suite currently wired at root.
        - Frontend validation command must be confirmed from current package scripts before use.
    </commands_and_entrypoints>

    <adjacent_surfaces_requiring_caution>
        - `.spectre/`: local runtime/session data may be dirty and should not be reverted casually.
        - Existing unrelated frontend edits under `apps/frontend/` may be user work; inspect before touching.
        - Database migrations can affect dev data; prefer reversible/backfilled migrations when practical.
    </adjacent_surfaces_requiring_caution>

    <out_of_scope>
        - New external `agent-kernel` repository.
        - Registry publishing.
        - Second application implementation.
        - Replacing Spectre's workflow UI with a generic-only viewer.
        - Making human-in-the-loop ask persistence mandatory kernel core.
    </out_of_scope>
</implementation_scope>
