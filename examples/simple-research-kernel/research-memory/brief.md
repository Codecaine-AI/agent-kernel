# Simple Research Kernel Brief

This example application demonstrates the Agent Kernel as a runnable Simple Research Kernel.

The intended flow is:

1. A user submits a research request.
2. The app creates one research session directory for the run and copies this seed brief/source material into that session's `research-memory/` folder.
3. A coordinator reads the brief and working memory from the active research session.
4. The coordinator dispatches focused scout subagents.
5. The coordinator waits for all scouts to return their reports.
6. The coordinator reads the scout reports and spawns follow-up scouts if coverage is incomplete.
7. The coordinator queues a report writer.
8. The report writer reads accumulated memory and returns a final report.

The demo is deliberately local in its source material, but the run itself uses a live model/tool loop. A valid run should show the coordinator reading session-scoped context, spawning source-scout subagents, waiting for their markdown reports under the run's `research-memory/scout-reports/`, reviewing those reports, queueing the report writer, and writing a final report under the run's `research-memory/reports/`. If credentials or runtime services are missing, the harness should fail honestly rather than fabricating a trace.
