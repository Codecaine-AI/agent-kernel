# Model-nodes demo fixture

`generate-fixture.ts` writes one deterministic trace that holds every
model-node shape the viewer renders: calls, decisions, steps, gates, nested
tools, abstains, failures and retries. It is the input of three consumers:

- the viewer-core characterization and route test
  (`packages/viewer-core/src/trace-builder/__fixtures__/model-nodes-demo.json`);
- the design-system `viewer-ui` run profile, which serves the trace DB
  read-only (`<DS>/apps/fixtures/viewer-ui/model-nodes-demo.db`);
- `shape.test.ts` (M6-D), which checks that the real kernel emits the same
  span skeleton.

## Regenerate

From the agent-kernel repo root:

```bash
# fixture JSON + routes.json (a temp DB is built and removed)
bun examples/simple-research-kernel/scripts/model-nodes-demo/generate-fixture.ts

# also keep the trace DB for the design-system run profile
bun examples/simple-research-kernel/scripts/model-nodes-demo/generate-fixture.ts \
  --db /Users/Ford/workspace/design-system/apps/fixtures/viewer-ui/model-nodes-demo.db \
  --journal-mode delete

# verify the committed JSON and routes.json match the generator (writes nothing)
bun examples/simple-research-kernel/scripts/model-nodes-demo/generate-fixture.ts --check
```

Output is byte-identical across runs (JSON and DB). `--journal-mode delete`
is the default, so the DB opens read-only without `-wal`/`-shm` files. Flags:
`--json <path>`, `--routes <path>`, `--db <path>`, `--journal-mode delete|wal`,
`--check`.

After changing the generator, regenerate, then update only the new
characterization snapshots:

```bash
cd packages/viewer-core && bun test src/trace-builder/characterization.test.ts
```

Bun writes snapshots that do not exist yet. Never pass `--update-snapshots`
while the research-run or state-demo snapshots still match: those entries must
stay byte-identical.

## How rows are written

The generator uses the committed protocol factories and db actions, so the
rows are the ones the kernel writes:

- The worker session and its runs go through `upsertPiAgentSession`,
  `createAgentRun`, `insertTraceEventsBatch`, `updateRunUsage` and the
  session and container usage rollups. Event ids come from `piEntryEventId`.
- Every call and decision goes through `claimAndStartNode` and
  `persistNodeCompletion`. The stale attempt is left `running`, and the next
  claim abandons it after `deadline_at` plus the 60 s grace.
- Steps and gates go through `insertTraceEventsBatch`. Span ids come from
  `kernelRequestId(kernelId, "span", requestId)`.
- The promoted nested end is inserted as an approximate row, then replaced by
  the live end through `upsertPromotableTraceEvent`.

The trace doctor must report ok, or nothing is written. The fixture JSON is
read back through `createContainerReadService(...).getContainerTrace`, which
is the payload the viewer API serves for this DB.

## The story

Container `worker-job/fn_8003A1C4` (kind `session`, kernel id
`model-nodes-demo`): the GameCube target `fn_8003A1C4` in `d_a_player.cpp`.
Times are offsets from t0 = 2026-10-07T09:00:00Z.

| Node | What happens | Numbers |
| --- | --- | --- |
| R1 `worker` (system) | Agent run, three turns. Turn 1 runs `codemode` with nested `read`, `bash` and `diff_function` → `bash` (three levels). The first `bash` end is promoted from approximate to live | 4m12s, $0.38 |
| R2 `ExtractCheckpointKnowledge (R1)` | Call, post-run under R1. Status `partial`, kept advisories A1–A3 | 1.8 s, $0.004 |
| S1 `validate` | Step on R1 | 6.3 s, objdiff 97.4%, micro-gates 5/5 |
| Gate `checkpoint-accepted` | Step `objdiff`, then per advisory a step `justification:<id>` and a decision `JudgeAdvisory:<id>`. Verdict `abstain` (A3) | 29.8 s |
| R3 `JudgeAdvisory:A1` | Bool decision in the gate, p = 0.91 ≥ 0.85, pass | 110 ms, 1,412 input tokens |
| `JudgeAdvisory:A2` | Retry in the gate: attempt 1 errors (HTTP 503, engine-error abstain), attempt 2 passes at p = 0.88. The first gate pass was interrupted before `gate_end`, and the retried job re-ran the gate with the same requestIds | 1.24 s, then 120 ms |
| `JudgeAdvisory:A3` | Abstains, low confidence, p = 0.52 | 100 ms |
| `JudgeAdvisoryWithRationale:A3` | Escalation call (judge). The output is truncated, so it fails with a parse error and keeps the raw output | 2.1 s |
| R4 `ContinueOrStop` | Choice decision: `retry_new_strategy` 0.71 (0.21 / 0.71 / 0.08), confidence 0.64, floor 0.5 | 95 ms, 968 input tokens |
| `SummarizeWorkerRun` | One requestId under two parent runs. Attempt 1 under R1 fails (HTTP 502 twice). Attempt 2 under R5 succeeds. Renders as one row under each run | 1.0 s, then 1.4 s |
| R5 `worker` (steer) | Same session, strategy hint, three turns | 2m40s, $0.24 |
| R6 `ExtractCheckpointKnowledge (R5)` | Call, post-run under R5, status `exact` | 1.8 s |
| S2 `validate`, S3 `stop` | Steps on R5 | 5.4 s (objdiff 100%, exact); 20 ms |
| `ExtractConfirmedCheckpointKnowledge` | Settlement-time call under R5. Attempt 1 dies `running`; attempt 2's claim abandons it (`call_end` aborted, kind `abandoned`) and succeeds | 1.6 s |

Differences from the spec walkthrough
(`docs/90-specs/10-model-nodes/40-walkthrough`):

- R1 and R5 hold three turns each, not 14 and 9. Their durations and costs
  match the spec.
- The note keeps three advisories, not one. A2 and A3 exist so the plan's
  retry and abstain cases have subjects.
- The summary has two attempts, and the run also holds the plan's gate,
  failed call and settlement call. So the container cost is $0.64, not $0.63.

## Ids and DS routes

`routes.json` (written next to this file) holds `FIXTURE_IDS` (every
session, run, span and start-event id), the `<…>` placeholders of the plan's
M6-E route table, and the `data-span-id` each placeholder resolves to. The
same placeholders and targets are in the fixture JSON under `fixture`.

Tree ids follow viewer-core:

- A node row with one placement is `pi:<sessionId>`. When a session has
  several placements, each row is `run:<firstRunId>` of its group.
- Attempt rows are `attempt:<runId>`.
- Event spans (gates, steps, tools) use their start event's id.

The viewer-core test `route targets are unique in the demo fixture` checks
three things for every target: it occurs exactly once, it has the expected
row kind, and the two click-then-wait routes find their child under the
clicked row.

| Placeholder | Row | Selector value |
| --- | --- | --- |
| `R2` | `ExtractCheckpointKnowledge (R1)` | `pi:<session>` |
| `R3` | `JudgeAdvisory:A1` | `pi:<session>` |
| `R4` | `ContinueOrStop` | `pi:<session>` |
| `ABSTAIN` | `JudgeAdvisory:A3` | `pi:<session>` |
| `FAILED_CALL` | `JudgeAdvisoryWithRationale:A3` | `pi:<session>` |
| `GATE_SPAN` | `checkpoint-accepted` | gate_start event id |
| `CODEMODE_SPAN` | `codemode` | tool_call_start event id |
| `NESTED_READ_SPAN` | nested `read` | tool_call_start event id |
| `RETRY_DECISION` | `JudgeAdvisory:A2` | `pi:<session>` |
| `RETRY_ATTEMPT_2` | `attempt 2` | `attempt:<run>` |
