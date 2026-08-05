---
covers: "How to author an agent context sidecar: choose its bundle shape, declare loaders, assemble standing reference material, and keep live working state in section ③."
concepts: [agent-authoring, context-sidecar, defineContext, context-loaders, context-assembly, standing-context, section-2]
code-ref: packages/kernel/src/agent-definition/index.ts, packages/kernel/src/context/, packages/kernel/src/agent-registry/registry/bundle-layout.ts
depends-on: [00-overview.md, ../20-implementation/20-kernel/30-context-loaders.md, ../20-implementation/20-kernel/60-agent-state.md, ../10-system-design/60-prompt-system-model.md]
---

# Author a Context Sidecar

Add a context sidecar when an agent needs standing reference material on its requests. Put changing work state in the state sidecar instead.

---

## 1. Choose the Sidecar Shape

Use either `context.ts` or `context/index.ts`. Both forms are permanent; choose the folder form when loader declarations or render helpers need separate files. If both forms exist, the registry uses `context.ts` and reports the shadowed folder through catalog diagnostics.

The sidecar is optional. When present, its entry point must export the resolver as either the default export or named `context` export.

## 2. Declare and Assemble Context

Use `defineContext` to declare loaders and assemble their ordered results into one model-facing string:

```ts
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type {
  AgentContextResolver,
  LoadedMap,
  SpawnContext,
} from "@agent-kernel/kernel/context";

const loaders: AgentContextResolver["loaders"] = [
  { kind: "file", path: "reference/style-guide.md" },
  {
    kind: "directory",
    pattern: "reference/examples/**/*.md",
    extensions: [".md"],
  },
];

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
  return [
    "<agent_reference>",
    `<agent_name>${ctx.agentName}</agent_name>`,
    ...loaded.map((input) => input.content),
    "</agent_reference>",
  ].join("\n\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
```

The bundle owns loader declarations and assembly. Loader implementations remain kernel- or app-registered infrastructure. Built-in declarations cover files, directories, skills, commands, and inline text; apps may register additional `kind` values. See [Context Loaders](../20-implementation/20-kernel/30-context-loaders.md) for the current resolver, loader catalog, `SpawnContext`, status, and trace contracts.

Each `LoadedMap` entry reports `ok`, `empty`, or `error`. Decide in `assemble` whether empty and failed inputs should be omitted, labeled, or rendered as an explicit limitation. Keep that policy local to the agent rather than assuming every loader succeeds.

## 3. Keep the Section Boundary

The context sidecar supplies section ②: standing material that should remain available as requests are rebuilt. Appropriate inputs include capabilities, skills, style guides, reference sheets, and stable supporting evidence.

Do not use it for material that moves with the work. Target documents, work queues, current requests, editor state, progress, and conversation belong to the state sidecar's section ③ render. Context and state are sibling request sections; state is never nested inside context. The full request and state contract lives in [Agent State](../20-implementation/20-kernel/60-agent-state.md), with the governing decisions in [D81–D99](../10-system-design/60-prompt-system-model.md#amendments--2026-07-27-state-model-interview).

When an agent uses the state extension, the assembled result becomes an entry in the kernel-held context set and is rebuilt into one section ② message per request. Pass-through behavior and current injection details remain implementation concerns; author against the section boundary.

If the model needs standing guidance for how to use available tools, supply that guidance through section ②. Tool schemas and executable behavior belong to the tools sidecar. For prompt design, see the prompt-kit repo, `docs/30-prompt-structure/`.

## Authoring Check

- The sidecar uses one legal D98 entry-point shape.
- Every declared loader kind exists in the configured loader catalog.
- `assemble` handles the statuses the agent can tolerate.
- Section ② contains standing reference only; live work renders from section ③.
- The exported resolver is named `context`, default-exported, or both.
