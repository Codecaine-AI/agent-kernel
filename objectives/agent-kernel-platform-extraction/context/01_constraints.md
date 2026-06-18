<constraints>
    <hard_rules>
        - Preserve Spectre `sessions` as app/workflow objects. Do not replace them with kernel containers.
        - Introduce kernel `containers` as runtime/observability grouping objects with arbitrary nesting.
        - Use explicit `createKernel(config)` instances as the real platform API. Temporary default-instance adapters are allowed only for migration convenience.
        - Concurrency limits belong to each kernel instance unless a later objective introduces a shared scheduler.
        - Platform package names must be neutral immediately.
        - Viewer packages must depend on protocol/API contracts, not database schema.
        - Platform packages must not import `@spectre/*` once boundary enforcement is introduced.
        - Stop before splitting packages into separate repositories or publishing.
    </hard_rules>

    <forbidden_shortcuts>
        - `repo_split_first`: invalid because local package boundaries must be proven before externalization.
        - `container_replaces_session`: invalid because Spectre sessions carry app workflow state outside kernel responsibility.
        - `frontend_imports_db`: invalid because viewer packages must be portable browser-side consumers of read API contracts.
        - `singleton_only_kernel`: invalid because future apps may host multiple differently configured kernels in one process.
        - `closed_trace_source_enum`: avoid new closed enums for extensible protocol values unless storage constraints require a compatibility layer.
    </forbidden_shortcuts>

    <data_and_feature_boundaries>
        - Preserve existing dev data if practical because it helps validate viewer migrations against real traces.
        - Data reset is acceptable only if migration complexity outweighs the data's testing value.
        - Generic ask events may live in protocol as an add-on primitive; Spectre pending-ask persistence remains app-side unless a later design promotes it.
    </data_and_feature_boundaries>

    <promotion_or_completion_gates>
        - `local_ready`: Spectre runs locally through in-repo platform packages and tests pass.
        - `boundary_ready`: import checks prove no platform package depends on Spectre app code.
        - `repo_split_ready`: packages are locally extracted and validated, but still in this repo.
    </promotion_or_completion_gates>
</constraints>
