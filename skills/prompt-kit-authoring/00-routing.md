---
covers: Routing PromptKit authoring requests to the right artifact path.
concepts: [routing, prompt-kit, prompt-ts, review, qa]
---

# Routing

Route by what the user needs.

## Create A PromptKit Prompt

Use when the user asks for a new prompt, a prompt for a system, or a prompt that
should be authored in PromptKit.

Output:

```text
prompt.ts
```

Workflow:

1. Use `workflows/10-author-prompt-ts.md`.
2. Choose `singleOutputPrompt` or `workflowPrompt`.
3. Implement with PromptKit builders.
4. QA the rendered shape.

## Improve An Existing PromptKit Prompt

Use when the user supplies or points to an existing `prompt.ts`.

Workflow:

1. Use `workflows/20-improve-prompt-ts.md`.
2. Preserve the existing intent.
3. Diagnose anti-patterns and structure drift.
4. Edit the PromptKit source, not rendered Markdown.

## Review A Prompt

Use when the user asks for a review or critique.

Workflow:

1. Read the authored source if available.
2. Inspect the rendered shape if practical.
3. Lead with findings: bugs, risks, weak sections, missing context, overbuilt
   scaffolding, or output-format ambiguity.
4. Suggest PromptKit-source edits.

## Map Markdown/XML Into PromptKit

Use when the user has an old Markdown prompt and wants PromptKit.

Workflow:

1. Identify semantic sections.
2. Choose `singleOutputPrompt` or `workflowPrompt`.
3. Convert placeholders to `variable()`.
4. Convert dynamic context instructions to `usesContext()` when appropriate.
5. Preserve only sections that change behavior.

## Kernel Agent Prompt

Use when the user is creating or editing an Agent Kernel agent.

Route through `skills/kernel-agent-authoring/`, then return here for `prompt.ts`.
The PromptKit prompt should not own `agent.ts`, `context.ts`, or `tools.ts`.
