---
covers: Typed Agent Kernel bundle shape and file responsibilities.
concepts: [agent-bundle, agent.ts, prompt.ts, context.ts, tools.ts]
---

# Agent Bundle

The preferred Agent Kernel authoring shape is:

```text
agent-catalog/<agent-name>/
  agent.ts
  prompt.ts
  context.ts
  tools.ts
```

`context.ts` and `tools.ts` are optional. Lightweight agents can use only
`agent.ts` and `prompt.ts`.

## `agent.ts`

`agent.ts` is the registry entry point and composition file.

It owns:

- agent name
- description
- model/settings
- shared/core tool allowlist
- variable schema
- spawn permission
- turn/background/thinking configuration
- prompt/context/tools binding
- variants when supported

Example:

```ts
import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context";
import { prompt } from "./prompt";
import { tools } from "./tools";

export default defineAgent({
  name: "source-scout",
  description: "Investigates one focused angle and writes a durable note.",
  model: "codex-lb/gpt-5.5",
  coreTools: [],
  canSpawnSubagent: false,
  thinking: "low",
  variables: {
    focus: {
      default: "",
      description: "Focus assigned by the coordinator.",
    },
  },
  prompt,
  context,
  tools,
});
```

## `prompt.ts`

`prompt.ts` exports a PromptKit `PromptDocument`. Use
`../prompt-kit/packages/prompt-kit-agent/skills/prompt-kit-authoring/` for design and implementation guidance.

## `context.ts`

`context.ts` declares context loaders and assembles the runtime context string or
packet. It may use app-owned runtime services.

## `tools.ts`

`tools.ts` defines private tools for the agent. Shared/core tools are listed in
`agent.ts`; private tools do not need to be repeated in the allowlist.

## Derived Views

Rendered system prompts, combined/effective prompt views, context previews, and
tool metadata belong in the viewer and traces. They are inspection surfaces, not
authored source files.
