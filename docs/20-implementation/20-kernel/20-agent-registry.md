---
covers: "Agent registry implementation: frontmatter parser, ParsedAgent shape, registry entries, module sidecars, validation, and package exports."
concepts: [agent-registry, frontmatter, parsed-agent, agent-definition, validation, sidecars]
code-ref: packages/kernel/src/agent-registry/
depends-on: [00-overview.md]
---

# Agent Registry

The agent registry package code turns a filesystem catalog of agent definitions into validated runtime definitions.

---

## Agent Definition Shape

An agent definition is built from:

- `agent.md` frontmatter and body
- optional `context.ts` sidecar
- optional `index.ts` sidecar for private tools
- absolute module paths recorded by the registry
- warnings and validation errors

The parsed frontmatter includes model, tools, disallowed tools, extensions, variable declarations, turn limits, background behavior, thinking level, and subagent permissions.

## Registry API

`AgentRegistry` exposes:

- `get(name)`
- `tryGet(name)`
- `list()`
- `catalogRoot()`

The registry is a runtime lookup contract. The app still chooses which catalog roots to initialize and how to expose the registry to `createSpawnAgent`.

## Validation

Registry validation should fail early for:

- malformed frontmatter
- missing required fields
- name collisions
- prompt variables that are referenced but not declared
- declared variables that drift from prompt usage
- private tool names that are not present in an agent allowlist

The goal is for broken agent definitions to fail at boot, not halfway through a user run.

## Sidecars

`context.ts` and `index.ts` are optional. Lightweight agents can run with only a static prompt. Agents that need dynamic context or private tools colocate those modules with `agent.md`.

The kernel stores module paths; app adapters decide how to load them in the current runtime.
