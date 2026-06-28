---
covers: PromptKit authoring boundaries, source of truth, templates, and rendered output.
concepts: [PromptDocument, source-of-truth, templates, boundary]
---

# Authoring Model

PromptKit treats prompts as structured documents first and rendered text second.

The source of truth is a `PromptDocument` created directly or with builders such
as `workflowPrompt`, `singleOutputPrompt`, `section`, `paragraph`, `bulletList`,
`orderedList`, `field`, `codeBlock`, `variable`, and `usesContext`.

## Package Boundary

PromptKit owns:

- generic prompt AST
- builders
- templates
- XML-tagged Markdown renderer
- transforms
- validation
- lightweight UI preview/editor models

PromptKit does not own:

- agent registry discovery
- dynamic context loading
- tool registration
- model settings
- traces
- Pi integration
- subagent orchestration
- app session state

## Two Core Archetypes

### `singleOutputPrompt`

Use for one bounded task where a given input produces one defined output.

Examples:

- classify
- extract
- rewrite
- normalize
- score
- summarize a bounded item

### `workflowPrompt`

Use when the prompt has an explicit process. Most agent-like prompts should use
this.

Examples:

- read context, evaluate, synthesize
- inspect evidence, draft, critique, revise
- use tools in a specific order
- produce durable artifacts

### `agentPrompt`

`agentPrompt` is a thin convenience wrapper over `workflowPrompt`. Mention it
only as optional sugar. It is not a kernel agent definition.

## Rendered Output

The default renderer produces XML-tagged Markdown. Authors should care about the
rendered shape even though they do not hand-format it.

Prefer:

- semantic section tags
- linear reading order
- short rules near the top
- context and data policies near the relevant workflow
- literal output formats
- success criteria and reminders only when useful

The renderer owns indentation, escaping, list markers, code fences, and variable
placeholder output.

## Runtime Data

Stable behavior belongs in `prompt.ts`.

Dynamic data belongs outside the prompt:

- variables declared by the host or kernel
- runtime context packets
- current user turn
- conversation history
- tool results
- app state

Use `variable("name")` when the prompt needs a small runtime value. Use
`usesContext("contextId", ...)` when the prompt needs to tell the model how to
use an injected context packet.
