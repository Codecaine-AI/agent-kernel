# Research Report

## Request

Research the next step for turning the Simple Research Kernel into a richer agent experience. The answer should synthesize the brief, source notes, and the two scout reports, with emphasis on the recommended next step, evidence, kernel/app boundary, roadmap, local-source constraints, and what the harness demonstrated.

## Executive Summary

The recommended next step is to make the demo a visible “run story” experience backed by a thin, reusable kernel contract: a filesystem agent catalog, context sidecars, subagent orchestration events, durable working-memory artifacts, and a trace/read API that lets a user inspect how the final report was produced.

The Simple Research Kernel is already a complete base demo because it exercises the essential shape of an agent harness: a coordinator reads context, dispatches focused scout subagents, waits for their artifacts, reviews coverage, queues a report writer, and persists a final report. The richer experience should not start by adding complex domain intelligence. It should first make this existing lifecycle concrete, inspectable, and reusable while preserving a clean boundary: the kernel owns generic runtime mechanics; the app owns research semantics, local sources, loaders, reports, and viewer presentation.

## What The Harness Demonstrates

The harness demonstrates a small but representative multi-agent system:

- **Agent definitions live in a filesystem catalog.** The source notes describe filesystem-backed agent definitions using `agent.md` plus optional sidecars such as `context.ts`. This gives builders a concrete mental model: agents are not hidden runtime objects only; they are files that can be reviewed, versioned, and composed by the host app.

- **Context sidecars declare loaders and assemble model-facing context.** Context is not hard-coded into the kernel. Each agent can declare context needs, and loaders are resolved through a catalog. This makes context assembly explicit while keeping the agent prompt files portable.

- **App-specific loaders can be registered without polluting kernel packages.** The architecture notes draw a clear boundary: the kernel can provide generic context assembly and loader resolution, while the host application can register loaders for app-specific concepts such as local research memory, source notes, session mappings, or generated artifacts.

- **The coordinator can spawn subagents through `AgentManager`.** The brief’s valid run requires the coordinator to spawn focused `source-scout` subagents, wait for their markdown reports, review coverage, optionally queue more work, and then dispatch the report writer. This is the core agentic behavior: one agent delegates bounded work to other agents and synthesizes their outputs.

- **Working memory captures intermediate and final artifacts.** The harness writes scout outputs under `research-memory/scout-reports/` and final synthesis outputs under `research-memory/reports/`. This makes the run durable and auditable instead of ephemeral chat state.

- **The read API and viewer make the run inspectable.** The source notes say the trace viewer can show prompt resolution, context loading, tool calls, nested subagents, and final assistant output. Paired with the working-memory tree, this gives users two complementary inspection modes: event history for how the run happened, and files for what the run produced.

## Agent Roles

- **Coordinator**: Owns the top-level research workflow. It reads the brief and working memory, decides what coverage is needed, dispatches source-scout subagents, waits for reports, reviews accumulated evidence, and queues the report writer when ready.

- **Source scout**: Performs focused evidence gathering against the available local source notes and brief. Each scout writes a markdown report into `research-memory/scout-reports/`, with observations, evidence, recommendations, and residual questions.

- **Report writer**: Produces the final durable synthesis. It reads the brief, source notes, scout reports, and memory layout, then writes a polished markdown report into `research-memory/reports/`.

These roles are intentionally easy to explain. Research maps naturally to delegation: scouts gather focused findings; the coordinator manages coverage; the report writer synthesizes.

## Working Memory Layout

- **`research-memory/brief.md`**: The run brief and contract for the demo. It defines the intended flow: user request, coordinator context reading, scout dispatch, report review, optional follow-up, report-writer queueing, and final report generation. It also states that the demo uses local source material but a live model/tool loop.

- **`research-memory/sources/`**: Local source notes used as the research corpus. In this run, the relevant notes were `demo-positioning.md` and `kernel-architecture.md`. These are deliberately local; they replace web research for the base demo.

- **`research-memory/scout-reports/`**: Intermediate reports produced by source-scout subagents. These files make delegated work inspectable and give the coordinator/report writer durable inputs for synthesis.

- **`research-memory/reports/`**: Final reports generated by the report writer. This is the durable product of the run.

## Evidence From This Run

The final synthesis used the following local context and generated artifacts:

- **Brief**
  - `research-memory/brief.md`: Defines the Simple Research Kernel flow and the validity criteria for a run. It says a valid run should show context reading, source-scout spawning, waiting for markdown reports, report review, report-writer queueing, and final report writing. It also requires honest failure if credentials or runtime services are missing.

- **Source notes**
  - `research-memory/sources/demo-positioning.md`: Explains why research is a strong base demo: users understand asking a question, waiting for work, and receiving a report. It also frames subagents as focused scouts and says working memory plus a trace viewer make the run tangible.
  - `research-memory/sources/kernel-architecture.md`: Defines the kernel/app boundary. The kernel owns `createKernel`, run context, agent registry, context assembly, subagent management, protocol events, and trace reading. The host app owns product semantics: agent catalog, domain tools, app-specific loaders, session mapping, and generated artifacts.

- **Scout reports**
  - `research-memory/scout-reports/01-working-memory-run-ergonomics-trace-demo.md`: Recommends making the next product/demo step a run-story experience that pairs the artifact tree with a trace-viewer timeline. It emphasizes honest execution, working memory, and inspectable run progression.
  - `research-memory/scout-reports/02-kernel-package-boundary-and-richer-agent-step.md`: Recommends a thin reusable kernel package contract plus a demo app catalog implementation. It emphasizes typed catalog/manifest shape, filesystem agents, context sidecars, subagent orchestration primitives, and protocol/trace events.

Together, the evidence points to the same next step: do not hide the lifecycle. Make the existing multi-agent flow visible, durable, and cleanly separated between kernel infrastructure and app semantics.

## Why This Is A Good Base Demo

Research is a good base demo because it is simple to understand but exercises real agent-harness mechanics.

From a user’s perspective, the flow is familiar: ask a question, wait while work happens, receive a report. From a builder’s perspective, the same flow demonstrates the core primitives needed for richer systems: context loading, tool use, delegation, nested agents, artifact writing, trace inspection, and final synthesis.

The harness also avoids overfitting the kernel to one product. The kernel does not need to know what a “research brief” or “source scout” means. It only needs to know how to register and run agents, assemble context, manage subagents, emit protocol events, and expose trace data. The app supplies the research-specific roles, files, loaders, and report conventions.

That separation makes the demo useful as a base for other domains. A future support triage app, code review app, or data-analysis app could reuse the same kernel primitives while replacing the research memory, agent roles, and domain tools.

## Limitations

This demo uses **local working-memory sources**. The source material lives under `research-memory/sources/`, and the generated artifacts live under `research-memory/scout-reports/` and `research-memory/reports/`.

The run itself uses a **live model/tool loop**, but it should not be described as live web research. No loaded context shows a web search or external source connector. A production research app could add web/source connectors as app-owned tools, but the base harness should be honest about its current scope: local sources, live orchestration, durable artifacts, and inspectable traces.

The brief also establishes an important reliability constraint: if credentials or runtime services are missing, the harness should fail honestly rather than fabricating a trace.

## Recommended Next Steps

### 1. Build the run-story experience first

The strongest next step is to pair the working-memory tree with a trace-viewer timeline. The user should be able to see:

1. The coordinator read `research-memory/brief.md` and relevant memory.
2. Context loaders assemble model-facing context.
3. The coordinator spawn `source-scout` subagents.
4. Scouts write markdown reports to `research-memory/scout-reports/`.
5. The coordinator review scout outputs and decide whether coverage is sufficient.
6. The report writer read accumulated memory.
7. The final report appear in `research-memory/reports/`.

This turns the kernel from “a model returned text” into “an agent system performed visible, inspectable work.”

### 2. Formalize the kernel/app boundary as a small contract

Define or polish the reusable contract around:

- filesystem agent catalog entries,
- `agent.md` prompt definitions,
- optional `context.ts` sidecars,
- declared context loaders,
- app-registered loaders,
- subagent spawn/wait APIs,
- protocol events,
- trace reading.

Keep research concepts out of the kernel package. The app should continue to own `research-memory`, source notes, scout/report-writer roles, markdown conventions, and any future domain tools.

### 3. Strengthen run validation

Add validation that a completed run actually produced the required artifacts and lifecycle events:

- coordinator context read occurred,
- expected scout subagents were spawned,
- scout reports were written,
- report writer was queued,
- final report was persisted,
- failures are surfaced honestly.

This protects the demo from looking successful when the model/tool loop did not actually run.

### 4. Polish persistent storage and artifact discovery

Make generated artifacts easy to find and link from the viewer or CLI. The app should be able to map trace events to concrete files such as:

- `research-memory/brief.md`,
- `research-memory/sources/demo-positioning.md`,
- `research-memory/sources/kernel-architecture.md`,
- `research-memory/scout-reports/*.md`,
- `research-memory/reports/*.md`.

This is a small change with high demo value because it connects abstract agent events to durable outputs.

### 5. Add richer domain tools after the lifecycle is visible

Once the run-story experience is solid, add optional app-owned tools such as:

- web/source connectors,
- repository readers,
- document importers,
- citation/source extractors,
- custom evaluator or coverage-check tools.

These should be host-app extensions, not kernel responsibilities.

### 6. Add custom viewer panels

The viewer can become a richer teaching tool by showing panels for:

- agent catalog and active agent definition,
- loaded context chunks,
- subagent tree,
- tool calls,
- generated artifacts,
- final report.

The key is to visualize generic kernel events while letting the app label research-specific artifacts in a friendly way.

## Practical Implementation Roadmap

1. **Document the demo contract**: codify the expected run stages from `brief.md` as explicit acceptance criteria.
2. **Expose lifecycle events**: ensure context loading, subagent spawn/completion, tool calls, artifact writes, and final output are emitted as protocol/trace events.
3. **Connect events to files**: attach artifact paths where possible so the viewer can jump from an event to a markdown report.
4. **Stabilize catalog loading**: make filesystem agents with `agent.md` and optional `context.ts` sidecars easy to register and inspect.
5. **Register app loaders cleanly**: keep local research-memory loaders in the demo app, resolved through the catalog without adding research semantics to the kernel.
6. **Validate successful runs**: fail clearly if required credentials, runtime services, subagent outputs, or final artifacts are missing.
7. **Then expand sources/tools**: add web or external-source connectors only after the local demo’s orchestration and inspection story is reliable.

The durable next step is therefore not just “add more tools.” It is to make the existing agent lifecycle first-class, inspectable, and trustworthy. That will turn the Simple Research Kernel into a richer agent experience while preserving the clean kernel/app boundary that makes the demo reusable.
