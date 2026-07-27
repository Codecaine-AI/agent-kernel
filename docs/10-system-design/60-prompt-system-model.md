---
covers: "Design interview and emerging model for a prompt authoring system that produces kernel-ready agent definitions, dynamic context resolvers, and prompt skills, plus the agent state model (D81-D97) that owns what the model sees each request."
concepts: [prompt-system, prompt-harness, prompt-spec, agent-definition, context-resolver, skills, authoring-workflow, state-model, three-section-request, state-sidecar, window-policy]
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

Superseded by D81–D84 (state-shapes.html v4): the boundary is now drawn
rather than acknowledged as blurry. Reference material that should be visible
every request is section ② (rebuilt per request from a kernel-held set);
dynamic working state and the conversation are section ③, owned by a
`state.ts` sidecar's `render(state)`. `context.ts` no longer holds working
state, working memory, or conversation slices.

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
binding is retired. Pi JSONL remains the durable raw transcript; transcript
recovery is an `agent-kernel-backfill` command for crash recovery and imports.

### D76. Manifest As Data (extends D8, D9)

Status: decided.

Decision: The agent manifest becomes `agent.json`, validated by a shared JSON
Schema. `context.ts` and `tools.ts` attach by filename convention. The agent
bundle is two data files the UI can fully edit plus two code sidecars.
`defineAgent` survives as the typed generator/validator for these files. The
runtime's internal `ParsedAgent.frontmatter` shape is renamed to
`ParsedAgent.config`; the `AgentFrontmatter` type is retired.

### D77. First-Class Spawner Tools (new; retires `canSpawnSubagent`)

Status: decided.

Decision: Spawning is granted per tool, not per agent. A tool that dispatches
subagents is declared with `defineSpawnerTool({ ..., spawns: [agent names] })`
in the `tools.ts` sidecar; the kernel injects a scoped `dispatch` handle at
session build time that enforces the declared allowlist and auto-forwards
`parentToolUseId`, `trigger: "parent-tool"`, and run-context identity. The
manifest-level `canSpawnSubagent` boolean is removed from the schema, the
types, and the runtime.

Agent platforms default to "everything can spawn general subagents"; this
kernel should not. The boolean was a leftover general-permission model: it
said an agent may spawn, but not what, through which tool, or with what
identity plumbing. Spawner declarations are harvested at registry boot —
every non-`"*"` target must exist in the catalog or boot fails — and the
harvested map rides on the runtime config. A deliberately general spawner
remains possible via `spawns: ["*"]`, but it is a loud opt-in visible in the
declaration, the harvest, and the trace.

Spawner calls are distinguishable in traces: `tool_call_start` /
`tool_call_end` eventData gains optional `toolKind: "spawner"` + `spawns`
(additive optional fields on the existing payloads, TurnUsage-style — no new
event types, no envelope change), so viewers can render agent dispatch
differently from ordinary tools. Viewer rendering is a deliberate follow-up.

### D78. Agent XML Is the Sole Prompt Editing Surface (revises D46/D47 scope, retires the Sections mode)

Status: decided.

Decision: The prompt editor's only surface is the Agent XML flow — a
code-editor rendering of exactly what the agent receives, with block and
keyboard editing layered on as interaction, never as an alternative document
view. The Notion-style Sections mode, the read-only Raw view, and the
combined SYS+CTX view were removed from the agent viewer.

Rationale: the editor's job is to manipulate the real artifact. A friendlier
projection (Sections) and a separate fidelity view (Raw) both existed to
compensate for an editing surface that didn't look like the rendered prompt;
once the editor achieved line-for-line parity with the rendered output
(strict grid, shared highlighting, gutter numbering owned by a tested line
model), both became redundant. The combined/effective prompt remains
inspectable where it is a runtime fact: on `system_prompt_resolved` trace
events. Full surface/interaction contract:
`docs/20-implementation/60-viewer/20-prompt-editor-design.md`.

### D79. Manifest Fields Are Viewer-Editable Through the Catalog Write API (new)

Status: decided.

Decision: Operational manifest fields — currently `description` and `model` —
are editable from the agent viewer through a dev-gated
`PUT /kernel/catalog/agents/:name/manifest`, following the prompt-save
pattern: schema-validated merge, canonical `agent.json` rewrite, registry
hot-reload (`reloadAgentManifest`) so the next spawn uses the new values
without a restart, old registry entry and file preserved on failure. The
catalog detail exposes the kernel's configured model aliases as suggestions.

Boundary: this is field-level editing of operational configuration, not a
general manifest editor — variables, tools, spawner declarations, and
renames stay file-edited (and renames are rejected by hot-reload). Widening
the editable set is a future decision, not a default.

### D80. The Tailer Package Is Dissolved into Kernel Transcript Recovery (completes D75)

Status: decided.

Decision: `@agent-kernel/tailer` no longer exists. Its surviving capability —
re-deriving trace rows from Pi's durable JSONL transcripts — moves into the
kernel as `packages/kernel/src/transcript-recovery/`
(`@agent-kernel/kernel/transcript-recovery`, CLI bin
`agent-kernel-backfill`), with tailing-era names renamed to recovery terms.

Rationale: D75 made in-process emission primary and demoted the tailer to a
backfill tool, which removed every reason for it to be a separate package —
the daemon posture was deleted, the shared-plane ingestion story became
per-kernel SQLite, and its only consumers were the kernel's id-parity test
and one dev endpoint. Co-locating the recovery mapper with the live emitter
also turns the emitter/backfill id-parity guarantee into an intra-package
test, so the two mapping implementations cannot version-skew. The recovery
role remains load-bearing: disaster rebuild of a trace database, import of
sessions run outside the kernel, and schema re-derivation from transcripts.

---

## Amendments — 2026-07-27 State Model Interview

These decisions come from the state-model design interview on 2026-07-27 and
supersede earlier entries where noted. The design record they were captured
against is
[explainers/state-shapes.html](explainers/state-shapes.html); §11 of that
document is the decision table this section expands. Each entry below cites
the sections it comes from (numbering as of the 2026-07-27 revision that
added §6, the bundle tree). As-built implementation:
[docs/20-implementation/20-kernel/60-agent-state.md](../20-implementation/20-kernel/60-agent-state.md)
and
[docs/20-implementation/20-kernel/70-request-snapshots.md](../20-implementation/20-kernel/70-request-snapshots.md).

### D81. The State Is the Observation (new)

Status: decided.

Decision: Each turn, the agent is dropped into the current state and asked
for the next step — the state is the observation, the model is the policy,
as in a PPO setup. The consequence that orders everything after it: **the
messages are part of the state**. Conversation history is not a store that
sits beside the state; it is one component of it, alongside whatever domain
components the agent has. There is one state object per agent, and one
moving piece in every request: the render of that object.

Rationale: v1 optimizes for context control. Every request is deliberately
constructed and nothing accumulates, so there is no compaction step to
design and no ever-growing transcript to compress. Restart stays the honesty
test — a state that cannot restart the work is not the state — and the
interface falls out of getting the representation right.

Source: state-shapes.html §1, §11.

### D82. The Request Is Three Sections (revises D27)

Status: decided.

Decision: Every provider request the kernel builds has exactly three
sections, and the kernel builds all three:

- ① **system prompt** — the agent's instructions in XML tags; effectively
  fixed for the session (frozen at Pi session creation, per D72).
- ② **context message** — reference material that should be visible on every
  request: capabilities, skills, style guides, reference sheets. Rebuilt each
  request from a kernel-held set (id → content), never accumulated in the
  transcript.
- ③ **rendered state** — the working picture plus however much recent
  conversation the renderer chooses to emit. Re-rendered every request by
  `render(state)`.

D27 modeled dynamic material as one "runtime input packet" and accepted a
deliberately blurry boundary between context, conversation history, and the
current turn. That boundary is now drawn: reference material is ②,
everything that moves is ③, and the conversation lives inside ③ because it is
part of the state (D81).

Two mechanics make this honest. ② is rebuilt, not pinned: adding a skill
mid-run adds an entry, losing one removes it, and nothing stale can linger
because nothing is attached to history. ③ may contain real messages —
conceptually the recent conversation is state being rendered, but the
renderer emits it as genuine user/assistant/tool messages, because providers
require real structure for tool-call pairing and models reason better over
real turns. The in-flight turn is always real messages.

Bookkeeping for the ② set — entry ids, the skill add/remove API — is decided
at the kernel build stage.

Implementation note (2026-07-27, as built): the rebuilt-② mechanic is scoped
to sessions where the state extension is active. There, an agent's
`context.ts` result becomes the context-set entry `agent-context:<name>` and
is rendered into one `<context>` message per request. Pass-through agents
(D83) keep the legacy path: context is injected once as an `agent-context`
custom message and pinned in the transcript, guarded by agent name. That path
is current behavior, not the target — see
[docs/20-implementation/20-kernel/30-context-loaders.md](../20-implementation/20-kernel/30-context-loaders.md)
and
[10-spawn-pipeline.md](../20-implementation/20-kernel/10-spawn-pipeline.md).

Source: state-shapes.html §2, §11.

### D83. No Universal State Schema; the Base Agent Is a Normal Agent (new)

Status: decided.

Decision: The kernel defines no state schema. An agent with no `state.ts` is
a completely normal agent: its state is its messages, no state block, no XML
ceremony, nothing imposed. A rich agent extends the same object with its own
domain shape, which the kernel never looks inside.

"Normal agent" comes in two flavors, and the difference is opt-in
configuration (D85), never a kernel default:

- **Pass-through** — no `state.ts` and no window config. The kernel registers
  nothing and the session behaves byte-identically to a session run before
  the state layer existed: unbounded history, no window, no elision marker.
  Strict back-compat is the point.
- **Base module** — window config but no `state.ts`. The kernel supplies a
  bookkeeping-only state and the default renderer, which emits the
  conversation as a rolling window of real messages with one elision marker
  where history was cut.

This is the load-bearing piece of the model. The schema-free base case is
what lets one kernel serve a plain conversational agent and a board editor
with the same contract and no special cases — the difference is which
components the agent's state has, not which code path runs.

Inside a window, images past a newest-K cap degrade to one-line stubs before
whole turns drop. There is no compaction step anywhere, because nothing
accumulates to compact — and an agent that opts into no window is not
compacted either, it is simply left as it is today.

Implementation note (2026-07-27, as built): `stateExtensionEnabled` is the
gate — a `state.ts` sidecar or a `state.window` manifest block. Neither means
the extension is not registered at all, which is what makes the pass-through
guarantee mechanical rather than a promise. Contract:
[docs/20-implementation/20-kernel/60-agent-state.md](../20-implementation/20-kernel/60-agent-state.md).

Source: state-shapes.html §3, §11.

### D84. The `state.ts` Contract — seed / update / render (new; extends D76)

Status: decided.

Decision: An agent that wants more than the base behavior ships a `state.ts`
sidecar in the agent directory, attached by filename convention like
`context.ts` and `tools.ts`, exporting three functions:

```ts
seed(ctx: SpawnContext, prior?: S): S;
update(state: S, event: SessionEvent): S;
render(state: S, ctx: RenderContext): RenderOutput;
```

The kernel decides *when* these run; the agent decides *what* they mean. `S`
is the agent's own type and the kernel never inspects it. One requirement
holds over it: `S` must be JSON-serializable, because it snapshots to
`state.json` (D88).

`render` owns the entire request body after ① and ② — the state block and
whatever recent conversation it chooses to emit as real messages. There is
no kernel-side renderer competing with it for that region, and no kernel
opinion about what a state block looks like.

The exact `SessionEvent` shape `update` receives is deliberately left to the
kernel build stage.

Implementation note (2026-07-27, as built): `render` returns either a bare
`AgentMessage[]` — every message counts as conversation tail — or
`{ messages, stateMessageCount }`, where the leading `stateMessageCount`
messages are the state block(s) and the rest is the tail. That count is how
the renderer declares the split *within* section ③, which is what the
three-section builder turns into `state` and `tail` boundaries and the viewer
renders structurally (D90). The kernel still has no opinion about what a
state block contains — only about where the renderer says it ends.

Source: state-shapes.html §4, §11.

### D85. Window Policy Is Per-Agent Configuration (new)

Status: decided.

Decision: How much conversation renders is per-agent configuration, not a
kernel rule. The kernel ships sizing strategies — turn count, token budget,
more as they are needed — and each agent's config picks and tunes one.
Default sizes per strategy are decided at the kernel build stage.

One invariant is kernel-owned and not configurable: **cuts land only on turn
boundaries**. An assistant `toolCall` and its `toolResult` are never split,
because providers reject orphaned halves. Everything else about the window
is the agent's to choose.

Source: state-shapes.html §3, §11.

### D86. Update Per Event, Catch-Up in `context`, Render Per Request (new)

Status: decided.

Decision: `update` is fed one event at a time, in order, as the session
advances — user message, tool call, tool result, turn boundary — driven by
Pi's blocking hooks. `render` runs once per provider request, inside the
`context` hook. Before rendering, `context` applies any events `update` has
not yet seen (catch-up) and only then renders; when everything is current
this costs one comparison.

Rationale: measured on `@earendil-works/pi-*@0.82.1`, the message and turn
hooks block the loop in order, and `context` is the only hook that can
rewrite the outgoing message array — non-destructively, affecting exactly one
request and never feeding forward. Per-event update keeps the state current
without a batch step; the catch-up line is what makes a retry, or the first
request of a new prompt, unable to render stale state.
The hook measurements remain documented in
[explainers/context-fold-projection.html](explainers/context-fold-projection.html)
§4–§6.

Implementation note (2026-07-27, as built): there is no per-`tool_call` hook
in the wiring. User-message, tool-call, and tool-result events are *derived*
from the session message array and folded by pumps hung on `message_end`,
`tool_result`, `turn_end`, and `context`; only the turn boundary is
hook-derived, because the transcript cannot reconstruct one. Because every
pump folds from a single cursor to the array's end, catch-up is idempotent by
construction rather than by dedupe bookkeeping — the property the decision
was after. Same ordering, same guarantee, fewer hooks.

Source: state-shapes.html §4, §11.

### D87. Seeding Comes From SpawnContext; Prior State Only When Passed (new)

Status: decided.

Decision: `seed` receives the same `SpawnContext` the context loaders receive
today — session data, agent config, cwd — plus, optionally, a prior run's
final state passed in explicitly by the caller. The kernel never auto-loads a
previous state file.

Rationale: automatic rehydration would make a spawn's starting state a
function of whatever happened to be on disk, which is precisely the kind of
invisible input the trace cannot explain. Continuity is a caller decision and
should be visible as one.

Source: state-shapes.html §4, §11.

### D88. Persistence v1 Is a `state.json` Snapshot (new)

Status: decided.

Decision: v1 persists state as a snapshot only — `state.json`, written after
each update batch under `.agent-kernel/state/<container>/<agent>/`, through
the emission sink seam (D92). No action log and no artifact byte-store yet.

The snapshot is also what enforces the JSON-serializable requirement on `S`
from day one, and what makes state inspectable as an ordinary file while the
model is being piloted.

Source: state-shapes.html §8, §11; prompt-cache-tiers.html §9.

### D89. No Kernel-Shipped State Tools (new)

Status: decided.

Decision: The kernel ships no state-mutation tools. An agent that wants a
notes channel, a scratchpad, or an explicit memory write declares its own
tool in `tools.ts` and handles the resulting event in `update` like any other
event.

This is an explicit rejection of the kernel-provided `remember`-style tool
considered during the interview. Such a tool would put a second writer on
state the kernel is not allowed to look inside, and would add a capability to
every agent's tool surface that most agents do not want. `update` is already
the single writer; keeping it the only one is what makes state transitions
explainable from the event stream.

Source: state-shapes.html §4, §11.

### D90. Full Request Snapshots Stay and Gain Section Tags (new)

Status: decided.

Decision: Per-turn request snapshots keep capturing the full outgoing window
into content-addressed trace blobs. The builder additionally marks where ①,
②, and ③ begin, so the viewer can render the exact context window a turn ran
on as three sections — the turn renderer.

Demoting snapshots to a hash receipt — store the hash, drop the bytes — was
considered and rejected. The point of the pilot is being able to read the
window the model actually saw; a receipt only proves that two windows
differed, at exactly the moment the question is *how*.

Source: state-shapes.html §8, §11.

### D91. Resume Means Multi-Prompt Continuity, Not Crash Recovery (new)

Status: decided.

Decision: "Resume" in v1 means a long-running session taking message after
message: state lives in the extension across prompts and `update` keeps
folding it forward. This is inherent in the model rather than a feature.

Crash recovery — rebuilding a live agent from persisted state after process
death — is explicitly out of scope for v1. `state.json` (D88) is written for
inspection and transfer, not as a resume image.

Source: state-shapes.html §8, §11.

### D92. One Sink Shape Now, Remote Sink at the Sandbox Stage (extends D74, D75)

Status: decided.

Decision: Trace events, request snapshots, and state writes all emit through
the same *sink shape* — `submit()`/`flush()` behind a serialized promise
tail, the pattern the kernel already had in `TraceWriterSink`. In v1 the
binding is local: `trace.db` plus `state.json`. The sandbox stage adds the
remote binding — spool file → drain loop → POST — as a sink swap, with no
conditional paths in the emitter and the same durability semantics in both
topologies.

Two channels ride the seams: the state channel is acked and deduped on the
state version; the observability channel is droppable under backpressure. Ack
and backpressure specifics are decided at the sandbox stage.

Rationale: getting runs, traces, and state out of a sandbox is designed with
v1 and built at stage 5 (D97). Designing it later is what produces a fork
between local and sandbox emission; building it later against a seam that
already exists does not. Details:
[explainers/prompt-cache-tiers.html](explainers/prompt-cache-tiers.html) §9.

Implementation note (2026-07-27, as built): this is two structurally
identical seams, not one interface — `TraceWriterSink` (trace events, request
snapshots) and `StateSink` (state snapshots), each `submit()`/`flush()` with
a serialized tail, each swappable independently. That satisfies what the
decision was for: transfer-out is a binding change on both seams, with no
conditional paths in the emitter or the state extension. Whether the two
collapse into one interface is open, and is a sandbox-stage call — it only
matters once a single remote transport carries both channels.

Source: state-shapes.html §9, §11.

### D93. The Canvas Layout-Editor Is the v1 Pilot (new)

Status: decided.

Decision: The canvas layout-editor is the pilot agent for the state model.
The core code lives in the kernel; the pilot only supplies its own `state.ts`.

Section split: `capabilities`, `style_guide`, and the exemplar /
contact-sheet images stay in section ② as reference material. The
`board_state`, `editor_state`, and `user_requests` spawn loaders retire as
loaders and become state, seeded from the same `sessionData` they read today.

Section ③ policy: **full board every turn** (so it is never stale),
**close-ups on demand** through the `look` tool, **diff always visible**.
State tracks the work *around* the canvas document — scope, applied ops,
lints, views, the request queue — and never holds a copy of the document,
which stays authoritative where it lives and is re-derived into the board
block each request. Close-up policy and image caps are decided at the canvas
build stage.

Source: state-shapes.html §5, §11.

### D94. Retired: the Fold / Projection Vocabulary and the Three-Store Model (retires the model in `explainers/context-fold-projection.html`)

Status: decided.

Decision: The fold/projection vocabulary and the three-store framing — a
state document, the diffs not yet folded into it, and the message history,
compiled together per request — are retired. "Fold" is `update`; "project" is
`render`; the three stores collapse into one state object whose components
include the messages (D81).

`context-fold-projection.html` stays in the tree and stays authoritative for
one thing: the **measured Pi 0.82.1 hook behavior** in its §4–§6, which still
underpins the wiring in D86. Its model sections carry a superseded banner
pointing at `state-shapes.html`.

Rationale: three stores meant three places a fact could live and sync rules
between them. The unfolded-diff store existed only because folding was
assumed too expensive to run on the critical path; the 0.82.1 measurements
removed that assumption, and with it the store.

Source: state-shapes.html §1, §11.

### D95. Rejected: a Universal State Frame (new)

Status: decided.

Decision: A kernel-imposed universal state frame — every agent's state
carrying the same top-level fields, sketched during the interview as
focus / actions / decisions — was considered and rejected. The kernel defines
no fields.

Rationale: such a frame only fits agents whose work happens to decompose that
way. A board editor's state is a board; a plain agent's state is its messages.
A universal frame forces both into vocabulary that describes neither, and
makes the kernel responsible for the meaning of state it cannot interpret.
D83 is the positive form of this decision.

Source: state-shapes.html §3, §11.

### D96. Rejected: State as a Transcript-Derived Cache (new)

Status: decided.

Decision: Modeling state as a derived cache over an append-only transcript —
the transcript remaining the source of truth, state being a recomputable
compression of it — was considered and rejected. The state object is the
source of truth, and the messages are one of its components (D81).

Rationale: a derived cache has to answer what happens when it disagrees with
its source, and the answer is always "rebuild it", which brings replay,
invalidation, and versioning along behind it. It also inverts what the model
is for: a board's current geometry is not a compression of the conversation
that produced it, and domain state that no message contains would have no
home at all.

Source: state-shapes.html §1, §3, §11.

### D97. Build Order — Docs, Kernel, Viewer, Canvas, Sandbox (new)

Status: decided.

Decision: The state model ships in five stages, in this order:

1. **Docs** — the design record, iterated until the state representation is
   right. Sign-off gates everything after it.
2. **Kernel** — the seed/update/render contract, the three-section builder,
   window policies, snapshot section tags, state through the sink seam.
   Proves base agents behave like normal agents.
3. **Viewer** — the three-section turn view. Proves every window is visible
   while piloting.
4. **Canvas** — board v1 `state.ts`; the three picture loaders retire. Proves
   the rich case on a real agent.
5. **Sandbox** — spool/drain/remote sink and the acked state channel, built
   and verified working rather than only designed.

Source: state-shapes.html §10, §11.

### D98. The Bundle Is Four Sections, Mirroring the Request (extends D5, D76)

Status: decided.

Decision: An agent bundle is `agent.json` plus four sections — prompt,
context, tools, state — and each section has two legal shapes: a single file,
or a folder with an `index.ts` entry point.

```text
catalog/<agent>/
  agent.json                              the index: model, thinking, maxTurns, window
  prompt.json    | prompt/prompt.json     ① source of truth
  prompt.rendered.md | prompt/system.md   generated markdown render — never hand-edited
  context.ts     | context/index.ts       ② the inventory of standing context
  tools.ts       | tools/index.ts         the action surface
  state.ts       | state/index.ts         ③ how each turn is handled
```

The bundle mirrors the request (D82): read the tree top to bottom and you
read the request left to right. Everything that defines *one* agent is one
vertical slice narrowed by runtime role — rather than horizontal repo layers
where all loaders live together, all styles live together, and nothing is
attributable to the agent it serves.

The rules that make the tree load-bearing rather than cosmetic:

- **`prompt.json` is the source of truth; the markdown beside it is
  generated.** It is rendered through the same prompt-kit `renderXmlMarkdown`
  the registry uses to build the system prompt, so the file on disk is
  byte-for-byte the prompt body the model receives, under a generated-file
  header. It is committed for reading and diffing, never hand-edited, and
  never parsed.
- **Scale-down rule.** Every folder collapses back to a single file, and the
  file form stays permanently legal — `state.ts` alone is not a legacy shape.
  A base agent is `agent.json` plus a prompt; the *absence* of the other
  sections is the statement that it is a plain agent (D83).
- **File-first resolution.** Per section the file form is tried first, the
  folder form second. When both exist the file wins **silently** — that is
  what lets a migration leave a one-line re-export shim at the old path —
  and the losing path is recorded so `doctor --catalog` can report it. A
  prompt missing in *both* forms is a boot error naming both paths. Folder
  internals are unconstrained and invisible to discovery: `index.ts` is the
  only entry point, and `prompt/system.md` is never consulted.
- **Declarations live in bundles; loader implementations stay
  app-registered.** The vertical slice owns what *this* agent's context
  contains, not the machinery that loads it — the D25/D40 boundary is
  unchanged by the tree.
- **Sharing is the rule of two.** An asset lives inside one agent's bundle
  until a second agent needs it; then the *bytes* promote to
  `catalog/_shared/`, while each consumer still declares it in its own
  context section. Library *code* stays in `src/`. The test: does this feed a
  section of *this* agent's request, or is it machinery any agent could run?

Rationale: the four sections were already the runtime's real decomposition —
D82 named them in the request, D84 gave three of them a contract — but the
bundle still expressed them as four flat files, which caps an agent at
however much fits in one file per section. A rich agent's context inventory,
per-event update rules, and per-block renderers each want their own files;
without folders they either sprawl into one unreadable module or leak
sideways into shared repo layers where they stop being attributable to an
agent. Folders make the slice hold at any size, and the file-first rule means
nothing about the simple case changes.

Implementation note (2026-07-27, as built): resolution lives in
`agent-registry/registry/bundle-layout.ts`; `AgentDefinition` gained
`bundleLayout` (resolved form + shadowed path per section) and
`renderedPromptFile`. `agent-registry/prompt-snapshot.ts` and the
`agent-kernel-render-prompts` bin generate the markdown render (with a
`--check` mode for CI); `runCatalogDoctor` and `doctor-cli --catalog
[--strict]` audit layouts. Every bundle in both repos is folder-form: the
`state-three-section-e2e` spike agent and the three Simple Research Kernel
agents here, and the canvas layout-editor — the exemplar — in its own repo.
Implementation:
[docs/20-implementation/20-kernel/20-agent-registry.md](../20-implementation/20-kernel/20-agent-registry.md).

Source: state-shapes.html §6, §11.
