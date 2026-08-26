---
covers: "Implementation area page for @agent-kernel/protocol: role, source pointer, governing design pages, and structural decisions about what lives in the contract package."
type: overview
concepts: [protocol, contract-package, deterministic-ids, factory-convention, kernel-messages]
code-ref: packages/protocol/src/
depends-on: [../10-system-design/30-event-protocol.md]
---

# Protocol Package

`@agent-kernel/protocol` is the shared contract package: the `TraceEvent` envelope, event catalog and payload types, factories, deterministic ids, usage extraction, and kernel-authored message markers. Runtime emitters, DB actions, transcript-recovery mapping, the read API, viewer DTOs, and apps all type against it.

Source: `packages/protocol/src/` — envelope, types, factories, ids, usage, kernel-messages, sha256.

Governed by: [30-event-protocol.md](../10-system-design/30-event-protocol.md) (the contract itself — envelope, families, levels, open strings) and [20-observability-model.md](../10-system-design/20-observability-model.md) (what the events record).

---

## Decisions

### Event-id derivation is a protocol export, not emitter-local

**Decision.** Deterministic event ids (`piEntryEventId`, `liveFallbackEventId`) live in this package, and every emission path — the kernel's in-process emitter, the transcript-recovery mapper, and any future path — derives ids through them.

**Why.** Idempotent inserts only dedupe if all paths derive identical ids from the same inputs; per-path id generation (or random ids) was rejected because it makes live emission and backfill double-write the same session.

**Applies to.** `packages/protocol/src/ids.ts` and every current or future event producer.

### Factories take identity first, as one `ids` parameter

**Decision.** Every event factory follows one signature convention: a `TraceEventIds` object first (`containerId` required; `runId`/`userId`/`agentId`/`piSessionUuid` optional), then the event's semantic arguments, then an optional `opts` object for span linkage and extras. Run lifecycle factories require `runId` on `ids`.

**Why.** Identity threaded as loose positional arguments is how envelopes get mislabeled; one required parameter shape makes a missing `containerId` a type error. Applies-to is the point: new factories must keep the shape.

**Applies to.** `packages/protocol/src/factories.ts` and every factory added to it.

### Wire-visible constants live here, not in the kernel

**Decision.** The kernel-authored message markers (`kernel:context`, `kernel:state`) and `isKernelAuthoredMessage()` are protocol exports, even though only the kernel's state layer writes them.

**Why.** The marker survives into request snapshots and is read back by the viewer (D99) — it is part of the wire contract, and putting it in the kernel package would force viewer code to depend on the runtime. The rejected alternative was a kernel-local constant mirrored by hand in viewer code.

**Applies to.** `packages/protocol/src/kernel-messages.ts`, and any future marker or constant that both a writer and a reader must agree on.
