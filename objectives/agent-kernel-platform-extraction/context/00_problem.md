<problem>
    <objective_question>
        - How do we turn Spectre's in-repo agent runtime, trace storage, tailer, and trace viewer into a reusable in-repo agent-kernel platform while keeping Spectre working as the reference application?
    </objective_question>

    <current_baseline>
        - `apps/backend/src/agent-kernel/`: current spawn pipeline, run context, subagent manager, context loaders, lifecycle emitters, and Pi session integration.
        - `apps/database/src/events/`: current event protocol source of truth, currently mixed into the database package.
        - `apps/database/src/schema/`: current Spectre app tables and kernel-shaped observability tables are mixed together.
        - `apps/tailer/`: current Pi JSONL ingestion service imports database events/schema directly.
        - `apps/data-backend/src/index.ts`: current UI read and trace/debug query routes.
        - `apps/frontend/src/app/(dashboard)/traces/`: current trace viewer, intended to become the base viewer starting point.
    </current_baseline>

    <why_current_state_is_insufficient>
        - Platform-shaped code exists, but ownership boundaries are not true: kernel code imports Spectre services, Spectre DB owns protocol types, frontend imports DB/schema types, and viewer code is app-local.
        - The current shape prevents a second application from reusing the runtime/viewer without also inheriting Spectre workflow semantics.
        - Observability is the product of the kernel, but the read API/viewer contract is currently scattered across Spectre-specific routes and frontend code.
    </why_current_state_is_insufficient>

    <failure_modes>
        - `accidental_app_coupling`: platform packages import `@spectre/*`, making later repo split fake.
        - `session_container_conflation`: kernel containers replace Spectre sessions instead of linking to them as separate observability objects.
        - `viewer_db_coupling`: frontend/viewer packages import Drizzle schema or database helpers instead of protocol/API DTOs.
        - `big_bang_breakage`: large moves happen before compatibility layers and tests exist, leaving Spectre nonfunctional.
        - `premature_repo_split`: packages are externalized before local boundaries are proven.
    </failure_modes>

    <prior_evidence>
        - `docs/.drafts/agent-kernel-platform.design.md`: repo/package topology and kernel-vs-application ownership model.
        - `docs/.drafts/agent-kernel-contracts.design.md`: concrete contract inventory and extraction order.
        - `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`: current alignment decisions and phased implementation sketch.
    </prior_evidence>

    <expected_value>
        - A local Spectre repo that already behaves like Spectre consuming an agent-kernel platform, making future submodule/repo split mostly mechanical.
    </expected_value>
</problem>
