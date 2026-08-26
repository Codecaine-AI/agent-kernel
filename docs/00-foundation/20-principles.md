---
covers: "Foundational principles for preserving portability across runtime, protocol, storage, transcript recovery, read API, and viewer packages."
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

The protocol, database schema, transcript recovery, read API, and viewer packages are one platform surface. A kernel feature is not complete until its behavior can be stored, read, and viewed.

For token-hungry systems this is how spend stays accountable: if work cannot be attributed and inspected, it cannot be budgeted or improved. Observability is the feedback loop that lets a vertical route tokens effectively instead of burning them blindly.

## Any Model, Per Agent

Agents are declarative definitions, not hardcoded to a single model. A vertical must be free to route each agent to the model that earns its tokens — cheap models for fan-out and routine work, strong models for the hard steps.

The kernel keeps model choice on the agent definition and the spawn path, not baked into runtime assumptions, so a harness can mix providers and capability tiers within a single pipeline and measure each one's cost-effectiveness through the same trace surface.

## Relationships Are Emitted, Not Reconstructed

When a parent relationship is known at emit time, the event or row carries an explicit ID. Containers, phases, parent runs, and parent tool calls are linkage fields, not timestamp guesses.

Timestamps order events. They do not prove parentage.

## App Identity Is Generic

Host correlation happens through containers, not through any app's own session identity. There is no separate app-session concept in the kernel, and nothing in the kernel may imply one host app's database structure. The container mechanics — kinds, keys, derived ids, linkage invariants — are design contracts in the [identity model](../10-system-design/15-identity-model.md).

## Adapters Are Allowed To Be Specific

The kernel stays neutral; adapters are where specificity belongs. Everything a host app wires into the kernel — identity mapping, custom loaders, injected services, mounted APIs, viewer plugins — lives in an explicit adapter layer small enough to audit. The contract is the [app adapter model](../10-system-design/50-app-adapter-model.md); the concrete wiring is recorded in [implementation](../20-implementation/70-app-adapters.md).

## Packages Are The Unit Of Portability

The package boundary matters more than the repository boundary. A package under `packages/*` must be portable before it is useful to split into a separate repo. The current package map and its dependency rules live in the [implementation overview](../20-implementation/00-overview.md).
