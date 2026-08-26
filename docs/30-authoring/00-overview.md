---
covers: "Task-facing guidance for choosing and editing the files in an Agent Kernel bundle: the agent.json manifest, prompt, context, tools, state, validation, and canonical examples."
concepts: [agent-authoring, agent-bundle, agent-json, prompt, context-sidecar, tools-sidecar, state-sidecar, bundle-layout]
code-ref: examples/simple-research-kernel/src/agent-catalog/, packages/kernel/src/agent-registry/
depends-on: [../10-system-design/60-prompt-system-model.md, ../10-system-design/10-runtime-model.md]
---

# Agent Authoring

Start with the kind of change, then edit the smallest bundle section that owns it.

This tier is a declared **guides extension**: task-facing how-to material for bundle authors. It is non-normative — authority over behavior and contracts stays with [10-system-design](../10-system-design/00-overview.md), and authority over code structure stays with [20-implementation](../20-implementation/00-overview.md). Where this tier and those layers disagree, the layers win and this tier has a bug.

---

## Route the Change

| Change | Touch |
|---|---|
| Create an agent | Add `agent.json` and one prompt form. Add `context`, `tools`, or `state` only when the agent needs them. |
| Change identity, model settings, variables, variants, shared/core tool access, or window configuration | Edit `agent.json`. Update prompt variable nodes when a declaration changes. |
| Change stable model behavior | Edit `prompt.json` or `prompt/prompt.json`, then regenerate its Markdown snapshot. Use the prompt-kit repo, `docs/30-prompt-structure/`, for prompt design. |
| Change runtime material | Edit [the context sidecar](10-context-sidecar.md) for standing reference material; edit [the state sidecar](20-state-sidecar.md) for the live working picture and conversation window. |
| Change the action surface | Edit [the tools sidecar](30-tools-sidecar.md) for private tools or `agent.json` for shared/core tool access. |

For generated snapshots, boot checks, catalog doctor, or viewer expectations, use [Validation and Inspection](40-validation.md). Changes to the registry, request builder, traces, or viewer are implementation work rather than bundle authoring; follow the [kernel implementation overview](../20-implementation/20-kernel/00-overview.md).

## Bundle Anatomy

An agent bundle is one directory containing `agent.json` plus four runtime sections: prompt, context, tools, and state. Prompt is required. Context, tools, and state are optional.

```text
agent-catalog/<agent-name>/
  agent.json                              manifest and registry entry
  prompt.json    | prompt/prompt.json     ① prompt source of truth
  prompt.rendered.md | prompt/system.md   generated; never hand-edit
  context.ts     | context/index.ts       ② standing reference material
  tools.ts       | tools/index.ts         action surface
  state.ts       | state/index.ts         ③ live working state and turn window
```

The layout follows D98 in the [prompt-system design record](../10-system-design/60-prompt-system-model.md). Each section may stay as one file or expand into a folder whose listed entry point is the only discovered file. Resolution is file first, folder second. If both forms exist, the file wins and catalog doctor reports the shadowed folder. Folder internals remain private to the section.

`agent.json` owns the durable manifest: identity and description; model, thinking, and turn settings; runtime placement (`host`); shared/core tool configuration; variable declarations; variants; and optional state-window configuration. Section sidecars attach by filename convention rather than explicit imports.

`host` declares where the agent may run. `"app"` — the default when the field is absent — means the bundle runs only inside its owning app harness: its sidecars may import app services, and standalone harnesses (the pi TUI, sub-agent spawns outside the app) classify it from the manifest without evaluating those sidecars. `"any"` means the bundle is standalone-safe: every sidecar must load under plain Node with no app runtime — catalog doctor's host portability check (`agent-kernel-doctor --catalog`) verifies this. Declare `"any"` only when it is true; the declaration is trusted, not probed.

`disallowedTools` is enforced in every runtime: the spawn pipeline applies it
as the session tool disallowlist, and the pi TUI blocks the listed built-ins
at `tool_call` while the agent is active (interactive sessions keep their
built-in tools, so blocking is the enforcement). Use it to force an agent's
mutations through its own typed tools sidecar while leaving reads open — e.g.
`docs-writer` disallows `write` and `edit` and writes docs only through its
validated `docs_write` tool.

There is no authored `agent.ts` entry point in the current bundle contract. Older guidance that assigns manifest or composition responsibilities to `agent.ts` is obsolete; those responsibilities belong to `agent.json` and the convention-discovered sections. The [runtime model](../10-system-design/10-runtime-model.md) is authoritative for discovery and normalization.

## The Four Sections

| Section | Authoring responsibility | Request boundary |
|---|---|---|
| Prompt | Stable behavior expressed as a PromptKit `PromptDocument` in JSON. | ① system prompt |
| Context | Load and assemble standing reference material that should remain visible. | ② rebuilt context message |
| Tools | Declare private executable actions and bind their runtime services. | Provider tool schemas and execution |
| State | Seed, update, and render the moving work picture plus the chosen conversation tail. | ③ rendered state |

The canonical prompt order is `purpose`, optional `goal`, `state_structure`, `workflow`, optional `error_handling`, optional `success_criteria`, then `rules` last. Do not add a tools section, context-inventory section, or reminders section. Tool guidance belongs in context ②, executable schemas belong to the tool layer, and the full prompt-structure treatment belongs in the prompt-kit repo, `docs/30-prompt-structure/`.

Every prompt variable must be declared in `agent.json`; every declaration must match actual prompt usage. Keep PromptKit generic: kernel runtime configuration, context loading, private tool implementation, and state transitions stay outside the prompt document.

Section ② contains standing reference material. Anything that moves during the run belongs to section ③, including the conversation tail. For the complete state contract and three-section request assembly, use the [runtime model's state section](../10-system-design/10-runtime-model.md) rather than duplicating those internals here.

## Non-Negotiables

1. Author `agent.json` and PromptKit JSON; do not create `agent.ts`, `prompt.ts`, or an authored `agent.md` as bundle sources.
2. Treat `prompt.json` or `prompt/prompt.json` as the prompt source of truth. Regenerate the adjacent Markdown snapshot; never hand-edit it.
3. Put dynamic reference loading in context, private actions in tools, and live working state in state. Do not move those runtime concerns into PromptKit.
4. Treat viewer pages, rendered prompts, combined request views, and traces as derived inspection surfaces, not authored bundle files.
5. Treat `.prompt-runs/` as retired outside a future prompt-building kernel or application.

Keep an asset inside one bundle until a second agent needs the same bytes. At that point, promote the bytes to `agent-catalog/_shared/`, while each consuming agent continues to declare the asset in its own context section.

## Canonical Examples

The Simple Research Kernel catalog contains the current folder-form examples:

- [Research coordinator](../../examples/simple-research-kernel/src/agent-catalog/research-coordinator/) — manifest, prompt, context, private tools, variants, and coordinator actions.
- [Source scout](../../examples/simple-research-kernel/src/agent-catalog/source-scout/) — focused variables, context loading, and a private report-writing tool.
- [Synthesis writer](../../examples/simple-research-kernel/src/agent-catalog/synthesis-writer/) — a smaller specialist bundle using the same section boundaries.

Use these bundles for layout and runtime-boundary examples. Use the prompt-kit repo, `docs/30-prompt-structure/`, for canonical prompt structure.

## Design References

- [Runtime Model](../10-system-design/10-runtime-model.md) — bundle discovery and boot validation, context assembly, the full state contract, and three-section request assembly.
- [Observability Model](../10-system-design/20-observability-model.md) — request snapshots: section tags and the exact request captured for inspection.
- [Kernel area page](../20-implementation/20-kernel/00-overview.md) — the structural decisions behind the bundle layout (D98 file-or-folder resolution, committed prompt renders, sidecar harvest).
