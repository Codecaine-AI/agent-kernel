# Prompt Skills Design Session

This document records the design decisions from the prompt-skills grilling
session on 2026-06-27. It is a reference artifact only. The skills do not depend
on this file and do not need to reference it.

## Context

`@codecaine-ai/prompt-kit` now lives as a separate package at
`packages/prompt-kit`. It owns generic prompt authoring primitives:

- canonical prompt AST
- TypeScript builders
- XML-tagged Markdown rendering
- transforms
- validation
- lightweight UI preview/editor models

The Agent Kernel owns runtime-facing agent behavior:

- typed agent registry loading
- `agent.ts` manifests
- variables and runtime invocation contracts
- dynamic context loading and assembly
- private and shared tool binding
- traces, viewer integration, Pi integration, and subagent orchestration

The existing prompt skills were created for Markdown-first prompt authoring. The
new direction is PromptKit-first authoring, with kernel agent authoring layered
on top.

## Primary Decisions

### D1. Use a parent/sub-skill model

Create two new top-level skills:

```text
skills/
  prompt-kit-authoring/
  kernel-agent-authoring/
```

`kernel-agent-authoring` is the parent skill for creating and editing Agent
Kernel agents. It teaches the typed bundle:

```text
agent-catalog/<agent-name>/
  agent.ts
  prompt.ts
  context.ts
  tools.ts
```

`prompt-kit-authoring` is the reusable prompt-authoring skill for `prompt.ts`
and other portable PromptKit artifacts. It can be used standalone, but the main
expected workflow is that kernel agent authoring delegates `prompt.ts` work to
PromptKit authoring.

### D2. PromptKit authoring replaces Markdown-first prompt authoring

The updated authoring model produces PromptKit artifacts, normally a complete
`prompt.ts` exporting a `PromptDocument`.

The old Markdown-first system prompt workflow is retired as the default. Rendered
XML-tagged Markdown remains important, but it is output from the renderer rather
than the hand-authored source of truth.

### D3. Use two PromptKit archetypes

The old prompt-type router is retired:

```text
old task       -> singleOutputPrompt
old workflow   -> workflowPrompt
old multi-turn -> workflowPrompt plus kernel runtime concerns
```

The two main PromptKit archetypes are:

- `singleOutputPrompt`: one bounded input produces one defined output.
- `workflowPrompt`: the prompt has an explicit process, even if the process is
  short or only one phase.

`agentPrompt` is optional convenience sugar over `workflowPrompt`. It is not a
third core type and should not be confused with a kernel agent definition.

### D4. Retire `.prompt-runs` from the general skill

The old `.prompt-runs/` workflow is retired from general prompt authoring.

The idea may return inside a future prompt-building kernel/app as that kernel's
session working memory. It should not be mandatory for ordinary agents using the
PromptKit skill.

### D5. Preserve techniques, thinking frameworks, anti-patterns, and QA

The useful parts of the old prompt reference skills should be carried forward as
available context:

- context engineering
- techniques library
- thinking frameworks
- anti-patterns
- evaluation and QA protocol
- meta-prompting concepts

These are not mandatory steps. The skill should make them available when useful,
especially when a known failure mode calls for a technique or framework.

### D6. Keep rendered-output standards

PromptKit owns rendering mechanics such as indentation, escaping, list markers,
tag rendering, and variable placeholders.

The skill should still teach rendered-output preferences:

- semantic XML tags
- readable section order
- nested structure when hierarchy matters
- variables with `variable()`, not raw string placeholders
- `usesContext()` for prompt-side runtime context policy
- rendered prompt review as part of QA

### D7. Default workflow skeleton

For `workflowPrompt`, use this trim-friendly default section skeleton:

```text
purpose
rules
key_knowledge / background when needed
workflow
context_policy through usesContext when runtime context exists
tool_policy when tools exist
output_format
success_criteria
reminders
```

Every section still has to earn its token cost.

### D8. Kernel integration depth

The PromptKit skill teaches the boundary:

- `prompt.ts` owns stable prompt behavior as a `PromptDocument`.
- `agent.ts` owns runtime manifest, variables, model/settings, tool access, and
  bindings.
- `context.ts` owns dynamic context loading and rendering.
- `tools.ts` owns private tool definitions/registration.

Deep registry behavior, Pi mechanics, traces, viewer wiring, and app adapter
implementation belong in kernel docs or the kernel agent authoring skill.

### D9. Defer the prompt-building kernel/app

Do not build a prompt-creation example kernel/app yet.

Record it as future work:

```text
future prompt-building kernel/app
  interactive prompt interviews
  prompt session working memory
  iterative PromptKit editing
  QA and critique passes
  rendered preview
  final prompt.ts or PromptDocument export
```

This future app is expected to formalize the old prompt-run/session idea inside
a proper kernel process.

## New Skill Layout

Target layout:

```text
skills/
  README.md

  prompt-kit-authoring/
    SKILL.md
    00-routing.md
    05-authoring-model.md
    08-core-methodology.md
    10-prompt-kit/
    20-techniques/
    30-qa/
    workflows/

  kernel-agent-authoring/
    SKILL.md
    00-routing.md
    10-agent-bundle/
    20-prompt-ts/
    30-context-ts/
    40-tools-ts/
    50-validation-and-viewer/
    examples/
```

## Source Material

PromptKit docs:

- `packages/prompt-kit/README.md`
- `packages/prompt-kit/docs/00-overview.md`
- `packages/prompt-kit/docs/10-system-design/*`
- `packages/prompt-kit/docs/20-implementation/10-src/*`

Kernel prompt model:

- `docs/10-system-design/60-prompt-system-model.md`
- `docs/20-implementation/20-kernel/20-agent-registry.md`

Old/new prompt skill references:

- `prompt-skills-reference/prompting/30-generation/*`
- `prompt-skills-reference/prompt-writing-old/system_prompt/*`

Canonical current examples:

- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/*`
- `examples/simple-research-kernel/src/agent-catalog/source-scout/*`
- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/*`

## Retired Concepts

The new skills should not carry these forward as defaults:

- mandatory `.prompt-runs/`
- Markdown system prompts as the authored source of truth
- `agent.md` as preferred authored artifact
- old `task / workflow / multi-turn` router as three peer prompt types
- input formatter workflow as the default pairing for every prompt

## Implementation Output

The first implementation pass should create:

```text
PROMPT SKILLS DESIGN SESSION.md
skills/README.md
skills/prompt-kit-authoring/...
skills/kernel-agent-authoring/...
```

The skills should be usable as reference-style skills and should not reference
this session document.
