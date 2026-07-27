---
covers: "Per-turn request snapshots end to end: the recorder's two capture paths, the sanitized-message and blob contract, section tags on the protocol, the run-turn context read route, and the viewer's three-section turn view with its flat fallback."
concepts: [request-snapshot, trace-blobs, sanitized-message, section-tags, turn-view, run-turn-context, content-addressed]
code-ref: packages/kernel/src/spawn-pipeline/streaming/request-snapshot.ts, packages/protocol/src/types.ts, packages/kernel/src/read-service.ts, packages/viewer-ui/src/trace-viewer/detail-panel/renderers/
depends-on: [10-spawn-pipeline.md, 60-agent-state.md, ../60-viewer/00-overview.md]
---

# Request Snapshots

A request snapshot is the exact context window one turn ran on, captured into content-addressed trace blobs and referenced by a `pi_request_snapshot` trace event. It is what makes "what did the model actually see?" answerable after the fact (D90).

The pipeline crosses four packages: kernel captures, protocol types the payload, db stores the blobs, read API resolves them, viewer renders them.

---

## Capture

`createRequestSnapshotRecorder({ db, traceWriter, ids, promptHash, logger })` is created per spawn when a trace writer exists and `captureRequestSnapshots` is not disabled (kernel config, overridable per spawn; default on). It shares the emitter's envelope `ids`, so snapshots land in the run's trace beside its turn events.

**Turn numbering** resets on `agent_start` and increments once per captured request, mirroring how the emitter numbers `pi_turn_start`.

- On the **transcript path** that is a 1:1 correspondence: one capture per `turn_start`.
- On the **builder path** it holds turn-for-turn in the normal case, but is not guaranteed. The `context` hook fires once per *provider request*, so a provider retry inside one turn produces an EXTRA snapshot; it consumes a `turn_number`, after which snapshot numbering runs ahead of `pi_turn_start` for the rest of the agent invocation. The extra snapshot is accurate — it is a real request that really went out. Readers correlating the two should treat `turn_number` as "the nth captured request", not as a key into turn events.

There are two capture paths, and only one is live per run:

| Path | Trigger | Captures |
|---|---|---|
| Transcript capture | `turn_start` session event | `session.messages` filtered by pi-coding-agent's `convertToLlm` selection contract (`isSentToModel`) |
| Built-request capture | `recordBuiltRequest(session, { messages, sections })` | the exact array the three-section builder assembled, plus its section boundaries |

`recordBuiltRequest` sets an internal `builtRequestSource` latch: from the first call onward, `turn_start` no longer captures. The built request **is** the request, and it fires once per provider call, so capturing the raw transcript as well would double-count turns. The spawn pipeline wires this by subscribing the recorder to the state extension's `onRequestBuilt` — so an agent with an active state extension gets one snapshot per provider call, tagged; an agent without one keeps the `turn_start` transcript capture, untagged.

The system prompt is read off the session on both paths and stored as its own blob — it is section ①, never part of the message list.

### Safety contract

`handleEvent` and `recordBuiltRequest` are synchronous and never throw. Each captures state synchronously (pi messages are immutable once persisted, so a slice is stable), then defers hashing, blob upserts, and event submission behind an internal serialized promise tail — the same pattern as the trace writer. Every failure is caught and logged. `flush()` drains the tail and is awaited on both the normal and error paths of a run.

## The Blob Contract

Each captured message is sanitized before hashing: image content blocks `{type: "image", data: <base64>, mimeType}` become `{type: "image", blob_hash, mimeType, byte_length}` with the base64 payload removed and stored as its own blob of kind `image`. Everything else passes through unchanged.

Blobs written per snapshot: one `text`/`text/plain` blob for the system prompt, one `message`/`application/json` blob per sanitized message, and one `image` blob per image. Hashes already written by this recorder are tracked in a set and not rewritten — the transcript is prefix-stable across turns, so repeat turns cost only the new tail.

`PiRequestSnapshotData` carries `turn_number`, `system_prompt_blob_hash`, `prompt_hash`, `message_count`, `message_refs` (per-message `blob_hash`, `role`, `index`, `text_chars`, `image_count`, `tool_call_count`), `total_text_chars`, `total_image_count`, and optionally `sections`.

## Section Tags

`PiRequestSnapshotSection` is `{ kind: "context" | "state" | "tail", start, end }` — half-open `[start, end)` ranges over the snapshot's ordered `message_refs`. Sections are emitted in order, never overlap, and empty sections are omitted rather than emitted as zero-length ranges. The system prompt is section ① and is captured separately, so it never appears in the list.

`sections` is **optional and absent on transcript-captured turns**, including every snapshot written before section tags existed. Readers must treat a missing `sections` as "untagged" and fall back to a flat rendering — this is the compatibility rule the whole downstream chain follows.

The ranges come from the state layer's `buildRequest` unchanged; `RequestSection` and `PiRequestSnapshotSection` are structurally identical on purpose (see [60-agent-state.md](60-agent-state.md)).

## Read Path

`GET /kernel/runs/:runId/turns/:n/context` (`KERNEL_TRACE_READ_PATHS.runTurnContext`) resolves a snapshot into a readable turn. The route answers 404 when the service does not implement `getRunTurnContext`.

`getRunTurnContext` lists the run's `pi_request_snapshot` events, takes the latest one matching the turn number (in case one was ever re-emitted), then resolves the system-prompt blob and every message blob. A missing or unparseable blob becomes `{ missing_blob: <hash> }` in the message list plus a line in `warnings`, rather than failing the request.

`KernelRunTurnContext` returns `run_id`, `turn_number`, `prompt_hash`, `system_prompt`, `message_count`, `messages` (sanitized, in context order), `refs`, `totals`, optional `sections`, and optional `warnings`. `sections` is passed through only when the snapshot had it.

Raw blob bytes serve from `GET /kernel/blobs/:hash`, which is how the viewer renders images without inlining base64.

## Viewer

`RequestSnapshotRenderer` (viewer-ui detail panel) has two modes:

- **Offline** (no API base): a summary block built from span attributes plus a per-message table of blob refs. `spanAttributes.ts` exposes the snapshot's `message_refs` as span input JSON and its attributes include `sections` as a **JSON string** — the offline fallback for the read API's `context.sections`.
- **Online** (API base + `run_id`): fetches the turn-context route and renders the full conversation — text, thinking, tool calls, tool results, and images served from the blob route. Any fetch failure falls back to the summary with a one-line muted note.

When section tags are present, the fetched context renders through `TurnRequestView` instead of one flat list.

### Section parsing

`parseSectionTags(input)` accepts either the JSON-string span attribute or the parsed array, and returns `null` — meaning "render flat, as before" — when the field is absent, empty, or malformed in *any* way. A partially valid array is rejected wholesale rather than reinterpreted, on the grounds that a wrong grouping is worse than no grouping. Well-typed but degenerate ranges (`end <= start`) are dropped individually, since an empty section is a legitimate thing to emit.

`groupTurnSections(messages, tags)` clamps ranges to the list and assigns each message to the *first* tag covering it (tags sorted by start, then end), so overlapping tags from a future builder cannot duplicate a message. Anything no tag covers lands in an `untagged` bucket — surfaced, never dropped.

### The turn view

`TurnRequestView` lays the turn out as the three sections it was built from:

| Section | Content | Default |
|---|---|---|
| ① System prompt | captured separately on the snapshot | collapsed |
| ② Context | the rebuilt L2 set | collapsed |
| ③ State | `render(state)` — the state block(s), then the tail | expanded |
| · Untagged | in the request, outside every section tag | collapsed, only when non-empty |

The `tail` is rendered as a sub-group *inside* ③ behind a small divider, not as a fourth section, because the tail is part of the state render.

Messages whose single text block looks like a rendered state block (`looksLikeStateBlock` — the text starts with a `<state…>` tag) render through `StateBlockView`. `state-block.ts` only strips the block's own outer indentation and colors tag syntax: the block is not well-formed XML and must not be reformatted, because indentation inside `<board>` is load-bearing in the digest grammar. The bytes the model saw stay byte-for-byte otherwise.

`turn-sections.ts` keeps a local structural mirror of the section type rather than importing it from protocol, so viewer-ui stays buildable against protocol versions that predate the field. The shapes are intentionally identical.
