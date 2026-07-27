---
covers: "Agent registry implementation: agent.json manifest discovery, file-or-folder bundle layout resolution, prompt.json loading and hashing, sidecar attachment by convention, validation, prompt-revision registration, and package exports."
concepts: [agent-registry, agent-manifest, agent-json, prompt-json, prompt-hash, parsed-agent, validation, sidecars, bundle-layout, prompt-revisions]
code-ref: packages/kernel/src/agent-registry/, packages/kernel/src/agent-definition/
depends-on: [00-overview.md]
---

# Agent Registry

The agent registry turns a filesystem catalog of agent bundles into validated runtime definitions.

---

## Agent Bundle Shape

The registry discovers agent directories by their `agent.json` manifest. Every section of a bundle has two legal shapes — a single file, or a folder with an `index.ts` entry point:

```text
agent-catalog/<agent-name>/
  agent.json                              manifest (schema agent-kernel/agent-v1, JSON-Schema validated)
  prompt.json    | prompt/prompt.json     canonical PromptDocument
  prompt.rendered.md | prompt/system.md   generated markdown render of the prompt
  context.ts     | context/index.ts       optional context sidecar
  tools.ts       | tools/index.ts         optional private-tools sidecar
  state.ts       | state/index.ts         optional state sidecar
```

Resolution order per section is **file first, folder second** (`packages/kernel/src/agent-registry/registry/bundle-layout.ts`):

| section | tried first | tried second |
| --- | --- | --- |
| prompt | `<bundle>/prompt.json` | `<bundle>/prompt/prompt.json` |
| context | `<bundle>/context.ts` | `<bundle>/context/index.ts` |
| tools | `<bundle>/tools.ts` | `<bundle>/tools/index.ts` |
| state | `<bundle>/state.ts` | `<bundle>/state/index.ts` |

A section folder's internal layout is unconstrained: `index.ts` is the only entry point the registry imports, and every other file inside it — `prompt/system.md` above all — is invisible to discovery. When both forms are present the file wins **silently**, so a migration can leave a re-export shim at the old path; `doctor --catalog` reports the shadowed path (see [00-overview.md](00-overview.md)). `AgentDefinition.bundleLayout` carries the resolved form and any shadowed path per section, and `AgentDefinition.renderedPromptFile` points at the generated markdown for the resolved form.

The manifest is pure data: name, description, model (id or kernel-config alias), thinking, `maxTurns`, `coreTools`, `disallowedTools`, `extensions`, `toolProfiles`, `variables`, and named `variants`. There is no `agent.ts` entry point and no Markdown/frontmatter path — the manifest file itself is the registry entry. (`canSpawnSubagent` is retired: spawning is granted per tool via spawner declarations in `tools.ts`, D77.)

`prompt.json` is the canonical prompt artifact (a prompt-kit `PromptDocument`) and the source of truth. The registry validates it, renders it to XML-tagged Markdown, and computes its content hash (`pk1-<sha256>` over the canonical bytes). The markdown beside it (`prompt.rendered.md` in file form, `prompt/system.md` in folder form) is a committed *generated* snapshot, enforced by a snapshot test, so PR diffs show the behavioral contract in the format the model receives. It is never hand-edited and never parsed by the registry; regenerate it with `bunx agent-kernel-render-prompts <catalog-root>` (`packages/kernel/src/render-prompts-cli.ts`, over `agent-registry/prompt-snapshot.ts`). The same helper backs the lab save path, so all three writers emit identical bytes.

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
- a `prompt.json` missing in both forms, or unparseable / shape-invalid
- prompt validation errors (including undeclared variable references)
- declared variables that drift from prompt usage
- unknown tool profiles
- spawner tools whose `spawns` name agents missing from the catalog (D77)
- name collisions
- malformed context/tools sidecar exports

The goal is for broken agent definitions to fail at boot, not halfway through a user run.

## Sidecars

The context, tools, and state sidecars are optional and attach by convention, in either the `<kind>.ts` or the `<kind>/index.ts` form. A base agent is just `agent.json` + a prompt — the absence of the other sections is the statement that it is a plain windowed agent.

The context sidecar exports the agent context resolver (default or named `context`, `{ loaders, assemble }`). The tools sidecar exports a runtime-bound private tool registration function (default or named `tools`):

```ts
export const tools = defineTools((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    // tool metadata and execute handler
  });
});
```

The registry executes the registration function during boot with a stub Pi object that only records `registerTool({ name })` calls, so it knows which tool names must be enabled without app dependencies at registration time. Tools compiled by `defineSpawnerTool` additionally carry their `spawns` allowlist, which the harvest collects into the agent's spawner map (validated against the catalog: a non-`"*"` target naming an unknown agent fails boot). At spawn time the kernel binds the same function to the config `toolRuntime` — and binds spawner tools to the scoped dispatch handle (D77) — so app services are captured in `execute` handlers.
