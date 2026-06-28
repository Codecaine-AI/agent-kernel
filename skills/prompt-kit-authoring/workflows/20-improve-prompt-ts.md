---
covers: Workflow for improving an existing PromptKit prompt.ts.
concepts: [prompt-improvement, qa, refactor]
---

# Improve `prompt.ts`

Use this workflow for existing PromptKit prompts.

## Steps

1. Read the existing source.
2. Identify the prompt's intended job.
3. Check current archetype and section shape.
4. Diagnose anti-patterns and PromptKit misuse.
5. Edit the PromptKit source.
6. Review rendered shape when practical.
7. Summarize changes and remaining risk.

## Common Fixes

- Convert raw placeholders to `variable()`.
- Replace hand-rendered XML strings with builders.
- Move runtime context details out of the stable prompt.
- Add `usesContext()` when context policy is implicit.
- Merge duplicate rules.
- Add literal `output_format` when output shape drifts.
- Cut overbuilt workflow steps.
- Add success criteria only when they change behavior.
