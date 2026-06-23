# Working Memory, Run Ergonomics, and Trace Viewer Demo Positioning

Prompt: Original request: “Research the next step for turning this simple kernel into a richer agent experience.” Narrow focus: inspect the local brief and source notes for working memory, run ergonomics, report expectations, why research is a good base demo, and how the trace viewer can make the experience tangible. Extract evidence from `research-memory/brief.md` and `research-memory/sources/demo-positioning.md`.

## Scope
- Investigated the local brief and demo-positioning source note for how the Simple Research Kernel should feel as a product/demo: working memory, expected run flow, report artifacts, run honesty, and trace-viewer storytelling.
- Focused on demo ergonomics and tangible user experience rather than implementation internals, model selection, web research, or UI code details.
- Left deeper kernel API design, deployment, and broader agent feature recommendations for other scouts.

## Observations
- The core demo loop is already agentic and explainable: user request → coordinator reads context → coordinator dispatches focused source-scout subagents → coordinator waits and reviews reports → possible follow-up scouts → report writer produces final report. This gives the richer experience a clear narrative without needing external data sources.
- Research is a strong base demo because the task shape is familiar to users: they ask a question, background work happens, and they receive a written report. The source notes explicitly frame subagents as “focused scouts,” which is easier to explain than abstract worker agents.
- Working memory is the most concrete bridge between invisible model work and user trust. The demo should emphasize that generated scout reports and final reports are inspectable on disk under `research-memory`, making intermediate agent state durable and auditable.
- Report expectations are explicit: scout subagents write markdown reports, the coordinator reads accumulated memory, and the report writer returns/writes a final report. A richer experience should make these artifacts visible and navigable rather than treating them as hidden implementation details.
- Kernel-owned behavior appears to be orchestration: resolving prompts, loading context, dispatching/waiting on nested subagents, handling tool calls, and preserving an honest execution trace. App-owned behavior is the research workflow itself: the brief, local source material, scout/report-writer roles, markdown report conventions, and `research-memory` layout.
- Run ergonomics should include honest failure behavior. The brief says that if credentials or runtime services are missing, the harness should fail honestly rather than fabricating a trace. This is important for demo credibility: a richer agent experience should not imply completed agent work when the kernel could not actually run.
- The trace viewer can make the whole experience tangible by showing the story behind the final report: prompt resolution, context loading, tool calls, nested subagents, and final assistant output. This complements working memory: disk artifacts show durable outputs; the trace shows how those outputs were produced.

## Evidence
- `research-memory/brief.md` defines the intended run flow: user submits a request; coordinator reads brief and working memory; coordinator dispatches source-scout subagents; waits for reports; reviews coverage; queues a report writer; report writer reads accumulated memory and returns a final report.
- `research-memory/brief.md` states the demo is local in source material but uses a live model/tool loop, so the demo should show real tool/model orchestration rather than static sample output.
- `research-memory/brief.md` requires a valid run to show coordinator context reads, source-scout spawning, markdown report generation, report review, report-writer queueing, and final report writing.
- `research-memory/brief.md` says missing credentials or runtime services should cause honest failure, not fabricated traces.
- `research-memory/sources/demo-positioning.md` says research is a useful base demo because input/output are familiar: ask a question, wait for work, receive a report.
- `research-memory/sources/demo-positioning.md` says subagents are easy to explain as focused scouts gathering reports for final synthesis.
- `research-memory/sources/demo-positioning.md` says working memory makes the run tangible because users can inspect generated scout reports and final reports on disk.
- `research-memory/sources/demo-positioning.md` says the trace viewer can show prompt resolution, context loading, tool calls, nested subagents, and final assistant output.

## Recommendation
- Make the next product/demo step a “run story” experience that pairs the `research-memory` artifact tree with a trace-viewer timeline. After a user submits a research request, the demo should visibly progress through coordinator context loading, scout dispatch, scout markdown report creation, synthesis, and final report output. The UI/CLI should link trace events to concrete files such as `research-memory/brief.md`, `research-memory/sources/*`, `research-memory/scout-reports/*`, and the final report location.
- This matters because it turns the simple kernel from a black-box model invocation into a comprehensible agent system: users can see both what happened over time and what durable artifacts were produced. It also reinforces the research-demo advantage: the final answer is familiar, while the trace and working memory reveal the richer multi-agent process behind it.

## Residual Questions
- The loaded context does not specify the exact final report path/name or current trace viewer interface, so the final synthesis should avoid promising specific UI affordances beyond the documented trace categories and `research-memory` artifacts.
- The context describes expected behavior but not current implementation gaps, so recommendations should be framed as product/demo next steps rather than confirmed missing features.
