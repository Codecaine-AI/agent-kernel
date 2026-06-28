---
covers: Private tool sidecar responsibilities for typed kernel agents.
concepts: [tools.ts, private-tools, coreTools]
---

# `tools.ts`

`tools.ts` owns private tools for an agent.

## Shared/Core Tools

Declare access to existing shared tools in `agent.ts`:

```ts
defineAgent({
  coreTools: ["read", "write"],
  prompt,
});
```

## Private Tools

Define private tools in `tools.ts`:

```ts
import { defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools<MyRuntime>((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    label: "Write report",
    description: "Persist the final markdown report.",
    parameters: {},
    execute: async () => {
      if (!runtime) throw new Error("Runtime is required.");
      return runtime.writeReport();
    },
  });
});

export default tools;
```

The registry can harvest private tool names from `tools.ts` and include them in
runtime tool access.

## Prompt Relationship

`prompt.ts` may include a `tool_policy` section that tells the model when and
how to use available tools.

Do not put executable tool behavior in the prompt. The prompt names and guides
tools; `tools.ts` implements them.

## Runtime Injection

Private tools may depend on app-owned services. Use runtime injection so the
agent bundle stays portable and testable.
