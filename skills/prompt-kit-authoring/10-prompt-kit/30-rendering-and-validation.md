---
covers: Rendered XML-tagged Markdown review and PromptKit validation.
concepts: [rendering, validation, XML, QA]
---

# Rendering And Validation

PromptKit separates source structure from rendered output.

## Rendering

Use `renderXmlMarkdown(prompt, options)` when you need the model-facing text:

```ts
import { renderXmlMarkdown } from "@codecaine-ai/prompt-kit";

const rendered = renderXmlMarkdown(prompt, {
  variables: { userPrompt: "Summarize the run." },
});
```

The renderer owns:

- XML escaping
- indentation
- blank lines
- list markers
- code fences
- missing variable behavior

## Rendered Review

Review the rendered output for:

- readable section order
- semantic tag names
- critical rules near the top
- runtime data not mixed with stable instructions
- no redundant sections
- output format that can be copied by the model
- reminders that repeat only the most drift-prone rules

## Validation

Use `validatePrompt(prompt, options)` when possible:

```ts
import { validatePrompt } from "@codecaine-ai/prompt-kit";

const result = validatePrompt(prompt, {
  declaredVariables: ["userPrompt", "researchMemoryDir"],
});
```

Validation can catch:

- unsupported schema version
- missing prompt id
- duplicate node ids
- invalid XML section tags
- empty context usage ids
- undeclared variables when declarations are provided

Validation cannot prove:

- runtime context exists
- a tool is registered
- a kernel run will succeed
- a dynamic loader can read a session file

Those belong to the host runtime or Agent Kernel.
