---
covers: Context sidecar responsibilities for typed kernel agents.
concepts: [context.ts, context-loaders, runtime-context]
---

# `context.ts`

`context.ts` owns dynamic context loading and rendering for a kernel agent.

## Responsibilities

`context.ts` declares:

- loader list
- app/runtime-specific context sources
- context assembly
- missing/empty/error behavior where supported

The prompt should not redeclare this loader schema. It should only explain how
the model should use the injected context.

## Current Shape

Current examples use `defineContext(...)`:

```ts
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type {
  AgentContextResolver,
  LoadedMap,
  SpawnContext,
} from "@agent-kernel/kernel/context";

const loaders: AgentContextResolver["loaders"] = [
  { kind: "file", path: "research-memory/brief.md" },
  {
    kind: "directory",
    pattern: "research-memory/sources/**/*.md",
    extensions: [".md"],
  },
];

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
  return [
    "<agent_context>",
    ...loaded.map((input) => input.content),
    "</agent_context>",
  ].join("\n\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
```

## Prompt Relationship

Pair this with a PromptKit context usage node:

```ts
usesContext("agentContext", {
  tag: "context_policy",
  instructions: ["Use loaded context as evidence."],
});
```

## Runtime Boundary

Context can be dynamic, session-specific, app-owned, or missing at runtime. These
conditions should surface through kernel validation and trace events, not
PromptKit validation alone.
