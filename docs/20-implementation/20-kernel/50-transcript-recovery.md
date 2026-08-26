---
covers: "Structural decisions in transcript recovery: co-location with the emitter for id parity, and the recovery-tool (not daemon) posture."
concepts: [transcript-recovery, backfill, emitter-parity, deterministic-ids]
code-ref: packages/kernel/src/transcript-recovery/
depends-on: [00-overview.md, ../../10-system-design/20-observability-model.md]
---

# Transcript Recovery

`packages/kernel/src/transcript-recovery/` re-derives trace rows from Pi JSONL transcripts: `runBackfill`, the `EventMapper`, and the `agent-kernel-backfill` CLI bin. The behavior — what backfill is for, session-binding stamping, idempotent inserts against live emission — is design: [20-observability-model.md](../../10-system-design/20-observability-model.md) § Event Sources.

---

## Decisions

### Recovery lives inside the kernel package, beside the emitter

**Decision.** The backfill mapper is a kernel module, co-located with the in-process emitter it must stay in parity with; both derive ids and usage through `@agent-kernel/protocol`, and the emitter's id-parity test imports `EventMapper` directly from `../transcript-recovery` as an intra-package drift guard.

**Why.** The two emission paths must produce identical event ids or idempotent inserts stop deduplicating. A separate recovery package was rejected: it turns the parity requirement into a cross-repo contract that can drift between releases; co-location makes divergence a failing test in the same build.

**Applies to.** `packages/kernel/src/transcript-recovery/` and `packages/kernel/src/emitter/` — any change to either path's id derivation or event mapping must keep the parity test passing, and new emission paths join the same package under the same guard.

### A recovery tool, not a daemon

**Decision.** Recovery is an invoked operation — `runBackfill(options)` over a JSONL directory or file list (also accepting an already-open db handle for embedding), plus the CLI. The old daemon posture — directory watcher loop, cursor snapshots, health port, registration-row discovery — is gone.

**Why.** The primary trace path is the in-process emitter; a watcher daemon duplicated it badly and needed its own lifecycle. A tool that reads the durable JSONL on demand covers disaster rebuild and import without a second always-on writer.

**Applies to.** `packages/kernel/src/transcript-recovery/backfill.ts`, `backfill-cli.ts` — future recovery features extend the invoked-tool surface rather than reintroducing a watcher.
