---
covers: Rendered XML-tagged Markdown review standards.
concepts: [rendered-output, XML, Markdown, review]
---

# Rendered Review

PromptKit authors should review the rendered XML-tagged Markdown when practical.

## Check Order

Default `workflowPrompt` order:

```text
purpose
rules
key_knowledge / background when needed
workflow
context_policy
tool_policy
output_format
success_criteria
reminders
```

Trim sections that do not earn their cost.

## Check Tags

Tags should be semantic and stable:

```text
tool_policy
context_policy
scout_assignment_contract
quality_bar
```

Avoid generic tags when a domain-specific tag would guide the model better.

## Check Lists

- Ordered lists for required sequence.
- Bullets for unordered constraints.
- Nested list items only when hierarchy matters.

## Check Runtime Boundaries

- Stable behavior is in the system prompt.
- Runtime context is referenced by policy, not duplicated.
- Dynamic values are variables.
- Tool policy names allowed tools but does not implement tools.

## Check Reminders

Use reminders for the two or three constraints most likely to drift. Do not
repeat the entire rules section.
