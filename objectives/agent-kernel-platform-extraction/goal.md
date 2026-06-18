<goal>
    - Implement the in-repo agent-kernel platform extraction for Spectre up to a portable local-ready state.
    - Create neutral platform packages for protocol, db, kernel, tailer, viewer-core, viewer-ui, and viewer-shell.
    - Move the reusable kernel runtime into `packages/kernel`, not merely behind a wrapper: agent manager, spawn pipeline primitives, context builder/loaders, system prompt/runtime/session/trace helpers, and the generic interfaces those pieces need.
    - Keep Spectre-specific behavior in an app adapter layer: workflow/session state, shared paths, Spectre agent catalog loaders, workflow tools, app DB binding, and compatibility routes.
    - Preserve Spectre sessions as app/workflow objects while introducing kernel containers as runtime/observability objects with arbitrary nesting.
    - Keep kernel DB schema and actions neutral; Spectre session linkage must be app-side or represented as generic external/app identity, not as Spectre-named kernel core.
    - Use explicit `createKernel(config)` instances with per-kernel concurrency limits.
    - Mount the kernel read API locally in Spectre and adapt the current trace page into the base viewer.
    - Keep Spectre working end-to-end locally with tests and boundary enforcement.
    - Stop before splitting packages into separate repositories.
</goal>

<context_refresh>
    <required_files>
        - `objectives/agent-kernel-platform-extraction/goal.md`
        - `objectives/agent-kernel-platform-extraction/current_state.md`
        - `objectives/agent-kernel-platform-extraction/context/00_problem.md`
        - `objectives/agent-kernel-platform-extraction/context/01_constraints.md`
        - `objectives/agent-kernel-platform-extraction/context/02_implementation_scope.md`
        - `objectives/agent-kernel-platform-extraction/context/03_working_plan.md`
        - `objectives/agent-kernel-platform-extraction/context/04_validation_and_handoff.md`
        - `AGENT_KERNEL_IMPLEMENTATION_PLAN.draft.md`
        - `docs/.drafts/agent-kernel-platform.design.md`
        - `docs/.drafts/agent-kernel-contracts.design.md`
    </required_files>
    <instruction>
        - At objective start and after resume/compaction, reread the objective bundle first.
        - Treat the objective bundle as the durable operating context; use the draft design files as supporting references.
        - Inspect the current worktree before relying on prior conversation or stale summaries.
    </instruction>
</context_refresh>

<working_strategy>
    - Make the platform boundaries true inside this repo before any repo split.
    - Keep Spectre running at each checkpoint; prefer compatibility layers during transitions.
    - Extract contracts before moving large runtime folders.
    - Keep workflow semantics app-side. Kernel owns observability identity, containers, runs, traces, read API, and generic viewer primitives.
    - Use package names that are neutral immediately, even while packages live inside Spectre.
</working_strategy>

<success_metrics>
    - `packages/*` exists with platform boundaries and neutral package names.
    - Spectre spawns agents through runtime code owned by `packages/kernel`, with only Spectre adapters remaining in `apps/backend`.
    - Trace/event contracts come from `packages/protocol`.
    - Kernel observability schema/query helpers live in `packages/db` without Spectre-named core fields.
    - Kernel containers exist as durable nested records and timeline events.
    - Spectre sessions remain intact and link to kernel containers without being replaced by them.
    - Current trace viewer works through viewer packages and kernel read API contracts.
    - Boundary checks prevent platform packages from importing `@spectre/*` and semantic audits show no Spectre-named kernel DB/runtime surface.
    - Focused backend, tailer, db, and viewer trace-transform tests pass.
</success_metrics>

<non_goals>
    - Do not split packages into separate repositories.
    - Do not publish packages to a registry.
    - Do not design or implement a second app on the kernel.
    - Do not replace Spectre sessions with kernel containers.
    - Do not make Spectre's current pending-ask storage required kernel core.
</non_goals>

<completion_criteria>
    - Spectre runs locally end-to-end using the in-repo platform packages and a clearly isolated Spectre adapter layer.
    - `packages/kernel` owns the reusable runtime/spawn implementation, not just an adapter shell.
    - `packages/db` has no Spectre-named core schema/action surface; app/session compatibility is isolated outside the platform core or represented generically.
    - All success metrics are verified from current files and command output.
    - `current_state.md` records completed work, validation commands, remaining risks, and repo-split readiness.
    - The repo is ready to evaluate submodule/repo-split mechanics as a separate follow-up objective.
</completion_criteria>
