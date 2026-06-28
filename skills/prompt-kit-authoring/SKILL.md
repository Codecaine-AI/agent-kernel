---
name: prompt-kit-authoring
description: Create, improve, and review PromptKit prompt artifacts, usually prompt.ts files that export PromptDocument objects.
---

# PromptKit Authoring

## Purpose

Use this skill to create or improve prompts authored with
`@codecaine-ai/prompt-kit`.

The default artifact is a full PromptKit prompt source, usually:

```text
prompt.ts
```

The authored source of truth is a `PromptDocument`. Rendered XML-tagged Markdown
is an output artifact used for review, traces, viewer previews, and model input.

## Start Here

1. Read `00-routing.md` to choose the artifact path.
2. Read `05-authoring-model.md` for PromptKit ownership and boundaries.
3. Read `08-core-methodology.md` for the default interactive workflow.
4. Load the relevant references:
   - PromptKit primitives: `10-prompt-kit/`
   - Techniques and thinking context: `20-techniques/`
   - QA and rendered review: `30-qa/`
   - Task workflows: `workflows/`

## Non-Negotiables

1. Do not create `.prompt-runs/` for ordinary PromptKit authoring.
2. Do not make rendered Markdown the source of truth.
3. Use `singleOutputPrompt` for one bounded input-to-output task.
4. Use `workflowPrompt` for prompts with an explicit process.
5. Treat `agentPrompt` as optional convenience, not as a third core archetype.
6. Use `variable()` for dynamic variable references.
7. Use `usesContext()` for prompt-side instructions about runtime context.
8. Keep runtime context loading, tool registration, traces, and agent registry
   behavior outside PromptKit.
9. Inspect the rendered XML-tagged Markdown during QA when practical.
10. Every section must earn its token cost.

## Default Output

Prefer complete PromptKit artifacts:

```ts
import {
  bulletList,
  orderedList,
  paragraph,
  section,
  variable,
  workflowPrompt,
} from "@codecaine-ai/prompt-kit";

export const prompt = workflowPrompt({
  id: "examplePrompt",
  title: "Example",
  purpose: [paragraph("State the concrete job.")],
  workflow: [orderedList(["Read the input.", "Produce the output."])],
  sections: [
    section("output_format", [
      paragraph("Return the final answer in the requested schema."),
    ]),
  ],
});

export default prompt;
```

For reviews or quick changes, a focused builder snippet is acceptable when the
user did not ask for a complete `prompt.ts`.

## Scope

This skill owns PromptKit prompt authoring:

- prompt purpose and behavior
- PromptDocument structure
- builders and templates
- section conventions
- variable references
- context usage policy
- rendered prompt review
- prompt QA

This skill does not own:

- kernel registry loading
- Pi sessions
- private tool execution
- runtime context loaders
- trace emission
- app adapter setup
- subagent orchestration

For Agent Kernel bundles, use `skills/kernel-agent-authoring/` as the parent skill
and return here for `prompt.ts` authoring.
