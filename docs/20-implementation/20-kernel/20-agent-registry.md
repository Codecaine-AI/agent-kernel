---
covers: "Agent registry implementation: agent.json manifest discovery, prompt.json loading and hashing, sidecar attachment by filename, validation, prompt-revision registration, and package exports."
concepts: [agent-registry, agent-manifest, agent-json, prompt-json, prompt-hash, parsed-agent, validation, sidecars, prompt-revisions]
code-ref: packages/kernel/src/agent-registry/, packages/kernel/src/agent-definition/
depends-on: [00-overview.md]
---

# Agent Registry

The agent registry turns a filesystem catalog of agent bundles into validated runtime definitions.

---

## Agent Bundle Shape

The registry discovers agent directories by their `agent.json` manifest:

```text
agent-catalog/<agent-name>/
  agent.json           manifest (schema agent-kernel/agent-v1, JSON-Schema validated)
  prompt.json          canonical PromptDocument
  prompt.rendered.md   derived snapshot of the rendered prompt
  context.ts           optional context sidecar, attached by filename
  tools.ts             optional private-tools sidecar, attached by filename
```

The manifest is pure data: name, description, model (id or kernel-config alias), thinking, `maxTurns`, `canSpawnSubagent`, `coreTools`, `disallowedTools`, `extensions`, `toolProfiles`, `variables`, and named `variants`. There is no `agent.ts` entry point and no Markdown/frontmatter path — the manifest file itself is the registry entry.

`prompt.json` is the canonical prompt artifact (a prompt-kit `PromptDocument`). The registry validates it, renders it to XML-tagged Markdown, and computes its content hash (`pk1-<sha256>` over the canonical bytes). `prompt.rendered.md` is a committed derived snapshot, enforced by a snapshot test, so PR diffs show the behavioral contract in the format the model receives.

The registry normalizes each bundle into `ParsedAgent`: `config` (an `AgentConfig` — the old `frontmatter` field and `AgentFrontmatter` type are retired), `body` (the rendered prompt), and `promptHash`. The `tools` allowlist is fully expanded at boot: manifest `coreTools` + tool profiles expanded from the kernel-config profile map + harvested private tool names.

`defineAgent` is no longer imported by agent bundles; it survives as a typed validator/normalizer for tooling that constructs `agent.json` files (generators, tests). `defineContext` and `defineTools` remain the typed helpers for the code sidecars.

## Registry API

`buildRegistry({ roots, toolProfiles })` scans the catalog roots recursively. `AgentRegistry` exposes:

- `get(name)`
- `tryGet(name)`
- `list()`
- `roots()`

`createKernel` builds the registry from `catalog.roots` on first use and caches it.

## Prompt Revisions

At kernel boot, `registerPromptRevisions(db, registry)` upserts one `prompt_revisions` row per agent (`source: "registry-boot"`), keyed by the content hash — re-booting an unchanged catalog is a no-op. The spawn pipeline stamps the same hash onto `pi_agent_sessions.prompt_hash`, closing the loop between authored prompts and observed runs.

## Validation

Registry boot fails with an aggregate of per-agent errors for:

- unparseable or shape-invalid `agent.json`
- missing, unparseable, or shape-invalid `prompt.json`
- prompt validation errors (including undeclared variable references)
- declared variables that drift from prompt usage
- unknown tool profiles
- name collisions
- malformed context/tools sidecar exports

The goal is for broken agent definitions to fail at boot, not halfway through a user run.

## Sidecars

`context.ts` and `tools.ts` are optional and attach by filename convention. Lightweight agents run with just `agent.json` + `prompt.json`.

`context.ts` exports the agent context resolver (default or named `context`, `{ loaders, assemble }`). `tools.ts` exports a runtime-bound private tool registration function (default or named `tools`):

```ts
export const tools = defineTools((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    // tool metadata and execute handler
  });
});
```

The registry executes the registration function during boot with a stub Pi object that only records `registerTool({ name })` calls, so it knows which tool names must be enabled without app dependencies at registration time. At spawn time the kernel binds the same function to the config `toolRuntime`, so app services are captured in `execute` handlers.
