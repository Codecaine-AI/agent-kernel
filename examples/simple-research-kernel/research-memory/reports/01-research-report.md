# Research Report

## Request
Read all scout reports and write the final report for: Research how the Simple Research Kernel should present agents, context loading, subagents, and working memory.

## Executive Summary
The Simple Research Kernel is a complete local research-agent demo. A coordinator receives the request, loads context, dispatches focused source scouts, waits for their reports, reviews those reports for gaps, optionally spawns a follow-up scout, queues a report writer, and returns a markdown report. That gives the Agent Kernel a base demo that is simple to understand but still representative of real multi-agent harness work.

## What The Harness Demonstrates
- Agent definitions live in `examples/simple-research-kernel/src/agent-catalog/*/agent.md` instead of being hardcoded into the store.
- Context sidecars live beside each prompt and declare the loader inputs each role needs.
- The host app registers a `working-memory` loader while the kernel remains generic.
- The coordinator uses `AgentManager` to spawn source scouts and queue a report writer as nested subagents.
- Intermediate scout reports and final reports are normal files under `research-memory/`.
- The read API and viewer can inspect prompt resolution, context loading, tool calls, subagent links, and assistant outputs in one trace.

## Agent Roles
- `research-coordinator`: owns the top-level request, decomposes the work, dispatches subagents, reads their reports, decides whether follow-up is needed, queues the writer, and returns the synthesis report.
- `source-scout`: investigates one narrow angle and writes a durable markdown research report.
- `report-writer`: reads scout reports, working memory, and source context, then writes the final report.

## Working Memory
- `research-memory/brief.md` explains the intended harness workflow.
- `research-memory/sources/` contains durable source notes used by all roles.
- `research-memory/scout-reports/` receives generated source-scout reports.
- `research-memory/reports/` receives generated synthesis reports.

## Evidence From This Run
Scout reports considered:
- research-memory/scout-reports/02-scout-the-kernel-architecture-and-context-loading-setu.md
- research-memory/scout-reports/03-scout-the-working-memory-and-demo-product-angle-for-re.md

Additional seed sources:
- research-memory/sources/kernel-architecture.md
- research-memory/sources/demo-positioning.md

## Why This Is The Base Demo
Research is a strong base demo because the user value is familiar: send off a request and receive a report. It also naturally exercises the kernel behaviors that matter most: agent definitions, context loading, fan-out, waiting for subagents, reading subagent reports, optional follow-up work, artifact persistence, observability, and a final deliverable.

## Limitations
- This example is local and deterministic so it runs without model credentials or Postgres.
- The tool calls are simulated by the demo store, but the trace shape mirrors the runtime contracts a live app would use.
- A production harness should add durable storage, real model execution, richer domain tools, and app-specific viewer panels.

## Recommended Next Steps
- Replace the deterministic agent bodies with live model calls through the full spawn pipeline.
- Continue treating `@agent-kernel/db` as the observability substrate for registered kernels.
- Add real research tools, such as repository readers, web search, or document ingestion.
- Add a custom viewer panel for working-memory artifacts.
