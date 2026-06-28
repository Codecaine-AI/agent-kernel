---
covers: Evaluation criteria for PromptKit prompt artifacts.
concepts: [evaluation, scoring, prompt-quality]
---

# Evaluation

Use these dimensions for prompt QA. Scoring is optional; the dimensions are the
important part.

## Token Efficiency

Every section and instruction earns its cost. Remove sections that do not change
output.

## Structural Precision

The prompt's structure helps the model parse the job:

- semantic section tags
- clear ordering
- literal output shape
- rules separated from workflow steps
- context and tool policies in the right place

## Reasoning Fit

The reasoning scaffolding matches task difficulty. Add frameworks only when
they address a real failure mode. Cut scaffolding that adds ceremony without
quality.

## Robustness

The prompt handles messy inputs, missing context, ambiguity, tool limits, and
likely edge cases.

## Output Value

The output is specific, useful, and actionable. It avoids polished generic
answers.

## PromptKit Integrity

The source uses PromptKit correctly:

- `PromptDocument` source of truth
- builders over raw strings when possible
- `variable()` for variables
- `usesContext()` for runtime context policy
- valid section tags
- no duplicate ids when ids are used
