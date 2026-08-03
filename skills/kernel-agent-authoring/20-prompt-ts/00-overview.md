---
covers: How prompt.ts fits inside a typed Agent Kernel bundle.
concepts: [prompt.ts, PromptKit, PromptDocument]
---

# `prompt.ts`

`prompt.ts` is the stable PromptKit prompt source of truth.

Use `../prompt-kit/packages/prompt-kit-agent/skills/prompt-kit-authoring/` for prompt
design. This file only describes how `prompt.ts` fits into a kernel agent bundle.

## Responsibilities

`prompt.ts` owns:

- purpose
- behavioral rules
- workflow/process
- model-facing context policy
- model-facing tool policy
- output format
- success criteria
- reminders

`prompt.ts` does not own:

- variable declarations
- context loading
- private tool implementation
- model selection
- turn limits
- trace emission
- subagent orchestration

## Variables

Reference variables with PromptKit nodes:

```ts
paragraph(["Focus: ", variable("focus")]);
```

Declare those variables in `agent.ts`.

## Context

Use `usesContext()` for prompt-side usage rules:

```ts
usesContext("sourceScoutContext", {
  tag: "context_policy",
  instructions: [
    "Use loaded source notes as evidence.",
    "Do not invent facts outside loaded context.",
  ],
});
```

Declare loaders and assemble context in `context.ts`.

## Tools

Prompt text may include a `tool_policy` section, but executable tools live in
`tools.ts` or shared/core tool access.
