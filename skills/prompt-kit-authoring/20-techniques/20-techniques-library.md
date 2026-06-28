---
covers: Practical prompting techniques that can be embedded in PromptKit sections.
concepts: [techniques, examples, verification, quality]
---

# Techniques Library

Use techniques sparingly. Add one only when it changes behavior.

## Reasoning

### Atom Of Thought

Break complex problems into independent sub-questions, solve each separately,
verify independently, then synthesize.

Use for complex multi-factor analysis where sequential reasoning can bias later
steps.

PromptKit mapping: add workflow steps for decomposition, independent resolution,
verification, and synthesis.

### Chain Of Verification

Draft, list factual claims, verify each claim, correct failures, and present the
verified version.

Use for factual or research outputs where hallucination is costly.

PromptKit mapping: add explicit workflow steps and success criteria requiring
verified claims.

### Socratic Prompting

Surface assumptions and missing information before answering.

Use for ambiguous requests or premature conclusions.

PromptKit mapping: add a rule to ask or state assumptions when required inputs
are missing.

### Self-Consistency

Solve from multiple angles and compare. Use only when accuracy is worth the
extra reasoning cost.

## Structure

### Semantic XML Architecture

Use section tags that name the content's job:

```text
customer_complaint
tool_policy
success_criteria
context_policy
```

PromptKit mapping: choose semantic `section()` tags and custom sections.

### Contrastive Examples

Show a good and bad output when the distinction is non-obvious. One contrastive
pair often beats several positive-only examples.

PromptKit mapping: use `example()` or semantic custom sections.

### Literal Output Format

Show the exact output shape instead of describing it.

PromptKit mapping: use `section("output_format", ...)` and `codeBlock()` when
the output is structured.

## Quality

### Inner Critic Loop

Draft, critique the weak points, revise, and present only the revised result.

Use when first-draft quality is predictably insufficient.

### Negative Space Definition

State what the output must not be.

Use when the main risk is generic default-AI output.

### Decision Support

Present tradeoffs, best-case conditions, and failure cases instead of flattening
to one recommendation too early.

Use for strategy and judgment tasks.

## Efficiency

- Cut instructions the model already follows.
- Merge overlapping constraints.
- Use semantic tags that double as instructions.
- Prefer one strong contrastive example over many weak examples.
- Add token priorities when output length is constrained.
