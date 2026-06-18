<validation_and_handoff>
    <validation_ladder>
        - `git status --short`: identify objective changes and unrelated dirty files.
        - `rg -n "@spectre/" packages`: must show no forbidden platform-to-Spectre imports once boundary enforcement phase is reached.
        - `bun run test:agent-kernel`: validate spawn/runtime/kernel behavior.
        - `bun run test:tailer`: validate ingestion behavior.
        - `bun run test:data-backend`: validate read/query route behavior.
        - `bun run test:backend`: run broader backend validation after kernel/db moves.
        - Frontend trace/viewer tests: use current package scripts after confirming their names from `apps/frontend/package.json`.
        - `bun run test`: final non-frontend full suite if time/environment permits.
    </validation_ladder>

    <artifact_contract>
        - `objectives/agent-kernel-platform-extraction/current_state.md`: must summarize completed phases, commands run, validation status, known risks, and next actions.
        - Package boundary check output: include command and pass/fail summary in `current_state.md`.
        - If database migrations are added, record migration names, backfill behavior, and whether existing local data was preserved.
    </artifact_contract>

    <acceptance_gates>
        - `local_runtime_gate`: Spectre can run locally and spawn agents through `packages/kernel`.
        - `protocol_gate`: trace/event contracts are imported from `packages/protocol` by platform consumers.
        - `db_gate`: kernel observability schema/query helpers live in `packages/db`; Spectre sessions link to containers.
        - `container_gate`: containers support arbitrary nesting and timeline start/end events.
        - `viewer_gate`: current trace page works through viewer packages and kernel read API contracts.
        - `boundary_gate`: platform packages do not import `@spectre/*`.
        - `repo_split_gate`: repo remains single-repo, but package boundaries are ready for later externalization discussion.
    </acceptance_gates>

    <report_contract>
        - Final handoff must list packages created, compatibility adapters left in place, validation commands run, failed/skipped tests, data migration status, and explicit next steps for repo split exploration.
    </report_contract>

    <current_state_update>
        - Update `current_state.md` before any handoff, compaction-sensitive pause, or final response.
        - Include exact commands run and whether they passed, failed, or were skipped.
        - Keep state compact; link files instead of pasting logs.
    </current_state_update>

    <blocked_or_failed_handoff>
        - If implementation cannot continue, preserve partial work, name the failing gate, state the blocking evidence, and define the smallest useful next step.
        - Do not mark the objective complete unless every completion criterion in `goal.md` is proven by current-state evidence.
    </blocked_or_failed_handoff>
</validation_and_handoff>
