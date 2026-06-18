# Simple Research Kernel Brief

This example application demonstrates the Agent Kernel as a runnable Simple Research Kernel.

The intended flow is:

1. A user submits a research request.
2. A coordinator reads the brief and working memory.
3. The coordinator dispatches focused scout subagents.
4. The coordinator waits for all scouts to return their reports.
5. The coordinator reads the scout reports and spawns follow-up scouts if coverage is incomplete.
6. The coordinator queues a report writer.
7. The report writer reads accumulated memory and returns a final report.

The demo is deliberately local and deterministic so it can run without external model credentials while still showing the kernel contracts: agent registry, context loading, subagent orchestration, event protocol, read API, and trace viewer.
