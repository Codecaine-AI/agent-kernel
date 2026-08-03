---
covers: Routing Agent Kernel agent-authoring tasks.
concepts: [agent, routing, prompt-ts, context-ts, tools-ts]
---

# Routing

Route by the artifact being created or changed.

## New Agent

Create a typed bundle:

```text
agent.ts
prompt.ts
context.ts    optional when dynamic context is needed
tools.ts      optional when private tools are needed
```

Use `10-agent-bundle/00-overview.md`.

## Prompt Change

If only behavior text changes, edit `prompt.ts` through
`../prompt-kit/packages/prompt-kit-agent/skills/prompt-kit-authoring/`.

Do not edit rendered Markdown or create `agent.md`.

## Variable Change

Edit `agent.ts` variable declarations and update `prompt.ts` variable references
as needed.

## Runtime Context Change

Edit `context.ts` for loaders and assembly. Add or update `usesContext()` in
`prompt.ts` only for model-facing context usage instructions.

## Tool Change

Edit `tools.ts` for private tools. Edit `agent.ts` `coreTools` for shared/core
tool access. Edit `prompt.ts` only for tool policy and workflow usage.

## Viewer Or Trace Change

Use kernel implementation docs. Agent authoring should expose inspectable
metadata and clean prompt/context/tool boundaries.
