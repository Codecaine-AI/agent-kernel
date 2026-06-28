---
covers: PromptKit builder and section conventions for prompt.ts authoring.
concepts: [builders, sections, variables, contextUsage]
---

# Builders And Sections

## Common Builders

Use PromptKit builders instead of hand-writing XML strings.

```ts
import {
  bulletList,
  codeBlock,
  field,
  item,
  orderedList,
  paragraph,
  raw,
  section,
  usesContext,
  variable,
} from "@codecaine-ai/prompt-kit";
```

## Sections

`section(tag, children, options)` is the main structural unit. Section tags
become semantic XML tags in rendered output.

Good tags:

```text
purpose
rules
key_knowledge
background
workflow
tool_policy
context_policy
output_format
success_criteria
reminders
```

Use custom tags when they describe the prompt's real domain:

```ts
section("scout_assignment_contract", [
  paragraph("When creating scout assignments, include:"),
  bulletList([
    "The original user request.",
    "The scout's narrow focus.",
    "The expected artifact.",
  ]),
]);
```

## Lists

Use `orderedList` when order matters. Use `bulletList` when order does not.

Use `item(text, children)` for nested detail:

```ts
orderedList([
  item("Review evidence.", [
    bulletList([
      "Prefer primary sources.",
      "Separate fact from inference.",
    ]),
  ]),
  "Write the final answer.",
]);
```

## Variables

Use `variable()` for dynamic references.

```ts
paragraph(["Current request: ", variable("userPrompt")]);
```

Do not write raw placeholders in strings unless preserving legacy text is the
explicit goal.

The host or kernel declares variables. PromptKit can validate prompt references
against those declarations when they are provided.

## Runtime Context

Use `usesContext()` to describe how the prompt should use injected runtime
context.

```ts
usesContext("researchContext", {
  tag: "context_policy",
  instructions: [
    "Use source notes as evidence.",
    "Do not invent sources outside loaded context.",
  ],
});
```

This does not load context. A host app or kernel owns context loading and
rendering.

## Raw Text

Use `raw()` sparingly for already-rendered material or migration escape hatches.
Prefer structured builders for new authoring.
