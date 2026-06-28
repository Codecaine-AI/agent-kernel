---
covers: Optional thinking frameworks for prompts with specific reasoning failure modes.
concepts: [thinking-frameworks, reasoning, failure-modes]
---

# Thinking Frameworks

Thinking frameworks change how the model reasons. Most prompts need zero. Use at
most one or two when a specific failure mode calls for them.

## Selection Guide

| Risk | Framework |
| --- | --- |
| Output will be generic | Inversion |
| Conventional thinking may be wrong | First Principles |
| Tradeoffs need judgment | Contention |
| Requirements conflict | Constraint-First |
| Thinking is stale | Cross-Domain Transfer |
| Analysis is shallow | Recursive Depth |
| No specific reasoning failure | No framework |

## Frameworks

### Inversion

Define failure before pursuing success.

Use when the main risk is generic or useless output.

### First Principles

Decompose the problem into fundamentals before solving.

Use for novel technical or architectural problems.

### Contention

Analyze opposing cases before synthesizing a position.

Use for decisions and strategy.

### Constraint-First

List hard constraints, soft constraints, conflicts, and negative space before
generating.

Use for tight briefs or design problems.

### Cross-Domain Transfer

Borrow a mental model from another domain to force non-obvious insight.

Use for innovation or strategy, not precision tasks.

### Recursive Depth

Review the first answer for shallow claims, expert objections, and omitted hard
parts, then revise.

Use for analysis where depth matters.

## PromptKit Mapping

Frameworks usually become:

- workflow steps
- a short `approach` section
- success criteria
- reminders

Do not add a named framework just to make the prompt sound sophisticated.
