---
covers: "Foundational principles for preserving portability across runtime, protocol, storage, tailer, read API, and viewer packages."
concepts: [principles, portability, explicit-linkage, adapters, observability, workspace-packages, model-routing, token-cost]
depends-on: [30-boundaries.md, ../10-system-design/20-observability-model.md]
---

# Principles

These are the rules that keep the kernel a sound foundation for token-hungry vertical harnesses as it grows out of Spectre. The kernel is **opinionated about engineering discipline** — observability, control, and model routing — and **neutral about your vertical's workflow semantics**.

---

## Runtime Is Generic, Workflow Is App-Side

The kernel may know how to spawn an agent, resolve context, emit lifecycle events, store trace rows, and render a run tree. It must not know what a Spectre spec, plan, checkpoint, build task, or docs phase means.

Apps may attach those meanings through opaque labels, metadata, registered loaders, registered tools, and viewer plugins.

## Observability Is A Core Contract

The protocol, database schema, tailer, read API, and viewer packages are one platform surface. A kernel feature is not complete until its behavior can be stored, read, and viewed.

For token-hungry systems this is how spend stays accountable: if work cannot be attributed and inspected, it cannot be budgeted or improved. Observability is the feedback loop that lets a vertical route tokens effectively instead of burning them blindly.

## Any Model, Per Agent

Agents are declarative definitions, not hardcoded to a single model. A vertical must be free to route each agent to the model that earns its tokens — cheap models for fan-out and routine work, strong models for the hard steps.

The kernel keeps model choice on the agent definition and the spawn path, not baked into runtime assumptions, so a harness can mix providers and capability tiers within a single pipeline and measure each one's cost-effectiveness through the same trace surface.

## Relationships Are Emitted, Not Reconstructed

When a parent relationship is known at emit time, the event or row carries an explicit ID. Containers, phases, parent runs, and parent tool calls are linkage fields, not timestamp guesses.

Timestamps order events. They do not prove parentage.

## App Identity Is Generic

Host correlation happens through containers: an app maps its domain rows to container `kind` + `key` vocabulary, and the kernel derives stable ids from them. Containers can carry app labels, paths, and opaque metadata because every host needs to correlate kernel work with its own domain rows — but there is no separate app-session identity, and nothing may imply one host app's database structure.

## Adapters Are Allowed To Be Specific

The kernel should stay neutral. Adapters are where specificity belongs:

- Spectre creates app sessions and maps them to kernel containers.
- Spectre registers the `checkpoint-slice` loader.
- Spectre provides `SessionStateManager` to app tools through run context.
- Spectre mounts the kernel read API in its data backend.
- Spectre registers viewer panels for spec, plan, build, and docs.

## Packages Are The Unit Of Portability

The package boundary matters more than the repository boundary. A package under `packages/*` must be portable before it is useful to split into a separate repo.

The current packages are:

- `@agent-kernel/protocol`
- `@agent-kernel/db`
- `@agent-kernel/kernel`
- `@agent-kernel/tailer`
- `@codecaine-ai/prompt-kit`
- `@agent-kernel/viewer-core`
- `@agent-kernel/viewer-ui`
- `@agent-kernel/viewer-shell`
