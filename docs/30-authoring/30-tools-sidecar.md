---
covers: "How to author an agent tool surface: allow shared core tools in agent.json, register private tools in a sidecar, and bind app services through runtime injection."
concepts: [agent-authoring, tools-sidecar, coreTools, private-tools, defineTools, runtime-injection, tool-registration]
code-ref: packages/kernel/src/agent-definition/index.ts, packages/kernel/src/agent-registry/registry/registry.ts, packages/kernel/src/index.ts
depends-on: [00-overview.md, 10-context-sidecar.md, ../20-implementation/20-kernel/20-agent-registry.md, ../10-system-design/60-prompt-system-model.md]
---

# Author a Tools Sidecar

List shared tools in `agent.json`. Add a tools sidecar only for tools implemented by this agent bundle.

---

## 1. Allow Shared Tools in `agent.json`

Use `coreTools` for tool implementations supplied by the kernel or host application:

```json
{
  "$schema": "agent-kernel/agent-v1",
  "name": "report-writer",
  "description": "Writes a report from supplied evidence.",
  "model": "default",
  "coreTools": ["read", "write"]
}
```

`coreTools` is an allowlist, not an implementation site. The registry combines it with configured tool profiles and harvested private tool names to produce the runtime tool allowlist.

## 2. Register Private Tools in the Sidecar

Use either `tools.ts` or `tools/index.ts`. If both exist, `tools.ts` wins and the folder is reported as shadowed. Export the registration function as the default export or named `tools` export.

Define bundle-private registrations with `defineTools`:

```ts
import { defineTools } from "@agent-kernel/kernel/agent-definition";
import { Type } from "@earendil-works/pi-ai";

interface ReportRuntime {
  writeReport(content: string): Promise<string>;
}

export const tools = defineTools<ReportRuntime>((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    label: "Write report",
    description: "Persist the final Markdown report.",
    parameters: Type.Object({ content: Type.String() }),
    execute: async (_toolCallId, { content }) => {
      if (!runtime) throw new Error("Report runtime is required.");
      const path = await runtime.writeReport(content);
      return {
        content: [{ type: "text", text: `Wrote ${path}` }],
        details: { path },
      };
    },
  });
});

export default tools;
```

Private names are harvested from the registration function at registry boot and added to the agent's runtime access automatically. Do not repeat them in `coreTools`.

## 3. Bind App Services at Runtime

Keep app-owned clients, stores, and filesystem services out of the bundle. Type the runtime argument to the smallest interface the tool needs, then provide its implementation through the kernel's `toolRuntime` configuration.

Registry boot invokes the registration function with a recorder and no app runtime so it can harvest tool names. Register the same stable tool names in that mode; do not require runtime services while the callback itself runs. Check for the runtime inside `execute`, where a real spawn has received the configured implementation.

The binding and harvesting path is documented in [Agent Registry](../20-implementation/20-kernel/20-agent-registry.md#sidecars). The bundle contract and file-or-folder rule are decisions D77 and D98 in [Prompt System Model](../10-system-design/60-prompt-system-model.md#decision-log).

## 4. Keep Guidance and Behavior Separate

Do not create a tools section in the agent prompt. Put standing guidance about when or how to use tools in context section ②; keep tool names, descriptions, parameter schemas, and executable handlers in the tool layer. For prompt design, see the prompt-kit repo, `docs/30-prompt-structure/`.

## Authoring Check

- Shared tool names appear in `agent.json` `coreTools` or an intentional tool profile.
- Private tool names are stable, unique registrations in one legal D98 sidecar shape.
- Private names are not duplicated in `coreTools`.
- Registration succeeds without an app runtime; execution checks for what it needs.
- App services enter through runtime injection rather than bundle imports.
