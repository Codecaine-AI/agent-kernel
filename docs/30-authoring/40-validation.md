---
covers: "How to validate an authored agent bundle: static boot checks, runtime-only failures, generated prompt checks, catalog layout checks, and viewer inspection."
concepts: [agent-authoring, validation, registry-boot, runtime-traces, catalog-doctor, agent-viewer]
code-ref: packages/kernel/src/agent-registry/, packages/kernel/src/doctor.ts, packages/kernel/src/catalog-service.ts, packages/viewer-ui/src/agent-viewer/, packages/viewer-ui/src/trace-viewer/
depends-on: [00-overview.md, ../20-implementation/20-kernel/20-agent-registry.md, ../20-implementation/20-kernel/60-agent-state.md, ../20-implementation/60-viewer/00-overview.md]
---

# Validation

Run static checks after every bundle change, then inspect one representative runtime trace. Static validation can prove the bundle is loadable; only a spawn can exercise dynamic data and tool behavior.

## Authoring Check

1. If the prompt changed, regenerate its committed Markdown render, then verify it is current:

   ```sh
   bunx agent-kernel-render-prompts <catalog-root>
   bunx agent-kernel-render-prompts --check <catalog-root>
   ```

2. Boot the registry through the application's normal startup or its catalog test. Boot reports all affected agent errors together.
3. Check file-or-folder collisions:

   ```sh
   bunx agent-kernel-doctor --catalog <catalog-root> --strict
   ```

4. Open the agent lab and inspect the System, Context, and fixture-backed State views that the bundle exposes.
5. Run a representative spawn and inspect its Turn view, tool results, and context lifecycle events.

Prompt structure itself belongs in the prompt-kit repo, `docs/30-prompt-structure/`; this guide validates the kernel bundle around it.

---

## Catch at Boot

Fix these before running an agent:

- `agent.json` is missing, unparseable, schema-invalid, or collides by agent name; this includes invalid `state.window` fields.
- `prompt.json` is missing or malformed, its PromptKit tree is invalid, its variable references are undeclared, or manifest declarations drift from prompt usage.
- a tool profile is unknown, a private tool registration cannot be harvested, or a spawner names an agent outside the catalog.
- a context, tools, or state sidecar exports the wrong shape; a state sidecar must provide `seed`, `update`, and `render`.

The registry's current aggregate checks are recorded in [Agent Registry](../20-implementation/20-kernel/20-agent-registry.md). Keep static failures at this boundary instead of converting them into runtime warnings.

## Catch at Runtime

Expect these to appear in trace events or execution results because their inputs do not exist at boot:

- a session- or working-directory file is missing
- app or database state is unavailable
- a context loader returns empty data or throws
- a tool execution fails
- a subagent fails

Context loaders report `ok`, `empty`, or `error` through lifecycle events. Make the assembler's treatment of each status explicit, and test any path that must stop the run instead of rendering degraded context.

## Viewer Expectations

Use the viewer as inspection evidence, not as another authored artifact:

- The agent lab renders the canonical system prompt, resolved Context preview, manifest diagnostics, variables, and revisions.
- Fixture-backed State preview must reflect the selected fixture's variable overlay and state sample; no fixtures means no State view.
- A captured Turn exposes State, Context, System prompt, and Tools as separate views of the actual request; the Tools view is the roster available on that request.
- Kernel-authored context/state lines carry the **KERNEL** badge, while real conversation remains distinguishable in Messages ([D99](../10-system-design/60-prompt-system-model.md#d99-kernel-authored-request-lines-are-wire-marked-new-extends-d82-d90)).
- Runtime-only loader, tool, and subagent failures remain visible in traces with enough input and error detail to reproduce them.

Do not author a combined/effective prompt file. The agent lab intentionally has no combined System + Context editing view; inspect composed runtime input on trace events and captured Turns.

For the as-built viewer surfaces, see [Viewer Packages](../20-implementation/60-viewer/00-overview.md).
