# Skills

This directory contains reference-style skills for authoring PromptKit prompts
and Agent Kernel agents.

## Skills

### `prompt-kit-authoring`

Use this skill when creating, improving, reviewing, or explaining a PromptKit
prompt artifact. Its default deliverable is a complete `prompt.ts` or a
PromptKit builder snippet that produces a `PromptDocument`.

It covers:

- `singleOutputPrompt`
- `workflowPrompt`
- prompt builders and semantic sections
- variables through `variable()`
- runtime context policy through `usesContext()`
- rendered XML-tagged Markdown review
- technique and QA references

### `kernel-agent-authoring`

Use this skill when creating or editing an Agent Kernel typed agent bundle:

```text
agent-catalog/<agent-name>/
  agent.ts
  prompt.ts
  context.ts
  tools.ts
```

It delegates prompt design to `prompt-kit-authoring` and adds the kernel-specific
boundary: variables, model/settings, context loaders, private tools, subagent
permission, validation, traces, and viewer inspection.

## Relationship To Older Prompt References

The old prompt references under `prompt-skills-reference/` remain source
material for now. The new skills move the active direction to PromptKit-first
authoring and kernel agent bundles.

Carry forward:

- context engineering
- techniques
- thinking frameworks
- anti-patterns
- evaluation and QA

Retire as default behavior:

- mandatory `.prompt-runs/`
- Markdown-first authored system prompts
- the old `task / workflow / multi-turn` router

## Future Prompt-Building Kernel

A future prompt-building kernel/app should formalize interactive prompt creation:

- prompt session working memory
- prompt interviews
- iterative PromptKit edits
- QA and critique passes
- rendered preview
- final `prompt.ts` or `PromptDocument` export

That future kernel is the right home for the old prompt-run/session concept. It
is not required for ordinary use of these skills.
