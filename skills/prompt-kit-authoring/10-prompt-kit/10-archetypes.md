---
covers: PromptKit prompt archetype selection.
concepts: [singleOutputPrompt, workflowPrompt, agentPrompt]
---

# Archetypes

PromptKit uses a small archetype set. Pick the smallest one that fits.

## `singleOutputPrompt`

Use for a bounded task:

```text
input -> one defined output
```

Good fits:

- classification
- extraction
- scoring
- rewrite
- normalization
- bounded summarization

Typical sections:

```text
purpose
instructions
output_format
custom sections when needed
```

Example:

```ts
import {
  codeBlock,
  paragraph,
  singleOutputPrompt,
  variable,
} from "@codecaine-ai/prompt-kit";

export const prompt = singleOutputPrompt({
  id: "supportIntentPrompt",
  title: "Support Intent Classifier",
  purpose: [
    paragraph("Classify one support message into the most likely intent."),
  ],
  instructions: [
    paragraph(["Message: ", variable("message")]),
    paragraph("Choose the narrowest intent supported by the message."),
  ],
  output: [
    codeBlock(
      `{
  "intent": "billing" | "technical" | "account" | "other",
  "confidence": 0.0
}`,
      { language: "json" },
    ),
  ],
});
```

## `workflowPrompt`

Use when the prompt has an explicit process. This is the default for most
agent-like prompts.

Typical sections:

```text
purpose
rules
background or key_knowledge when needed
workflow
context_policy when runtime context exists
tool_policy when tools exist
output_format
success_criteria
reminders
```

Example:

```ts
import {
  bulletList,
  orderedList,
  paragraph,
  section,
  usesContext,
  workflowPrompt,
} from "@codecaine-ai/prompt-kit";

export const prompt = workflowPrompt({
  id: "evidenceSummaryPrompt",
  title: "Evidence Summary",
  purpose: [paragraph("Synthesize loaded evidence into a concise finding.")],
  rules: [
    bulletList([
      "Use only loaded context as evidence.",
      "Mark uncertainty explicitly.",
    ]),
  ],
  workflow: [
    orderedList([
      "Read the context packet.",
      "Extract the claims that answer the request.",
      "Separate supported findings from uncertainty.",
      "Write the final summary.",
    ]),
  ],
  sections: [
    usesContext("evidenceContext", {
      tag: "context_policy",
      instructions: ["Do not invent facts outside the loaded context."],
    }),
    section("success_criteria", [
      bulletList([
        "Every factual claim is grounded in loaded context.",
        "The summary is useful without rereading the source packet.",
      ]),
    ]),
  ],
});
```

## `agentPrompt`

`agentPrompt` appends optional reminders to a workflow-style prompt. It is
convenience sugar, not a kernel agent definition.

Prefer `workflowPrompt` unless the convenience is useful and does not blur the
runtime boundary.
