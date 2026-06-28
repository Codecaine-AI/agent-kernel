---
covers: PromptKit example references and compact authoring examples.
concepts: [examples, prompt.ts, simple-research-kernel]
---

# Examples

Use examples as patterns, not as boilerplate to paste blindly.

## Compact `workflowPrompt`

```ts
import {
  bulletList,
  orderedList,
  paragraph,
  section,
  workflowPrompt,
} from "@codecaine-ai/prompt-kit";

export const prompt = workflowPrompt({
  id: "reviewPrompt",
  title: "Review Prompt",
  purpose: [paragraph("Review one artifact and identify actionable issues.")],
  rules: [
    bulletList([
      "Lead with findings.",
      "Ground every finding in the artifact.",
    ]),
  ],
  workflow: [
    orderedList([
      "Read the artifact.",
      "Identify correctness, clarity, and maintainability risks.",
      "Rank findings by severity.",
      "Write the review.",
    ]),
  ],
  sections: [
    section("output_format", [
      bulletList([
        "Findings",
        "Open questions",
        "Summary",
      ]),
    ]),
  ],
});
```

## Canonical Repo Examples

Current typed Agent Kernel examples:

- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/prompt.ts`
- `examples/simple-research-kernel/src/agent-catalog/source-scout/prompt.ts`
- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/prompt.ts`

These show:

- `workflowPrompt` for agent-like prompts
- `variable()` for runtime values
- `usesContext()` for context policy
- custom semantic sections
- tool policy sections
- quality bars and output formats
