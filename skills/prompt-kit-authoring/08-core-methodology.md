---
covers: Interactive PromptKit authoring workflow without prompt-run directories.
concepts: [workflow, prompt-authoring, qa]
---

# Core Methodology

PromptKit authoring is interactive, but it does not create `.prompt-runs/`.

## Workflow

1. Understand the intended behavior.
2. Identify runtime inputs, desired output, and likely failure modes.
3. Choose `singleOutputPrompt` or `workflowPrompt`.
4. Sketch the rendered section shape in plain terms.
5. Implement `prompt.ts` with PromptKit builders.
6. Render or mentally inspect the XML-tagged Markdown shape.
7. QA against anti-patterns, output value, structure, and token cost.
8. Deliver the PromptKit artifact and brief design notes.

## Clarification

Ask only questions whose answers would materially change the prompt.

Clarify when any of these are unknown:

- intended job
- runtime inputs
- desired output
- hard constraints
- likely failure modes
- whether runtime context or tools exist

If the user wants speed, state assumptions and proceed.

## Technique Use

Techniques and thinking frameworks are available context, not mandatory steps.

Start with the smallest prompt that can work. Add a technique only when it fixes
a real failure mode.

Examples:

- Generic output risk: add negative-space constraints or contrastive examples.
- Hallucination risk: add context policy and evidence requirements.
- Shallow analysis risk: add critique/revise or evidence-first workflow steps.
- Format drift risk: add a literal output schema.
- Ambiguous intent risk: add clarification or assumption handling.

## Drafting Rules

- Use imperative voice.
- Avoid persona backstories.
- Keep concepts named consistently.
- Put critical rules near the top.
- Use reminders only for the two or three rules most likely to drift.
- Use examples when they disambiguate behavior.
- Cut sections that do not change output.

## Delivery

For a creation task, deliver the `prompt.ts` source.

For an improvement task, summarize the important changes and provide the edited
PromptKit source or patch.

For a review, lead with findings and file references when reviewing real code.
