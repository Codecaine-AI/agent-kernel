---
covers: Context engineering principles for PromptKit prompts.
concepts: [context-engineering, context-window, runtime-data]
---

# Context Engineering

Prompt authoring is context architecture.

The question is not only "what instruction should I write?" The question is:

```text
What does the model need in working memory to produce the desired output?
```

## Working Memory Pieces

- Stable instructions: PromptKit `prompt.ts`.
- Dynamic variables: small runtime values referenced with `variable()`.
- Runtime context: loaded files, app state, memory, retrieved material.
- Conversation/current turn: host or kernel runtime packet.
- Tool results: runtime artifacts, not PromptKit source.

## Placement

- Put stable behavioral rules in the prompt.
- Put dynamic data outside the prompt.
- Use `usesContext()` to explain how injected context should be used.
- Keep critical rules near the start and, when needed, in short reminders.
- Keep large context in the middle of the model-facing packet.

## Context Rot

Context rot happens when irrelevant or stale material dilutes attention.

Prevent it by:

- loading only useful context
- summarizing or windowing long context
- using semantic tags
- cutting duplicate instructions
- separating user data from instructions

## PromptKit Mapping

Use PromptKit to make the stable part structured:

```ts
workflowPrompt({
  purpose: [...],
  rules: [...],
  workflow: [...],
  sections: [
    usesContext("runtimeContext", {
      instructions: ["Use loaded context as evidence."],
    }),
  ],
});
```

Do not put runtime loader schemas in `prompt.ts`.
