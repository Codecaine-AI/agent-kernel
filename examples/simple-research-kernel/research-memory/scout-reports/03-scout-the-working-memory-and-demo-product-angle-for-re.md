# Working memory and demo product shape

Prompt: Scout the working-memory and demo-product angle for: Research how the Simple Research Kernel should present agents, context loading, subagents, and working memory.

## Scope
- Investigated how durable scout reports, final reports, and run ergonomics make the demo feel like a product workflow.
- Left final cross-scout synthesis to the report writer.

## Observations
- Agent definitions are loaded from `src/agent-catalog/*/agent.md`, which mirrors the host-owned catalog pattern used by larger harnesses.
- Each agent colocates a `context.ts` sidecar with its prompt, so context loading is visible and editable per role.
- The app registers a `working-memory` loader locally, preserving the boundary that kernel packages stay product-neutral.
- Subagents run through the kernel `AgentManager`; their Pi sessions carry parent IDs and parent tool-use IDs so the viewer can nest them under coordinator dispatch calls.
- Working memory makes the demo inspectable outside the trace because scout reports and final reports are normal markdown files on disk.

## Evidence
- Loaded 4 context inputs (6955 rendered bytes).
- Seed brief: `research-memory/brief.md`.
- Source notes: `research-memory/sources/kernel-architecture.md` and `research-memory/sources/demo-positioning.md`.
- Agent catalog: `examples/simple-research-kernel/src/agent-catalog`.
- Generated artifacts: `research-memory/scout-reports` and `research-memory/reports`.

## Recommendation
Use the Simple Research Kernel as the base demo because it is small enough to understand quickly while still exercising the contracts a real Agent Harness needs: agent definitions, context loading, subagents, working memory, report review, optional follow-up, trace reading, and final report delivery.

## Residual Questions
- The current runtime is deterministic; a production host should replace the simulated model/tool execution with real model calls and durable persistence.
