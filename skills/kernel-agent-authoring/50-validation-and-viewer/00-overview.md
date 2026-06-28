---
covers: Validation and viewer expectations for typed kernel agents.
concepts: [validation, viewer, traces, typed-agents]
---

# Validation And Viewer

Typed agent authoring should fail early when definitions drift.

## Validation Targets

Catch at boot or authoring time when possible:

- malformed `agent.ts`
- duplicate agent names
- invalid PromptKit tree
- `prompt.ts` references undeclared variables
- declared variables are unused
- private tool registration cannot be harvested
- malformed context loader declarations

Runtime-only conditions should surface in traces:

- dynamic session files missing
- app/database state unavailable
- context loader runtime error
- tool execution error
- subagent failure

## Viewer Expectations

The viewer is the primary inspection surface for typed agents. It should be able
to show:

- manifest/config from `agent.ts`
- rendered prompt from `prompt.ts`
- prompt preview model when available
- variable declarations and resolved values
- context contract and rendered runtime context
- shared/core tool access
- private tool metadata
- validation warnings/errors
- combined/effective prompt view when useful

These views are derived. They are not authored source artifacts.
