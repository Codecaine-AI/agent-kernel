---
covers: Canonical typed Agent Kernel examples.
concepts: [examples, simple-research-kernel, typed-agent]
---

# Examples

Use the Simple Research Kernel agent catalog as the canonical current example.

## Agent Bundles

Coordinator:

- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/agent.ts`
- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/prompt.ts`
- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/context.ts`
- `examples/simple-research-kernel/src/agent-catalog/research-coordinator/tools.ts`

Source scout:

- `examples/simple-research-kernel/src/agent-catalog/source-scout/agent.ts`
- `examples/simple-research-kernel/src/agent-catalog/source-scout/prompt.ts`
- `examples/simple-research-kernel/src/agent-catalog/source-scout/context.ts`
- `examples/simple-research-kernel/src/agent-catalog/source-scout/tools.ts`

Report writer:

- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/agent.ts`
- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/prompt.ts`
- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/context.ts`
- `examples/simple-research-kernel/src/agent-catalog/synthesis-writer/tools.ts`

## What They Demonstrate

- `agent.ts` as typed manifest and composition point.
- `prompt.ts` as PromptKit source of truth.
- `context.ts` as dynamic context resolver.
- `tools.ts` as private tool sidecar.
- `workflowPrompt` for agent-like prompts.
- `variable()` for runtime values.
- `usesContext()` for model-facing context policy.
- tool policy in prompt text, tool execution in sidecars.
