---
covers: "Design interview and emerging model for a prompt authoring system that produces kernel-ready agent definitions, dynamic context resolvers, and prompt skills."
concepts: [prompt-system, prompt-harness, prompt-spec, agent-definition, context-resolver, skills, authoring-workflow]
depends-on: [../00-foundation/30-boundaries.md, 10-runtime-model.md, 50-app-adapter-model.md, ../20-implementation/20-kernel/20-agent-registry.md, ../20-implementation/20-kernel/30-context-loaders.md]
status: draft
---

# Prompt System Model

This document is the shared design surface for the prompt system that should produce prompts, agent definitions, and dynamic context contracts for the Agent Kernel.

It is intentionally interview-driven. The goal is not to freeze the architecture early; the goal is to walk the design tree one dependency at a time until the prompt system is obvious enough to implement without guessing.

---

## Current Working Hypothesis

The prompt system should not become a second kernel runtime. It should become a typed authoring and rendering layer that the existing Agent Kernel consumes.

The reusable prompt-AST layer should live in `@codecaine-ai/prompt-kit`. It owns generic prompt structure, builders, renderers, transforms, validation, templates, and broad prompt archetypes. It does not know about Pi, agents, tools, subagents, traces, app sessions, or kernel context loaders.

The Agent Kernel should own the runtime-facing agent model:

- typed agent definitions discovered through `agent.ts`
- prompt rendering through prompt-kit
- variable resolution
- context/runtime packet binding
- Pi session creation and run lifecycle
- private tool binding into Pi registration
- subagent orchestration
- trace emission and viewer contracts

Prompt authoring should eventually be supported by an updated prompt-writing skill. That skill should be written after several real prompts have been migrated through prompt-kit, so its guidance is based on proven examples rather than only the abstract API.

---

## Target Agent Shape

The preferred prompt-system product should be a typed agent bundle without an authored `agent.md`:

```text
agent-catalog/<agent-name>/
  agent.ts              # typed agent manifest and registry entry point
  prompt.ts             # structured prompt source of truth
  context.ts            # optional dynamic context resolver
  tools.ts              # optional private tools
  fixtures/             # optional rendered-context fixtures and snapshots
```

The registry should discover `agent.ts` directly. The agent viewer should render `prompt.ts` into the human-readable system prompt view. An `agent.md` file should not be the normal human editing surface, because its existence implies that it is safe to edit by hand.

---

## Core Distinction

The prompt system should avoid treating `task`, `workflow`, and `multi-turn` as three peer prompt types.

Instead:

- **Task** is a bounded completion job.
- **Agent** is a long-running or tool-capable worker running inside the kernel.
- **Workflow** is a structural section used by both.
- **Steps** describe internal reasoning inside one completion.
- **Phases/actions** describe external execution across tools, state, turns, and subagents.

This keeps the taxonomy close to the kernel's runtime reality: all kernel runs execute an agent definition, but some definitions are simple enough to behave like a single task.

---

## Authoring AST Sketch

Prompt-kit should use an AST-like source format and render it to Markdown with XML tags.

```ts
const prompt = workflowPrompt({
  id: "sourceScoutPrompt",
  sections: [
    section("purpose", [
      bulletList(["Find and evaluate sources for a focused research assignment."]),
    ]),
    section("workflow", [
      orderedList([
        item("Read the research brief."),
        item("Search for relevant evidence.", [
          bulletList(["Prefer primary sources.", "Track uncertainty explicitly."]),
        ]),
        item("Write source notes."),
      ]),
    ]),
  ],
});
```

The exact builders may evolve. The important design pressure is that the source stays structured enough to validate, transform, and render consistently while remaining readable enough for prompt authors to edit.

---

## Default Rendered Body Shape

The rendered system prompt should use Markdown with semantic XML tags.

```xml
<purpose>
    - ...
</purpose>

<rules>
    1. ...
</rules>

<key_knowledge>
    - ...
</key_knowledge>

<goal>
    - ...
</goal>

<background>
    - ...
</background>

<workflow>
    <inputs>
        ...
    </inputs>

    <steps>
        ...
    </steps>

    <!-- or, for agent-loop execution -->
    <phases>
        ...
    </phases>

    <global_constraints>
        ...
    </global_constraints>
</workflow>

<tool_policy>
    ...
</tool_policy>

<state_protocol>
    ...
</state_protocol>

<output_format>
    ...
</output_format>

<success_criteria>
    - ...
</success_criteria>

<reminders>
    - ...
</reminders>
```

Sections should be omitted when they do not earn their token cost.

---

## Dynamic Context Rule

The prompt system should make dynamic data placement explicit.

Recommended split:

- `agent.ts` variables: small spawn-time knobs and required runtime inputs.
- `prompt.ts`: stable system prompt structure that should change rarely during a run.
- `context.ts`: dynamic state, loaded files, app-owned session data, retrieved material, durable working memory, conversation slices, and other run-specific material.
- `tools.ts`: private tool registration and tool-local helpers in the preferred authoring layout.
- user turn prompt: the current operator request or subagent assignment.

The same dynamic request should not be duplicated across surfaces. Duplication makes traces noisy and increases the chance that one copy drifts from another.

The larger model is:

- the system prompt is the stable behavioral contract
- context is the dynamic runtime packet assembled around that contract
- conversation history and user messages are adjacent to context and may overlap conceptually
- the prompt system should make that boundary explicit without pretending it is always clean

---

## Design Tree

### 1. Artifact Boundary

Question: Is this prompt system a skill, a harness package, or a kernel subsystem?

Dependency: This determines whether the first deliverable is documentation and prompt templates, source code generators, or runtime package changes.

Recommended answer: Build a prompt-kit package for generic AST/rendering and update the kernel registry to consume typed agent definitions. Do not create a separate kernel runtime.

### 2. Source Of Truth

Question: Is `agent.md` the source of truth, or are typed `agent.ts` and `prompt.ts` files the source of truth?

Dependency: This determines whether validation happens mostly through linting Markdown or through schema/code generation.

Recommended answer: Use typed `agent.ts` and `prompt.ts` files as the source of truth. Do not make `agent.md` a first-class authored artifact.

### 3. Prompt Taxonomy

Question: Are there two prompt kinds (`task`, `agent`) or a richer taxonomy?

Dependency: This determines archetypes, templates, evaluation dimensions, and how prompt authors route requests.

Recommended answer: Use two top-level kinds, with workflow shape and execution mode as separate fields.

### 4. Context Contract

Question: How strict should the prompt system be about context declarations matching `context.ts` output?

Dependency: This determines whether the prompt system can catch broken context contracts before runtime.

Recommended answer: Let `context.ts` own dynamic context declarations and rendering. Validate static/catalog context when reliable, and surface dynamic context failures through runtime trace events.

### 5. Tool Contract

Question: Should tool policy live in the prompt, in the registry entry, or in executable tool sidecars?

Dependency: This determines how private tool allowlists, prompt instructions, and sidecar implementations stay aligned.

Recommended answer: Let `agent.ts` list shared/core tool access explicitly and let `tools.ts` define private tools in a shape directly compatible with Pi registration.

### 6. Evaluation Contract

Question: Should prompt scoring be required for every generated artifact?

Dependency: This determines whether evaluation is part of the authoring workflow only or becomes a CI/runtime gate.

Recommended answer: Keep evaluation in the authoring workflow first. Add CI gates later only for stable prompt families.

### 7. Storage Location

Question: Where should prompt-system files live in this repository?

Dependency: This determines whether prompt authoring becomes an example, a package, or a skill/reference set.

Recommended answer: Put the reusable prompt AST/rendering code in `packages/prompt-kit`, keep kernel-specific typed agent loading in the kernel, and update prompt-writing skills after several prompt-kit examples exist.

---

## Interview Protocol

We will resolve the design one decision at a time.

Rules:

1. Ask one question at a time.
2. Provide a recommended answer with the question.
3. Wait for feedback before continuing.
4. If the answer can be found by reading the codebase, inspect the codebase instead of asking.
5. Update this document as decisions become shared understanding.
6. Do not turn an unresolved idea into implementation detail.

---

## Decision Log

### D1. Artifact Boundary

Status: decided.

Decision: The prompt system should not become a separate kernel runtime. The first implementation should combine a reusable prompt-kit package with kernel registry changes that consume typed agent definitions.

Prompt-kit owns the generic authoring/rendering layer. The kernel owns the runtime-facing agent contract.

Rationale:

- The kernel already has runtime contracts for agents, context, tools, subagents, and traces.
- The reusable uncertainty is prompt authoring/rendering shape, not a new execution loop.
- Keeping this out of the kernel protects the kernel's boundary: runtime generic, workflow semantics app-side.
- A separate prompt-kit package allows prompt standards to be reused beyond this kernel.
- The registry can change where it needs typed runtime contracts without turning prompt-kit into a runtime package.

### D2. Source Of Truth

Status: decided.

Decision: Structured prompt specs are the preferred authoring source of truth. `agent.md` is not part of the ideal authored model.

The system should support a structured JSON-like prompt representation that renders into Markdown with XML tags. This preserves the old XML prompt-writing style while giving the authoring layer a typed structure that can be validated, transformed, and rendered consistently.

`agent.md` should not be a first-class authored artifact. The agent viewer should render the prompt source directly for inspection, and any future Markdown export should be clearly treated as derived output.

### D3. Spec File Format

Status: decided.

Decision: Use TypeScript for the first source prompt format.

TypeScript fits the existing workspace, gives prompt authors type checking and builder autocomplete, and lets renderers, validators, transforms, and templates share the same definitions. JSON can remain a later interchange/export format if needed.

### D4. Config Surface

Status: decided.

Decision: Agent configuration should move out of `agent.md` frontmatter and into the typed `agent.ts` definition.

Frontmatter is useful as a compact filesystem convention, but it is a weak source of truth for a tightly-defined prompt system. The typed agent definition represents model, tools, variables, turn limits, subagent permissions, background behavior, prompt binding, context binding, and private tool binding with stronger validation and better authoring ergonomics.

### D5. Private Tool Sidecar Naming

Status: decided.

Decision: Per-agent private tools should live in `tools.ts` in the prompt-system layout.

`tools.ts` is more explicit and matches the emerging typed layout. `index.ts` currently means "private tool sidecar" only by convention, and that convention is hidden inside the registry. In a tightly-defined prompt system, file names should say what they contain.

Registry note: the typed registry path should load `tools.ts` directly through `agent.ts`. `index.ts` should not remain the long-term private tool convention.

### D6. Rendered Agent Artifact Role

Status: decided.

Decision: In the ideal prompt-system model, there is no first-class authored `agent.md`.

The agent viewer should render the structured `prompt.ts` source into the readable system prompt view. If a Markdown export exists later, it should be treated as derived output and should not invite hand editing.

Rationale:

- System prompt, dynamic context, tools, and user turn have different lifetimes.
- Dynamic context is per spawn/run and may be large or volatile.
- Tool implementations are executable sidecars, not prompt text.
- The current trace system already treats system prompt and context build as separate inspectable artifacts.
- A visible authored `agent.md` is misleading once `prompt.ts` is the source of truth.
- The viewer is the right place to inspect the rendered prompt and the full composed runtime packet.

### D7. Registry Compatibility Strategy

Status: decided.

Decision: Change the registry to load typed agent files directly. Do not make generated `agent.md` compatibility the primary implementation path.

The prompt system is allowed to be a hefty registry overhaul. Existing agents can be migrated once the new shape is ready. The new path should make `agent.ts`, `prompt.ts`, `context.ts`, and `tools.ts` first-class, rather than preserving frontmatter and `agent.md` as compatibility concepts.

Rationale:

- Generated `agent.md` keeps the misleading editable artifact alive.
- The viewer can render `prompt.ts` directly for human inspection.
- Typed agent manifests and prompt files are the source of truth.
- A direct registry change avoids carrying two parallel agent definition models.

### D8. Registry Discovery File

Status: decided.

Decision: The registry should discover `agent.ts` as the identity file for an agent directory.

`agent.ts` acts like the directory's manifest or index file. It should contain or export the typed agent definition: name, description, model, tool allowlist, variable schema, turn limits, spawn permissions, and references/imports for prompt/context/tools.

Rationale:

- The folder name identifies the agent directory; `agent.ts` identifies the agent entry point inside it.
- `config.ts` sounds like only configuration, while the registry entry point is the whole agent manifest.
- `agent.ts` pairs cleanly with `prompt.ts`, `context.ts`, and `tools.ts`.
- The file has a similar ergonomic role to an index file without using an ambiguous `index.ts`.

### D9. Manifest Shape

Status: decided.

Decision: `agent.ts` is the composition point. It inlines the agent config object and imports sibling modules for prompt, context, and tools.

The directory no longer needs a separate `config.ts`. The config fields live directly in `defineAgent(...)` inside `agent.ts`, while prompt, context, and tools remain separate files.

Example:

```ts
import { defineAgent } from "@agent-kernel/kernel/agent-definition";
import { prompt } from "./prompt";
import { context } from "./context";
import { tools } from "./tools";

export default defineAgent({
  name: "research-coordinator",
  description: "Coordinates a research request through focused scouts and final synthesis.",
  model: "codex-lb/gpt-5.5",
  coreTools: ["read", "write", "spawn"],
  canSpawnSubagent: true,
  variables: {
    researchMemoryDir: {
      default: "research-memory",
      description: "Directory inside the active research session that stores working memory.",
    },
  },
  prompt,
  context,
  tools,
});
```

### D10. Manifest API Shape

Status: decided.

Decision: The TypeScript authoring API uses camelCase field names.

The registry/runtime can normalize to existing internal field names as needed. The public authoring surface should feel native to TypeScript now that frontmatter is being removed.

### D11. Prompt Module Export Shape

Status: decided.

Decision: `prompt.ts` exports a structured prompt object created with `definePrompt(...)`, not a raw rendered string.

The structure of this object is the hard part. The prompt system may need to support multiple prompt structures/archetypes, all rendered through the same XML/Markdown rendering layer.

### D12. Prompt Structure Strategy

Status: decided.

Decision: The prompt system should use typed archetypes, but they must stay extensible rather than hyper-strict.

The initial archetypes should be `singleOutput` and `workflow`, with shared sections such as purpose, rules, inputs, workflow, output, success criteria, and reminders. The type system should provide guardrails, defaults, and renderer safety, but prompt authors need room to add custom sections, omit nonessential sections, and adjust structure when the prompt calls for it.

The design principle is "typed spine, flexible sections":

- Archetypes define the expected shape and required core fields.
- Common primitives handle repeated structures such as sections, steps, phases, examples, constraints, and output formats.
- Escape hatches allow custom XML sections when a prompt genuinely needs something unusual.
- Validation should catch broken references, invalid runtime contracts, and malformed sections; it should not force every prompt into the same maximum template.

### D13. Flexibility Model

Status: decided.

Decision: The prompt system should support a general structured prompt AST as a first-class capability, with core typed templates/archetypes layered on top.

Typed templates are useful defaults, but they must not be the boundary of what can be expressed. Authors should be able to build whatever structure a prompt needs from typed primitives such as sections, blocks, steps, phases, examples, constraints, inputs, and output formats.

The core value is structured composition:

- prompts are represented as structured objects
- sections can be replaced, omitted, reordered, or generated
- templates provide common arrangements, not hard limits
- the renderer turns the object tree into Markdown/XML or another target format
- this replaces ad hoc string templating with explicit object-level substitution

This is the alternative to Jinja-style prompt construction: instead of interpolating text into a large string, authors compose and transform typed prompt nodes.

### D14. Prompt Composition Primitive

Status: decided.

Decision: The core composition unit is a section-like prompt node that can contain nested nodes.

Sections should be able to contain bullets, ordered items, paragraphs, examples, code blocks, nested subsections, workflow nodes, and custom prompt nodes. Specialized builders such as `purpose(...)`, `rules(...)`, `steps(...)`, and `phases(...)` should return section-compatible nodes.

The goal is maximum dynamic composition:

- replace a section by tag or id
- insert a section before or after another section
- nest subsections inside parent sections
- render the same tree to Markdown/XML or another target later
- avoid Jinja-style string replacement where possible
- treat templates as functions that return node trees

### D15. Prompt Node Model

Status: decided.

Decision: The prompt AST starts with a small recursive node model.

Base nodes:

- `section`
- `paragraph`
- `bulletList`
- `orderedList`
- `field`
- `codeBlock`
- `example`
- `raw`

Lists must support nested content. A numbered item or bullet item can contain sub-bullets, sub-numbered lists, paragraphs, examples, or other nodes. This keeps workflows, constraints, and complex instructions composable without falling back to string formatting.

Specialized workflow nodes such as `phase`, `step`, `constraint`, `input`, and `outputFormat` can be typed helpers built on top of the base nodes.

### D16. List Item Shape

Status: decided.

Decision: List items are full node containers with optional leading text.

This supports simple lists while allowing nested sub-bullets and richer content when needed.

Example:

```ts
bulletList([
  "Use only declared tools.",
  item("When context is incomplete:", [
    orderedList([
      "Identify the missing input.",
      "Ask one focused question.",
    ]),
  ]),
]);
```

### D17. Node Identity

Status: decided.

Decision: Prompt nodes should support stable ids separate from rendered XML tag names.

Tags describe rendered semantics; ids support programmatic replacement, insertion, diffing, and viewer selection without coupling transformations to display names.

Use cases:

- replacing a section without relying on tag names
- inserting before or after a specific node
- diffing prompt revisions
- linking viewer selections back to source nodes
- supporting repeated tags such as multiple examples, phases, or constraints

### D18. Ordering Model

Status: decided.

Decision: Array order is the canonical prompt ordering model.

The primary authoring and review surface is reading the prompt linearly, so source order should match rendered order. Transform helpers can insert, replace, or reorder nodes programmatically, but nodes should not need persistent `before`, `after`, or `priority` hints in the normal path.

### D19. Rendered Format

Status: decided.

Decision: The default renderer outputs XML-tagged Markdown.

This preserves readability while giving the model clear parseable boundaries. The AST may support other render targets later, but XML-tagged Markdown is the primary/default output.

### D20. Markdown Normalization

Status: decided.

Decision: Renderers own output formatting and normalize structural Markdown by default.

The prompt structure and rendered representation are separate. The default XML-tagged Markdown renderer owns indentation, blank lines, bullet markers, numbering, code fences, and XML spacing. Other custom renderers can render the same prompt AST differently for different model/provider needs.

### D21. Variable Interpolation

Status: decided.

Decision: Dynamic references in prompt AST content should be typed variable/reference nodes, not raw string placeholders.

This moves the prompt system toward a full AST rather than string templating. The renderer may output placeholders only when targeting a runtime that still performs string substitution, but the source model should know a dynamic reference is a variable/reference node.

Example:

```ts
paragraph(["Current request: ", variable("userPrompt")])
```

instead of:

```ts
paragraph("Current request: {{userPrompt}}")
```

### D22. Variable Declaration Ownership

Status: decided.

Decision: Runtime variables are declared in `agent.ts`.

`agent.ts` owns the variable schema because variables are part of the agent's runtime contract. The schema must be able to express required variables, optional variables, defaults, descriptions, and validation behavior. `prompt.ts` references variables through typed variable nodes.

Validation should fail when:

- `prompt.ts` references an undeclared variable
- a required variable has no default and no caller-provided value
- caller variables include unknown names, unless explicitly allowed by a future escape hatch

### D23. Variable Requiredness

Status: decided.

Decision: Variables are required by default.

An agent variable declaration represents a required runtime input unless it has a default or is explicitly marked optional.

Rules:

- No `default` and no `optional: true` means the variable is required.
- `required: true` may be used for explicitness, but requiredness is the default.
- A variable with a `default` is optional at spawn time.
- `optional: true` without a default means the variable may be absent and the prompt/context must handle absence explicitly.
- Required variables must be provided before the model run starts.

Example:

```ts
variables: {
  userPrompt: stringVar({
    description: "The current operator request.",
  }),
  researchMemoryDir: stringVar({
    default: "research-memory",
    description: "Working memory directory.",
  }),
  phase: stringVar({
    optional: true,
    description: "Trace grouping phase, when supplied by the host app.",
  }),
}
```

### D24. Variable Name Style

Status: decided.

Decision: Author-facing variable names use camelCase.

The prompt system authoring surface is TypeScript, so variable names should follow TypeScript conventions. Renderers and runtime adapters may normalize names for provider/runtime targets if needed.

### D25. Context Contract Ownership

Status: decided.

Decision: `context.ts` owns dynamic context shape, loader declarations, and context rendering. `prompt.ts` owns instructions for how to use the injected context, not a second context schema.

This avoids double-counting. The prompt should not redeclare every context section that `context.ts` already declares. Instead:

- `context.ts` declares what dynamic data is loaded and how it renders.
- `prompt.ts` can reference the context block by id/tag and describe usage rules.
- `agent.ts` binds the prompt and context modules together.
- the viewer can inspect `context.ts` to show the context contract and rendered preview.

Example:

```ts
// context.ts
export const context = defineContext({
  id: "researchContext",
  tag: "research_context",
  sections: {
    researchBrief: fileSection({
      tag: "research_brief",
      path: "research-memory/brief.md",
      required: true,
    }),
    sourceNotes: directorySection({
      tag: "source_notes",
      pattern: "research-memory/sources/**/*.md",
    }),
  },
});
```

```ts
// prompt.ts
usesContext("researchContext", {
  instructions: [
    "Use source notes as evidence.",
    "Do not invent sources outside the loaded context.",
  ],
});
```

### D26. Prompt Context Reference

Status: decided.

Decision: `prompt.ts` may refer to dynamic context through a lightweight context-usage node that names the context id/tag and supplies usage instructions.

This lets the stable prompt tell the model how to use injected runtime context without redeclaring the full context loader schema owned by `context.ts`.

### D27. Runtime Input Model

Status: decided.

Decision: Dynamic material should be modeled as a broader runtime input packet.

The packet may include context, conversation history, current user turn, prior tool results, loaded files, app state, or other run-specific material. `context.ts` can remain the module that assembles much of this packet, but the conceptual model should acknowledge that context, conversation history, and current messages are a blurry boundary around the stable system prompt.

The system prompt is stable by convention, not by law. It is expected to change rarely during a run, but the architecture should not rely on it being impossible to change.

### D28. Agent Definition vs Run Invocation

Status: decided.

Decision: Durable agent definitions own relatively stable setup/configuration. Run invocations own dynamic values and per-run state.

Durable agent definition:

- name
- description
- default model/settings
- prompt source
- variable schema
- runtime packet/context assembler
- private tool registrations
- spawn permissions
- default turn limits
- background behavior

Run invocation:

- caller-provided variable values
- current user message or assignment
- conversation/session state
- loaded runtime packet
- parent/subagent linkage
- app session identity
- per-run overrides when allowed

### D29. Override Policy

Status: decided.

Decision: Run invocations should only casually override dynamic inputs, not agent configuration.

Allowed per run:

- variable values
- current user message or assignment
- app session identity and paths
- runtime packet inputs
- parent/subagent linkage

Not casually overrideable:

- prompt structure
- tool allowlist
- variable schema
- context/runtime packet assembler shape
- spawn permissions
- model
- thinking level
- max turns
- background behavior

Model, thinking level, max turns, and background behavior are agent configuration and cost/control semantics. If they need to differ, that should usually be represented as an explicit agent variant or an administrative override rather than ordinary run input.

### D30. Agent Variants

Status: decided.

Decision: Support explicit variants in the durable agent definition model.

Variants represent different configurations of essentially the same prompt/context/tool identity. They are appropriate when an agent should keep the same behavioral contract but run with different model, thinking, turn limit, background, or cost/performance settings.

Separate agents remain appropriate when the prompt, context shape, tool contract, or actual behavior diverges materially.

Example:

```ts
defineAgent({
  name: "source-scout",
  prompt,
  context,
  registerTools,
  model: "codex-lb/gpt-5.5",
  thinking: "low",
  maxTurns: 6,
  variants: {
    cheap: {
      model: "codex-lb/gpt-5-mini",
      thinking: "low",
      maxTurns: 4,
    },
    deep: {
      model: "codex-lb/gpt-5.5",
      thinking: "high",
      maxTurns: 12,
    },
  },
});
```

### D31. Variant Override Surface

Status: decided.

Decision: Variants have a narrow override surface for operational configuration, not behavioral design.

Variants are mainly for split testing, cost/performance tuning, and phase-specific operational configuration. They should not become a way to keep several competing prompt designs alive indefinitely. If there are three different research-agent behaviors, the owner should usually converge on the best one or create distinct agents with distinct purposes.

Variants may override:

- model
- thinking level
- max turns
- background behavior
- display label
- future cost/concurrency hints

Variants should not override:

- prompt
- context/runtime packet assembler
- tools
- variable schema
- spawn permissions

Example use case: the same agent may run with `maxTurns: 5` in an early phase and a much higher limit in a long-running phase.

### D32. Prompt Experiments

Status: decided.

Decision: Prompt A/B testing is out of scope for the core variant model and not needed in the first design.

Core variants must not override prompt structure for experimentation. If prompt A/B testing becomes important later, it should be handled by separate experiment tooling or explicit temporary agent definitions rather than the normal variant model.

### D33. Tool Allowlist Source

Status: decided.

Decision: `agent.ts` declares shared/core tool access. `tools.ts` defines private/custom tools that are automatically included for that agent.

`agent.ts` should declare access to tools that already exist outside the agent, such as core runtime tools, shared app tools, shell/file capabilities, subagent capabilities, or provider/MCP tools.

`tools.ts` should define private tools that belong to the agent. If a tool is defined in `tools.ts`, it is part of that agent's private capability surface and should not need to be repeated in an allowlist.

The current frontmatter `tools` field mixes two ideas:

- access to existing core/shared tools such as read, write, bash, or subagent tools
- private tools registered by the agent sidecar

The new typed model separates them. Shared/core tool access is permission/configuration. Private tools are implementation plus declaration.

Tool groups are not part of the first design. They may become a convenience later, but the first model should stay explicit.

### D34. Shared Tool Access Shape

Status: decided.

Decision: Shared/core tool access starts as a flat explicit list of tool names.

No aliases, bundles, or tool groups are needed in the first design. If repeated boilerplate becomes painful later, aliases can be added as a convenience layer.

Example:

```ts
defineAgent({
  coreTools: ["read", "write", "bash"],
  tools,
});
```

### D35. Private Tool Export Shape

Status: decided.

Decision: `tools.ts` exports structured tool definitions that are directly compatible with Pi's `registerTool(...)` function, or are only a very thin wrapper over that shape.

Avoid making `registerTools(pi)` the only source of truth because it is harder to inspect and validate statically. The typed tool layer must stay close enough to Pi's tool shape that registration is boring and reliable.

Pi reference findings:

- Built-in/shared tool access is controlled by a `tools` allowlist when creating a Pi agent session.
- Custom tools are registered through extensions using `pi.registerTool(...)`.
- Pi supports a structured `defineTool(...)` helper that returns a tool object passed to `pi.registerTool(...)`.
- Pi tool definitions can include `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, `execute`, custom renderers, and `terminate`.
- The kernel currently wires private agent tools through extension factories, so a structured `tools.ts` export can still be compiled into an `ExtensionFactory` that calls `pi.registerTool(tool)` for each private tool.

The design requirement is operational: the typed tool layer must remain directly compatible with Pi registration.

Example:

```ts
export const tools = defineToolSet([
  defineTool({
    name: "write_report",
    label: "Write report",
    description: "Persist the final markdown report.",
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      content: Type.String(),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // ...
    },
  }),
]);
```

Runtime registration should be equivalent to:

```ts
for (const tool of tools) {
  pi.registerTool(tool);
}
```

### D36. Tool Runtime Injection

Status: decided.

Decision: Private tools should use runtime-bound tool factories.

This lets app-specific services be injected cleanly into tools while still producing ordinary Pi tool definitions before registration.

Example:

```ts
export const tools = defineToolSet((runtime: ResearchRuntime) => [
  defineTool({
    name: "write_report",
    label: "Write report",
    parameters: ReportParams,
    async execute(_toolCallId, params) {
      return runtime.writeFinalReport(params.title, params.content);
    },
  }),
]);
```

Adapter registration:

```ts
for (const tool of tools.bind(appRuntime)) {
  pi.registerTool(tool);
}
```

This keeps runtime dependencies injectable, testable, and app-owned while preserving direct Pi registration compatibility.

### D37. Tool Metadata Inspectability

Status: decided.

Decision: Tool metadata does not need to be statically inspectable without binding runtime in the first pass.

Use the simple runtime factory shape first. If the registry or viewer needs metadata, it can bind with an app-provided runtime or a stub runtime during validation. If this becomes awkward later, the tool definition shape can split static metadata from execution binding.

### D38. Context Runtime Injection

Status: decided.

Decision: `context.ts` should support a runtime-bound factory pattern, similar to `tools.ts`.

Context loaders and assembly often need app-owned services, paths, database snapshots, session state, working memory, feature flags, conversation slices, or custom loader catalogs. The bound result should still match the kernel's context resolver contract.

Example:

```ts
export const context = defineContext((runtime: ResearchRuntime) => ({
  loaders: [
    fileLoader({ path: "research-memory/brief.md" }),
    runtime.workingMemoryLoader({
      path: "research-memory/scout-reports",
    }),
  ],
  assemble(loaded, ctx) {
    return renderResearchContext(loaded, ctx);
  },
}));
```

### D39. Context Render Shape

Status: decided.

Decision: `context.ts` should be structured-first, with a raw string escape hatch.

Most context is pulled from external files, app state, data sources, conversation slices, prior tool results, or working memory. The context system should provide consistent structured wrappers and formatting helpers for those loaded inputs.

Raw string assembly remains available as an escape hatch for unusual cases, but the preferred path should be structured context packet nodes rendered through the same general rendering philosophy as prompts.

### D40. Loader Declaration Shape

Status: decided.

Decision: Context should support typed helper builders on top of generic loader declarations.

This mirrors the prompt AST philosophy:

- core structured helpers for common cases
- generic loader escape hatch for custom/app-specific cases
- renderer/formatter helpers for consistent output
- no requirement that every context shape fit a small fixed set of helpers

The underlying kernel can still operate on generic loader declarations.

### D41. Loader Rendering Metadata

Status: decided.

Decision: Typed context loader helpers may carry rendering metadata, but most metadata should be optional with sensible defaults.

Typed helpers should carry enough metadata to render loaded content consistently and show meaningful context previews in the viewer, but authors should not have to specify everything for common cases.

Likely optional metadata:

- XML tag name
- viewer label
- requiredness
- empty behavior
- truncation/windowing policy
- display ordering when not implied by array order

Defaults should be derived from the helper id and loader type where possible.

### D42. Context Requiredness

Status: decided.

Decision: Context sections are optional by default, with explicit required/warning policies.

Unlike variables, external data sources are often legitimately empty. A section may be marked required when missing data should block the run, or warning-level when missing data should be visible but not fatal.

Policy examples:

```ts
fileSection("brief", {
  path: "research-memory/brief.md",
  required: true,
});

directorySection("scoutReports", {
  pattern: "research-memory/scout-reports/*.md",
  onEmpty: "warn",
});
```

Missing/empty/error states should surface through context lifecycle trace events so the viewer can show what loaded, what was empty, and what failed.

### D43. Context Failure Policy

Status: decided.

Decision: Context sections support simple missing/empty/error policies.

Supported policy fields:

```ts
onMissing: "optional" | "warn" | "error";
onEmpty: "optional" | "warn" | "error";
onError: "warn" | "error";
```

These map cleanly onto context lifecycle trace events and viewer warnings.

### D44. Validation vs Trace Warnings

Status: decided.

Decision: Context problems should surface through both boot/static validation and runtime trace events.

Boot/static validation should catch catalog and shape problems that are knowable before a run starts:

- unknown loader kind
- invalid section id
- duplicate context section id
- malformed loader config
- missing always-required static resources when the path is knowable
- bad variable/reference usage

Runtime validation and trace events should handle dynamic material:

- files that exist only inside a run/session directory
- app/session state
- database-backed context
- conversation slices
- working memory
- data that can change between runs

The section's failure policy decides whether runtime missing/empty/error states block the run or continue with warnings.

### D45. Boot Validation Scope

Status: decided.

Decision: Boot validation should eagerly check static resources when reliable.

Rules:

- catalog/package-relative resources can be checked at boot
- session/app/cwd-relative resources should be checked at runtime
- DB/app state/conversation-derived context should be checked at runtime

This gives early failure for broken static catalog resources without pretending dynamic context is available before a run.

### D46. Agent Viewer Responsibility

Status: decided.

Decision: The agent viewer should be the primary human inspection surface for the composed typed agent.

The viewer should render the composed typed agent rather than relying on an editable `agent.md`.

Likely layout direction:

- main area: rendered system prompt from `prompt.ts`
- nearby prompt tabs: system prompt, runtime context, combined/effective view when applicable
- right column/inspector: config, tools, context, validation, and runtime metadata

The exact UI can evolve, but the core responsibility is to make the typed agent inspectable:

- manifest/config from `agent.ts`
- rendered system prompt from `prompt.ts`
- core/shared tool access
- private tool metadata from `tools.ts`
- context contract from `context.ts`
- rendered runtime packet/context when available
- resolved variables
- validation warnings/errors

### D47. Combined Prompt View

Status: decided.

Decision: The viewer should include an optional combined/effective prompt view.

This is a debug/viewer affordance, not a stored source artifact. The combined view lets humans inspect what the model effectively received without making that combined text the authoring surface.

### D48. Trace Source Metadata

Status: decided.

Decision: Do not require trace source maps in the first implementation.

Source-node ids should still be part of the AST design because they may support future source maps, prompt diffs, viewer selection, and trace debugging. But trace events do not need line-level/source-node mappings for the first registry migration.

### D49. Migration Strategy

Status: decided.

Decision: Migrate the existing example agents as part of the typed registry implementation.

The Simple Research Kernel agents are in scope for the overhaul and should serve as the proving ground:

```text
research-coordinator/
  agent.ts
  prompt.ts
  context.ts
  tools.ts

source-scout/
  agent.ts
  prompt.ts
  context.ts
  tools.ts

synthesis-writer/
  agent.ts
  prompt.ts
  context.ts
  tools.ts
```

Avoid maintaining two first-class registry models longer than necessary.

### D50. Agent Definition API Location

Status: decided.

Decision: Runtime-facing typed agent definition APIs belong in the kernel, while generic prompt AST/rendering standards may become a separate package.

The kernel should own APIs that the registry/runtime must load and execute, such as:

- `defineAgent`
- typed agent manifest shape
- registry loading contracts
- context binding into kernel runtime
- private tool binding into Pi registration

The generic prompt AST/rendering layer may deserve its own package because it is useful beyond the Agent Kernel. Prompt AST creation, XML-tagged Markdown rendering, structured prompt composition, and prompt authoring standards should not be unnecessarily coupled to this kernel if they can be reused elsewhere.

Package split:

```text
@agent-kernel/kernel
  runtime-facing agent definitions and registry contracts

@codecaine-ai/prompt-kit
  generic prompt node model, renderers, builders, and standards
```

### D51. Prompt AST Package Boundary

Status: decided.

Decision: Create a separate workspace package for prompt AST/rendering in the first implementation.

The Agent Kernel should consume this package rather than own all prompt AST/rendering concerns directly.

Package responsibility:

- prompt node model
- builders such as `section`, `bulletList`, `orderedList`, `field`, `example`
- renderers, starting with XML-tagged Markdown
- prompt transforms and composition helpers
- generic prompt standards that are not kernel-specific

Kernel responsibility:

- agent registry
- agent manifests
- runtime variable resolution
- context/runtime packet binding
- tool registration through Pi
- trace/viewer integration

### D52. Prompt Package Name

Status: decided.

Decision: The prompt AST/rendering package should be named `@codecaine-ai/prompt-kit`.

The name keeps the package generic and reusable outside the Agent Kernel. It should contain prompt AST primitives, builders, renderers, transforms, and generic prompt authoring standards.

### D53. Prompt Kit vs Kernel Wrappers

Status: decided.

Decision: Generic prompt AST/rendering APIs belong in `@codecaine-ai/prompt-kit`; kernel-specific agent/runtime APIs belong in `@agent-kernel/kernel`.

Prompt kit should know nothing about Pi, agent registries, subagents, kernel traces, or app sessions.

`@codecaine-ai/prompt-kit` owns:

- prompt AST node model
- generic builders such as `section`, `paragraph`, `bulletList`, `orderedList`, `field`, `codeBlock`, `example`, and `raw`
- XML-tagged Markdown renderer
- prompt transforms such as replace/insert/omit
- generic templates/archetypes that do not depend on kernel concepts

`@agent-kernel/kernel` owns:

- `defineAgent`
- typed agent manifest shape
- runtime variable schema
- agent variants
- context/runtime packet binding
- Pi tool binding
- registry loading
- viewer/trace integration
- kernel-specific prompt helpers, only when they truly depend on kernel concepts

### D54. Prompt Kit Directory Layout

Status: decided.

Decision: `@codecaine-ai/prompt-kit` should use nested domain directories rather than a flat package.

First-pass layout:

```text
packages/prompt-kit/
  src/
    nodes/
      types.ts
      create-node.ts
      guards.ts

    builders/
      section.ts
      text.ts
      lists.ts
      examples.ts
      code.ts
      fields.ts

    renderers/
      xml-markdown/
        render.ts
        render-node.ts
        indentation.ts
        escaping.ts

    transforms/
      find.ts
      replace.ts
      insert.ts
      omit.ts
      visit.ts

    templates/
      task.ts
      agent.ts
      workflow.ts

    validation/
      validate-tree.ts
      diagnostics.ts

    ui/
      editors/
      renderers/
      index.ts

    index.ts
```

Prompt-kit may also grow a lightweight UI authoring surface, but that UI should operate on the same AST model rather than inventing a second prompt format.

### D55. Monorepo Package Path

Status: decided.

Decision: The package lives at `packages/prompt-kit` and its package name is `@codecaine-ai/prompt-kit`.

This keeps the workspace path short and consistent while leaving the published/import name under the broader Codecaine AI scope.

### D56. Prompt Kit Dependency Direction

Status: decided.

Decision: Kernel may depend on prompt-kit. Prompt-kit must not depend on kernel.

Prompt-kit is a simple generic AST/rendering package. It should not know about agents, Pi, tools, subagents, trace events, context loaders, or app sessions.

### D57. Prompt Kit Template Scope

Status: decided.

Decision: Prompt-kit should include templates and archetypes.

Prompt-kit owns reusable prompt layouts in addition to the raw AST primitives. These templates/archetypes should provide common structured prompt patterns while still being built from composable nodes that can be replaced, omitted, or extended.

Prompt-kit includes:

- nodes
- builders
- renderers
- transforms
- validation
- templates
- archetypes

### D58. Template Coupling Boundary

Status: decided.

Decision: Prompt-kit templates should stay kernel-agnostic.

Kernel-specific archetypes can live in the Agent Kernel implementation or prompt skill layer and compose prompt-kit primitives/templates.

The important boundary: in the kernel model, context and Pi tools sit outside the stable system prompt even though they eventually influence the model's effective input. Prompt-kit should not need to understand that runtime arrangement.

### D59. Kernel-Specific Prompt Archetypes

Status: decided.

Decision: Concrete coordinator, worker, scout, and report-writer prompts are not archetypes. They are concrete prompts or examples.

In this design, archetypes mean broad prompt shapes, initially:

- single-output prompt
- workflow prompt

More specific patterns such as evaluator, extraction, classification, critique/revise, summarization, and decision support should begin as templates under those broad archetypes.

Concrete prompts such as a basic coordination agent belong in examples, such as the Simple Research Kernel example, not in prompt-kit archetypes.

Prompt-kit may own generic archetypes and templates for global prompt shapes. Kernel-specific examples should live with the kernel examples or prompt skill reference material.

### D60. Prompt Terminology

Status: decided.

Decision: Use `archetype`, `template`, and `example` with distinct meanings, but keep the archetype taxonomy minimal until it proves itself.

Working terminology:

- `archetype`: broad execution/structure family
- `template`: reusable parameterized layout for a prompt pattern
- `example`: concrete prompt in an actual app

Current uncertainty: the archetype list should not be over-specified yet. Many things that sound like archetypes, such as extraction, evaluation, or classification, may be better modeled as templates over the same broad execution shape.

Minimal starting axis:

- single-step/single-output prompt
- multi-step workflow prompt

Both can still use internal reasoning steps. A single-output extraction prompt may have internal thinking structure but still produce one completion. Evaluator prompts, extraction prompts, and classifier prompts can begin as templates rather than top-level archetypes.

### D61. Initial Archetype Set

Status: decided.

Decision: Prompt-kit should start with two broad archetypes: `singleOutput` and `workflow`.

Use templates for more specific prompt patterns such as extraction, evaluation, classification, critique/revise, summarization, and decision support.

The examples and initial template ideas should be based on `prompt-skills-reference/`, especially the existing old XML workflow-design material and the newer prompting skill references.

### D62. Template Source Material

Status: decided.

Decision: Seed prompt-kit templates/examples from `prompt-skills-reference`.

Use old prompt-writing references for structure:

- `prompt-skills-reference/prompt-writing-old/system_prompt/12-reference-template.md`
- `prompt-skills-reference/prompt-writing-old/system_prompt/20-workflow-design/*`

Use newer prompting references for authoring quality:

- `prompt-skills-reference/prompting/30-generation/01-context-engineering.md`
- `prompt-skills-reference/prompting/30-generation/02-formatting-rules.md`
- `prompt-skills-reference/prompting/30-generation/05-anti-patterns.md`
- `prompt-skills-reference/prompting/30-generation/06-evaluation-protocol.md`

The old material carries the XML/AST-like structural feel. The newer material is better as QA and methodology.

### D63. First Implementation Milestone

Status: decided.

Decision: Build `@codecaine-ai/prompt-kit` primitives plus XML Markdown renderer first, then migrate one Simple Research Kernel agent end-to-end through the typed registry path.

First milestone sequence:

1. Build prompt-kit AST primitives, builders, validation basics, XML-tagged Markdown renderer, and focused tests.
2. Add kernel typed-agent loading for `agent.ts`, `prompt.ts`, runtime context binding, and private tool binding.
3. Migrate one Simple Research Kernel agent end-to-end first, likely `source-scout`.
4. Migrate the remaining Simple Research Kernel agents once the first path is proven.

The updated prompt-writing skill is part of the broader effort, but should come after several real prompts have been authored or migrated with prompt-kit. The skill should describe the proven authoring workflow, templates, standards, and review/evaluation process rather than guessing ahead of the package.

### D64. Prompt Authoring Surface

Status: decided.

Decision: Prompt-kit should support multiple authoring surfaces over one canonical AST.

The canonical model is the plain prompt AST. Code authors should usually use builder helpers because they make prompt files readable and consistent. The prompt-kit ecosystem may also include a lightweight UI for creating, editing, arranging, and previewing prompts.

The UI should not create a separate prompt format. It should read and write the same structured prompt model used by `prompt.ts`, and it should preview the default XML-tagged Markdown renderer.

Authoring surfaces:

- plain AST objects for interchange, tests, transforms, and generated output
- TypeScript builders for normal code-authored prompts
- lightweight UI for visual prompt construction and inspection

This keeps the model portable while allowing prompt authors to work visually when that is more ergonomic.

### D65. Prompt UI Package Location

Status: decided.

Decision: The lightweight prompt UI can live inside `@codecaine-ai/prompt-kit` for now.

The first implementation does not need a separate UI package. The UI should be organized so it is clearly optional and does not pollute the headless core API. A future split into a package such as `@codecaine-ai/prompt-kit-ui` should remain possible if dependencies, build size, or release cadence make that worthwhile.

Practical packaging direction:

- keep AST, builders, renderers, transforms, and validation as the root/headless prompt-kit exports
- place UI code in a separate internal directory or subpath
- avoid making UI/browser dependencies required for non-UI prompt-kit consumers when possible
- let the UI read, edit, and preview the same canonical AST used by code-authored prompts

### D66. Prompt UI Save Format

Status: decided.

Decision: The prompt UI should operate on the canonical prompt object.

The specifics of the UI save/export mechanics are out of scope for the first design. The important constraint is that the UI should not introduce a separate prompt representation. Any UI surface should read, manipulate, and preview the same canonical prompt AST used by prompt-kit builders, renderers, validation, and transforms.

### D67. Prompt Schema Versioning

Status: decided.

Decision: Canonical prompt objects should carry an explicit schema version.

The first prompt object shape should include a version field such as `schemaVersion: "prompt-kit/v1"`. Prompt-kit will be used by code-authored prompts, UI-authored prompts, transforms, tests, and generated artifacts. A version field gives the system a clear migration hook when the AST changes.

### D68. Prompt UI Shape

Status: decided.

Decision: Prompt-kit UI should follow the same general editor/renderer split used elsewhere in the kernel ecosystem.

The prompt-kit UI can include lightweight editors and renderers for the canonical AST. The kernel agent viewer can import those UI pieces when it wants to inspect, preview, or edit prompt-kit objects. The UI remains an affordance over the canonical prompt object rather than a separate runtime or source format.

First-pass UI scope is intentionally loose. Any practical editor/renderer surface is acceptable as long as it reads and renders the canonical AST.

### D69. Migration Scope

Status: decided.

Decision: The typed prompt-kit and registry migration should be treated as one coordinated overhaul.

The migration path is not to preserve `agent.md` compatibility as a long-lived parallel system. The implementation should introduce prompt-kit, typed `agent.ts` registry loading, typed prompt rendering, context binding, tool binding, viewer integration, and migration of existing Simple Research Kernel examples as a coherent change set.

The first agent migration can still be used as the proof point while implementing, but the intended endpoint is that the example catalog moves fully to the typed model.

Implementation note: the first coordinated implementation is now in place. The kernel has a typed `defineAgent(...)` authoring API, the registry can discover `agent.ts`, prompt-kit renders `prompt.ts` documents into XML-tagged Markdown, private `tools.ts` registrations are harvested and bound through Pi extension factories, the agent viewer can consume prompt-kit preview models, and the Simple Research Kernel catalog uses `agent.ts`/`prompt.ts`/`context.ts`/`tools.ts` rather than authored `agent.md`/frontmatter/`index.ts`.

---

## Amendments — 2026-07-01 Overhaul

These decisions supersede earlier entries where noted. Implementation plan:
`docs/.drafts/agent-kernel-overhaul.plan.md`.

### D70. Canonical Prompt Artifact (revises D2, D3)

Status: decided.

Decision: The canonical authored prompt artifact is the serialized
`PromptDocument` JSON (`prompt.json`), not TypeScript builder code.

D2/D3 chose TypeScript as the first source format before the prompt editor UI
existed. Notion-style structural editing must persist, and edited documents
cannot round-trip into hand-authored builder calls. The builders remain
exported as the programmatic construction library (scripts, generators,
tests); what is committed and loaded by the registry is the document.

Validation does not weaken: `validatePrompt` with declared variables performs
the checks the type system performed, at boot and in the editor.

### D71. Prompt UI Save Format (resolves D66)

Status: decided.

Decision: The prompt UI reads and writes `prompt.json` directly. There is no
codegen back into builder code, ever. Saves go through a catalog write API
that validates against the PromptDocument JSON Schema and declared variables,
canonicalizes, writes the file, and records a prompt revision.

### D72. Prompt Revisions (new)

Status: decided.

Decision: Every prompt state is content-addressed. The canonical document is
hashed (`"pk1-" + sha256(canonicalBytes)`) and stored as a `prompt_revisions`
row with the document and rendered text. Agent sessions record the hash at
creation time — the system prompt is frozen at Pi session creation, so
revisions bind to sessions, not runs. Each agent directory also commits a
derived `prompt.rendered.md` snapshot, enforced by test, so PR diffs show the
rendered contract.

### D73. Sessions Are Containers (new, identity model)

Status: decided.

Decision: There is no separate app-session identity. An app session is a
container of `kind: "session"`. Containers gain `kind` and `key`; container
ids derive deterministically from `(kernelId, kind, key)`. The trace envelope
requires `containerId` and drops `appSessionId`. See
`docs/10-system-design/15-identity-model.md`.

### D74. Per-Kernel Local Database (new)

Status: decided.

Decision: Each kernel owns a local SQLite database
(`.agent-kernel/trace.db`, WAL). Postgres remains a supported dialect for
shared planes but stops being the default. Kernel registration rows shrink to
a local manifest; a future central observer federates over per-kernel read
APIs rather than a shared database.

### D75. Extension-Primary Event Emission (new)

Status: decided.

Decision: Kernel-spawned sessions emit trace events in-process through a Pi
extension that has `RunContext` identity at emit time. Marker-based session
binding is retired. Pi JSONL remains the durable raw transcript; the tailer is
demoted to an `agent-kernel backfill` command for crash recovery and imports.

### D76. Manifest As Data (extends D8, D9)

Status: decided.

Decision: The agent manifest becomes `agent.json`, validated by a shared JSON
Schema. `context.ts` and `tools.ts` attach by filename convention. The agent
bundle is two data files the UI can fully edit plus two code sidecars.
`defineAgent` survives as the typed generator/validator for these files. The
runtime's internal `ParsedAgent.frontmatter` shape is renamed to
`ParsedAgent.config`; the `AgentFrontmatter` type is retired.
