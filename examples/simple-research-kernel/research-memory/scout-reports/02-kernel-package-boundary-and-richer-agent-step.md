# Kernel Package Boundary and Richer Agent Step

Prompt: Original request: “Research the next step for turning this simple kernel into a richer agent experience.” Narrow focus: inspect the local brief and source notes for kernel package concepts, agent catalog shape, context sidecars, subagent orchestration, protocol events, trace reading/viewer primitives, and the kernel/app boundary. Extract evidence from `research-memory/brief.md` and `research-memory/sources/kernel-architecture.md`.

## Scope
- Investigated the local research brief and kernel architecture source notes for the intended Simple Research Kernel flow and the division of responsibility between reusable kernel package code and application-owned semantics.
- Focused on kernel package concepts: agent catalog shape, `agent.md` plus sidecar context files, subagent orchestration, protocol events, trace reading/viewer primitives, and the kernel/app boundary.
- Intentionally left implementation details, live model behavior, UI design, and external package comparisons for other scouts or the final writer.

## Observations
- The richer agent experience is framed as a runnable local research workflow, not just a static prompt runner. The valid demo flow includes user request intake, coordinator context reading, scout spawning, waiting for reports, coverage review, optional follow-up scouts, report-writer queuing, and final report writing.
- Kernel-owned behavior should remain generic runtime infrastructure. The architecture notes explicitly assign `createKernel`, run context, agent registry, context assembly, subagent management, protocol events, and trace reading to the kernel.
- App-owned behavior should remain product/domain specific. The host application owns the agent catalog, domain tools, app-specific loaders, session mapping, and generated artifacts.
- The agent catalog likely needs to describe filesystem-backed agents while allowing app semantics to stay outside the kernel. The notes say filesystem agent definitions use `agent.md` plus optional sidecars such as `context.ts`.
- Context sidecars are an important bridge between portable agent definitions and app-specific data. Context loaders are declared by each agent and resolved through a catalog that combines portable kernel loaders with app-specific loaders.
- Subagent orchestration is central to the demo: the coordinator should spawn `source-scout` subagents, wait for markdown reports in `research-memory/scout-reports`, then queue the report writer. This argues for first-class kernel APIs/events around spawning, completion, and artifact discovery rather than ad hoc app scripting.
- Protocol events and trace reading are kernel responsibilities, which means a richer agent experience should expose enough run lifecycle events to support trace inspection or a viewer without embedding product-specific concepts into the kernel.
- The app/kernel boundary is clear: the kernel should know how to register agents, assemble context, run subagents, emit protocol events, and read traces; the app should know what a “research brief,” “source-scout report,” and “final report” mean.

## Evidence
- `research-memory/brief.md` defines the intended flow: user submits a research request; coordinator reads brief and working memory; coordinator dispatches focused scout subagents; waits for their reports; reviews coverage; queues a report writer; final report is produced.
- `research-memory/brief.md` says a valid run should show context reading, spawning `source-scout` subagents, waiting for markdown reports, reviewing reports, queueing the report writer, and writing a final report.
- `research-memory/brief.md` requires honest failure if credentials or runtime services are missing, rather than fabricated traces. This supports trace/protocol transparency.
- `research-memory/sources/kernel-architecture.md` states the kernel owns `createKernel`, run context, agent registry, context assembly, subagent management, protocol events, and trace reading.
- `research-memory/sources/kernel-architecture.md` states the host application owns product semantics: agent catalog, domain tools, app-specific loaders, session mapping, and generated artifacts.
- `research-memory/sources/kernel-architecture.md` says filesystem agent definitions use `agent.md` plus optional sidecars such as `context.ts`.
- `research-memory/sources/kernel-architecture.md` says context loaders are declared by each agent and resolved through a catalog combining portable kernel loaders with app-specific loaders.
- Concrete harness pieces named in context include `research-memory/brief.md`, `research-memory/sources/kernel-architecture.md`, `research-memory/scout-reports`, `agent.md`, `context.ts`, `createKernel`, `source-scout`, and the report-writer stage.

## Recommendation
- Make the next architecture step a thin reusable kernel package contract plus a demo app catalog implementation: define a typed agent catalog/manifest shape that maps filesystem agents (`agent.md` and optional `context.ts`) to kernel runtime registration, declares context loaders, exposes subagent orchestration primitives, and emits protocol/trace events for every lifecycle step.
- This matters for a complete demo because the desired experience depends on visible multi-agent progression: coordinator reads context, spawns scouts, waits, inspects generated markdown artifacts, optionally follows up, then queues report writing. If these steps are represented as kernel events and trace-readable primitives, the demo can support a richer viewer/debugger while preserving the boundary that research semantics live in the app.

## Residual Questions
- The exact event schema for protocol events is not specified in the loaded context.
- The exact agent catalog file/path layout is not specified beyond `agent.md` plus optional `context.ts` sidecars.
- The trace viewer primitives are named only generally as “trace reading”; there is no loaded detail on UI/API shape.
