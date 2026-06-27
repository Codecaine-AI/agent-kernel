---
covers: "Agent registry implementation: typed agent definitions, prompt-kit rendering, ParsedAgent normalization, sidecars, validation, and package exports."
concepts: [agent-registry, typed-agent-definition, prompt-kit, parsed-agent, agent-definition, validation, sidecars]
code-ref: packages/kernel/src/agent-registry/
depends-on: [00-overview.md]
---

# Agent Registry

The agent registry package code turns a filesystem catalog of agent definitions into validated runtime definitions.

---

## Agent Definition Shape

The preferred agent definition is built from:

- `agent.ts` as the typed registry entry point
- `prompt.ts` as a prompt-kit prompt AST
- optional `context.ts` sidecar
- optional `tools.ts` sidecar for private tools
- absolute module paths recorded by the registry
- warnings and validation errors

`agent.ts` uses `defineAgent(...)` and imports the colocated prompt, context, and private tool modules. The registry renders prompt-kit prompts to XML-tagged Markdown and normalizes the typed manifest into the `ParsedAgent` shape still consumed by the spawn pipeline.

The normalized parsed config includes model, tool allowlist, disallowed tools, extensions, variable declarations, turn limits, background behavior, thinking level, and subagent permissions. Private tool names from `tools.ts` are harvested at registry boot and automatically included in the runtime allowlist.

Legacy `agent.md` definitions are still supported as a fallback path, but they are not the preferred authoring model.

## Registry API

`AgentRegistry` exposes:

- `get(name)`
- `tryGet(name)`
- `list()`
- `catalogRoot()`

The registry is a runtime lookup contract. The app still chooses which catalog roots to initialize and how to expose the registry to `createSpawnAgent`.

## Validation

Registry validation should fail early for:

- malformed typed agent exports or legacy frontmatter
- missing required fields
- name collisions
- prompt variables that are referenced but not declared
- declared variables that drift from prompt usage
- invalid prompt-kit trees
- private tool registration problems

The goal is for broken agent definitions to fail at boot, not halfway through a user run.

## Sidecars

`context.ts` and `tools.ts` are optional. Lightweight agents can run with only a typed `agent.ts` and `prompt.ts`. Agents that need dynamic context or private tools colocate those modules with the typed agent entry.

`context.ts` exports the agent context resolver, usually through `defineContext(...)`. `tools.ts` exports a runtime-bound private tool registration function through `defineTools(...)`:

```ts
export const tools = defineTools((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    // tool metadata and execute handler
  });
});
```

The registry executes the private tool registration function during boot with a stub Pi object that only records `registerTool({ name })` calls. This lets private tools be implemented once while the registry still knows which tool names must be enabled in Pi. Sidecars should register tool definitions without requiring app dependencies at registration time; app dependencies can be captured in `execute` handlers or supplied by the app adapter when it binds the tool runtime for a real run.

The kernel stores module paths; app adapters decide how to load them in the current runtime.
