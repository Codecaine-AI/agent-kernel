---
covers: "Mapping from original Spectre documentation to the promoted kernel documentation and Spectre adapter documentation."
concepts: [docs-migration, source-map, spectre-docs, kernel-docs, adapter-docs]
depends-on: [../00-overview.md, ../70-app-adapters/00-overview.md]
---

# Source Doc Map

The kernel docs were promoted from Spectre docs, but they were not copied verbatim. Spectre-specific names and paths were rewritten into portable kernel terms.

---

## Promoted Into Kernel Docs

| Original Spectre Doc | Kernel Destination |
|---|---|
| `docs/.drafts/agent-kernel-platform.design.md` | `docs/00-foundation/*`, `docs/10-system-design/*` |
| `docs/.drafts/agent-kernel-contracts.design.md` | `docs/10-system-design/30-event-protocol.md`, `docs/20-implementation/*` |
| `docs/20-implementation/10-backend/10-agent-kernel/00-overview.md` | `docs/20-implementation/20-kernel/00-overview.md` |
| `docs/20-implementation/10-backend/10-agent-kernel/10-pipeline.md` | `docs/20-implementation/20-kernel/10-spawn-pipeline.md` |
| `docs/20-implementation/10-backend/10-agent-kernel/30-adapters.md` | `docs/20-implementation/20-kernel/10-spawn-pipeline.md`, `docs/20-implementation/70-app-adapters/00-overview.md` |
| `docs/20-implementation/10-backend/10-agent-kernel/40-per-agent-loaders.md` | `docs/20-implementation/20-kernel/30-context-loaders.md` |
| `docs/20-implementation/10-backend/10-agent-kernel/60-domain-guard.md` | `docs/20-implementation/20-kernel/10-spawn-pipeline.md` |
| `docs/20-implementation/10-backend/10-agent-kernel/70-subagents/*` | `docs/20-implementation/20-kernel/40-subagents.md` |
| `docs/20-implementation/15-tailer/00-overview.md` | `docs/20-implementation/40-tailer/00-overview.md` |
| `docs/20-implementation/30-database/00-overview.md` | `docs/20-implementation/30-db/00-overview.md` |
| `docs/20-implementation/12-data-backend/00-overview.md` | `docs/20-implementation/50-read-api/00-overview.md` |
| `docs/10-system-design/20-event-system-linkages.md` | `docs/10-system-design/20-observability-model.md` |
| Spectre trace viewer implementation docs and objective notes | `docs/10-system-design/40-viewer-model.md`, `docs/20-implementation/60-viewer/00-overview.md` |

## Stays In Spectre

These remain application docs and should not be absorbed into the kernel:

- Spectre session phase semantics
- `SessionStateManager`
- spec, plan, build, docs, intake, onboarding services
- checkpoint and task graph behavior
- Spectre pending asks and answer routes
- Spectre project/worktree/git behavior
- Spectre phase panels and workflow UI
- Spectre-specific JSONL compatibility markers

Those should be documented as Spectre adapters on top of the kernel.

## Rewrite Terms

| Spectre Term | Kernel Term |
|---|---|
| Spectre session id | `appSessionId` when referring to host correlation |
| Spectre session grouping | container |
| Spectre phase | opaque `phase` label |
| Spectre checkpoint/task group | app workflow metadata |
| `@spectre/database/events` | `@agent-kernel/protocol` |
| Spectre DB trace helpers | `@agent-kernel/db` plus app adapter |
| Spectre trace page | viewer-core/ui/shell packages plus app plugins |
