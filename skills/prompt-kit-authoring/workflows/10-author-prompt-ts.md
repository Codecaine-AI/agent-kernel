---
covers: Workflow for creating a new prompt.ts PromptKit artifact.
concepts: [prompt-ts, authoring, workflow]
---

# Author `prompt.ts`

Use this workflow for new PromptKit artifacts.

## Steps

1. Understand the job.
2. Identify runtime inputs and desired output.
3. Identify likely failure modes.
4. Choose `singleOutputPrompt` or `workflowPrompt`.
5. Sketch sections in rendered order.
6. Write the PromptKit source.
7. Run QA.
8. Deliver the artifact with concise design notes.

## Brief Checklist

Before drafting, know:

- What should the prompt accomplish?
- What input or runtime context does it receive?
- What should it output?
- What should it never do?
- What does the model typically get wrong?
- Does it use tools, context, or variables?

Ask only for missing answers that materially change the prompt.

## Output Shape

Prefer:

```text
prompt.ts
```

with:

```ts
export const prompt = workflowPrompt(...);
export default prompt;
```

or:

```ts
export const prompt = singleOutputPrompt(...);
export default prompt;
```
