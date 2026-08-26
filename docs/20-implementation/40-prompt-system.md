---
covers: "Structural decisions for the prompt-system code: the prompt-kit repo split, bundle layout resolution, manifest schema ownership, the state module, kernel-message constants, and transcript recovery placement."
concepts: [prompt-system, prompt-kit, bundle-layout, agent-manifest, state-extension, kernel-messages, transcript-recovery]
code-ref: packages/kernel/src/agent-definition/, packages/kernel/src/agent-registry/, packages/kernel/src/state/, packages/kernel/src/transcript-recovery/
depends-on: [../10-system-design/60-prompt-system-model.md]
---

# Prompt System

The prompt system's code in this repo: manifest and sidecar contracts in
`packages/kernel/src/agent-definition/`, bundle discovery and prompt
snapshots in `packages/kernel/src/agent-registry/`, the state extension in
`packages/kernel/src/state/`, and transcript recovery in
`packages/kernel/src/transcript-recovery/`. The generic prompt document
model lives outside this repo (first entry below).

Governed by: [10-system-design/60-prompt-system-model.md](../10-system-design/60-prompt-system-model.md).

---

## Decisions

### Prompt-kit is a sibling repo, not a kernel package

**Decision:** The generic prompt document model — AST, canonicalization and
hashing, renderers, builders, transforms, validation — lives in
`@codecaine-ai/prompt-kit`, in the Core workspace's `prompt-kit` repo
(`prompt-kit/packages/prompt-kit`). The kernel consumes it as a workspace
dependency. Kernel-specific prompt helpers exist only in the kernel, and
only when they truly depend on kernel concepts.

**Why:** The original plan kept prompt-kit at `packages/prompt-kit` inside
this repo. That coupled a generic, reusable prompt standard to kernel
releases and kernel tooling; the peer repo lets other harnesses consume it
without pulling the kernel workspace. The dependency direction is the design
invariant either way: kernel → prompt-kit, never the reverse.

**Applies to:** Any new prompt AST node, renderer, transform, or template —
it goes to the `prompt-kit` repo, not `packages/kernel`. Any new kernel code
importing prompt-kit does so through the package export, never a relative
path.

### Bundle sections resolve by filename convention, file-first

**Decision:** Bundle resolution is one module —
`agent-registry/registry/bundle-layout.ts`. Every section follows the
`<kind>.ts | <kind>/index.ts` rule (`prompt.json | prompt/prompt.json` for
the prompt); the file form is tried first and wins silently when both exist,
with the shadowed path recorded for `doctor --catalog`. `index.ts` is a
folder's only entry point; everything else in a section folder is invisible
to discovery.

**Why:** The rejected alternative was pointing at section files from
`agent.json`. Path fields would make the manifest a build config instead of
data, and every migration would need a manifest edit; the convention keeps
manifests schema-validated data and makes re-export shims safe mid-move.

**Applies to:** Any new bundle section or sidecar kind — extend
`bundle-layout.ts` and follow the same two legal shapes. No other code may
probe bundle directories directly.

### Manifest and sidecar contracts live in `agent-definition/`

**Decision:** `packages/kernel/src/agent-definition/` owns the
`agent-kernel/agent-v1` JSON Schema (`agent-manifest-schema.ts`), the
`defineAgent` generator/validator, and `defineSpawnerTool`. The registry
validates every `agent.json` against this one schema; no other module
defines manifest fields.

**Why:** The alternative — letting the registry, spawn pipeline, and viewer
each carry their own notion of manifest fields — is how the retired
frontmatter model drifted. One schema module means a new manifest field is
added exactly once and every consumer sees it through the parsed
`ParsedAgent.config`.

**Applies to:** Any new manifest field, sidecar declaration shape, or
variable-schema rule — schema first, in `agent-definition/`, then consumers.

### The state model is one kernel module behind one gate

**Decision:** Everything the state model ships — the extension, the
three-section builder, window policies, the context set, the snapshot store,
and the kernel-side message helpers — lives in `packages/kernel/src/state/`.
Registration is gated on `stateExtensionEnabled` (a `state.ts` sidecar or a
`state.window` manifest block); with neither, nothing is registered.

**Why:** The rejected shape was always registering the extension with no-op
behavior for plain agents. Mechanical absence is what makes the pass-through
guarantee (design D83) auditable — a byte-identical legacy session cannot be
promised by a code path that still runs.

**Applies to:** New window strategies, event pumps, render plumbing, and
section-builder changes — all under `src/state/`, behind the same gate.

### Wire-visible constants live in `@agent-kernel/protocol`

**Decision:** The `kernel:context` / `kernel:state` customType constants,
`isKernelAuthoredMessage`, and the image-elision envelope are defined in
`packages/protocol/src/kernel-messages.ts`. The kernel and the viewer both
import them; neither defines its own copy.

**Why:** The markers survive into snapshot blobs the viewer reads back, so
defining them in the kernel would leave the viewer re-deriving the rule —
the producer/consumer drift design D99 exists to prevent.

**Applies to:** Any new kernel-authored message marker, elision envelope, or
wire-visible constant shared between emitter and reader.

### Transcript recovery is in-kernel, not a package

**Decision:** Re-deriving trace rows from Pi JSONL transcripts lives at
`packages/kernel/src/transcript-recovery/` (bins `agent-kernel-backfill`,
`agent-kernel-tui-ingest`). There is no separate tailer/recovery package.

**Why:** The standalone tailer package was dissolved (design D80): once
in-process emission became primary, a separate package's only effect was
letting the recovery mapper and the live emitter version-skew. Co-location
keeps their id-parity guarantee an intra-package test.

**Applies to:** Any new backfill, import, or transcript-derivation mapper.

---

## Roster

- `agent-definition/` — manifest schema, `defineAgent`, `defineSpawnerTool`.
- `agent-registry/` — bundle layout resolution, registry, prompt snapshots and revisions, catalog doctor.
- `state/` — state extension, three-section builder, windowing, context set, snapshot store.
- `prompt-edit-session/` + `catalog-api.ts` — the validated prompt/manifest write path behind the editor.
- `transcript-recovery/` — JSONL backfill and ingest mappers.
