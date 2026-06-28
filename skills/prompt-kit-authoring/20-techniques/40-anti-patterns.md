---
covers: Prompt anti-patterns to check during PromptKit QA.
concepts: [anti-patterns, qa, prompt-review]
---

# Anti-Patterns

Check prompts against this list before delivery.

## Structural

### Wall Of Text

One undifferentiated block. Fix with semantic sections.

### Polite Suggestion

Hedged instructions such as "try to" or "consider". Fix with imperative
language.

### Instruction Dump

Too many equally weighted rules. Fix by separating non-negotiable rules from
workflow-specific constraints.

### Echo Chamber

Same instruction repeated in different words. Fix by stating it once and using a
short reminder only when recency matters.

### Franken-Prompt

Sections stitched from different prompts with inconsistent terms. Fix by
normalizing vocabulary and cutting inherited baggage.

### Contradictions

Conflicting requirements without priority. Fix by saying which constraint wins.

## Thinking

### Default Delegation

The prompt asks for output without shaping how to produce useful output. Fix with
workflow, criteria, examples, or output format.

### Over-Engineering

Too much scaffolding for a simple task. Fix by cutting techniques and sections
that do not change output.

### Persona Theater

Backstory or credentials instead of behavior. Fix with concrete constraints and
examples.

### Assumption Blindness

The prompt does not handle likely ambiguity. Fix with assumption handling or
clarification behavior.

## Output

### Format Vacuum

No literal output shape. Fix with `output_format`.

### Everything Prompt

"Be comprehensive" without priorities. Fix with explicit scope and ranking.

### Context Injection Risk

User data or loaded context can be mistaken for instructions. Fix by keeping
runtime data in tagged context packets and using context policy.

## PromptKit-Specific

- Raw placeholders instead of `variable()`.
- Runtime loader schemas duplicated in `prompt.ts`.
- Tool implementation details in prompt sections.
- `raw()` used where structured builders would work.
- Custom section tags that are clever but not semantic.
