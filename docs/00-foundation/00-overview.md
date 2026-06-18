---
covers: "Foundation overview for the Pi Agent Kernel: purpose, principles, and boundaries for the portable runtime and observability platform."
type: overview
concepts: [agent-kernel, foundation, runtime, observability, portability, app-adapters, vertical-harness, token-cost]
---

# Pi Agent Kernel Foundation

The Pi Agent Kernel is an opinionated foundation for building **vertical-specific agent harnesses** on the Pi agent SDK. It runs agents, captures exactly what happened, and provides the viewer primitives needed to inspect agent work — without inheriting any one application's workflow model.

It is built for **token-hungry, multi-agent systems**: many parallel workers, long pipelines, deep subagent trees. In that regime, cost is the dominant engineering risk, and understanding where tokens go and how effective they are is the difference between a sustainable product and a quietly expensive one. Observability and control are not bolted on — they are the point.

---

## Child Nodes

### [10-purpose.md](10-purpose.md)
Why the kernel exists and what problem it solves.

### [20-principles.md](20-principles.md)
The rules that keep the kernel portable while still useful as a real runtime.

### [30-boundaries.md](30-boundaries.md)
What belongs in the kernel, what belongs in host applications, and where adapter code sits.

## Source Material

These docs promote and generalize kernel material that originally lived inside Spectre's documentation. The source docs included Spectre-specific paths and names, so the content here is rewritten around portable kernel concepts: app sessions, containers, runs, trace events, tailer ingestion, read APIs, and viewer packages.
