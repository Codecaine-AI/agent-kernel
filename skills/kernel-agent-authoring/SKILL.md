---
name: kernel-agent-authoring
description: Create and edit Agent Kernel typed agent bundles using agent.ts, prompt.ts, context.ts, and tools.ts.
---

# Kernel Agent Authoring

## Purpose

Use this skill to create or edit typed Agent Kernel agents.

The preferred agent shape is:

```text
agent-catalog/<agent-name>/
  agent.ts
  prompt.ts
  context.ts
  tools.ts
```

`prompt.ts` is authored with PromptKit. Use
`../prompt-kit/packages/prompt-kit-agent/skills/prompt-kit-authoring/` whenever designing
or editing the prompt itself.

## Start Here

1. Read `00-routing.md`.
2. Read `10-agent-bundle/00-overview.md`.
3. For `prompt.ts`, use `../prompt-kit/packages/prompt-kit-agent/skills/prompt-kit-authoring/SKILL.md`.
4. Load sidecar references only when needed:
   - `20-prompt-ts/00-overview.md`
   - `30-context-ts/00-overview.md`
   - `40-tools-ts/00-overview.md`
   - `50-validation-and-viewer/00-overview.md`
   - `examples/00-overview.md`

## Non-Negotiables

1. Use typed `agent.ts` as the registry entry point.
2. Use PromptKit `prompt.ts` as the stable prompt source of truth.
3. Do not create authored `agent.md` as the preferred artifact.
4. Declare runtime variables in `agent.ts`.
5. Reference variables from `prompt.ts` with `variable()`.
6. Put dynamic context loading and rendering in `context.ts`.
7. Put private tool definitions/registration in `tools.ts`.
8. Keep PromptKit generic. Do not make prompt-kit own kernel runtime concerns.
9. Treat `.prompt-runs/` as retired outside a future prompt-building kernel/app.

## Boundary

`agent.ts` owns durable runtime configuration.

`prompt.ts` owns stable model behavior.

`context.ts` owns dynamic runtime context packet loading and rendering.

`tools.ts` owns private tools and app-runtime injection.

The viewer and traces should inspect the composed result. They are not authored
source files.
