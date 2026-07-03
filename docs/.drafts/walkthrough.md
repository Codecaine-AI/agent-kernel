# Kernel Overhaul — Guided Walkthrough

Branch: `kernel-overhaul`. Work through the stations in order; each one takes
5–20 minutes. Send feedback anytime as `S<n>: <what you saw / what's wrong /
what you want changed>` — fixes happen between stations, and this file's
checklist tracks what's open.

Start clean so your walkthrough data isn't mixed with the build-time smoke
runs:

```sh
git checkout kernel-overhaul
bun install
rm -rf examples/simple-research-kernel/.agent-kernel
```

---

## Station 1 — Boot + first run (~5 min) · runnability

```sh
bun run dev:simple-research
```

- API on http://127.0.0.1:8788, viewer on http://127.0.0.1:5174. No Docker, no
  Postgres, no tailer process.
- Confirm `.agent-kernel/trace.db` and `.agent-kernel/kernel.json` appeared in
  the example dir on boot.
- Kick off a run from the Research workspace UI, or:

```sh
curl -s -X POST http://127.0.0.1:8788/api/run -H 'content-type: application/json' \
  -d '{"prompt":"Assess how the example demonstrates container-first tracing."}'
```

Judge: does day-zero boot feel right? Is anything about the startup output
confusing or missing (links, paths, status)?

## Station 2 — Trace viewer (~10 min) · traceability, visual

While the run executes (and after), open the Trace workspace.

- The tree should read: session container → coordinator session → Run #1, with
  scouts and the report writer nested under the coordinator's spawn tool call.
- Look for: trigger on runs (`operator` vs `parent-tool`), token counts on
  spans, `parentToolUseId` nesting (scouts under the tool call, not siblings),
  trace-level filtering still working.

Judge: is the tree shaped how you think about the work? Are tokens surfaced
where you'd look for them, or do they need to be more prominent (per-span,
rollup badges, container header)?

## Station 3 — Usage + doctor, now in the UI (~10 min) · traceability

UPDATE (`d163197`): no SQL needed. In the Trace workspace, the selected trace
now has a collapsible Usage panel above the span tree (totals, per-agent
rollup, per-run table with triggers) and the Traces panel header has a Doctor
control (invariants chip + row counts). The SQL below remains for going
deeper. Judge in the UI: is the totals strip the right set? Does per-agent
rollup earn its space? What breakdowns are missing for real analysis
(per-phase, per-epoch — container kinds can carry them)?

## Station 3 (raw) — Database + doctor via SQL · optional

```sh
sqlite3 examples/simple-research-kernel/.agent-kernel/trace.db \
  "SELECT kind, label, usage_input_tokens, usage_output_tokens FROM containers"
sqlite3 examples/simple-research-kernel/.agent-kernel/trace.db \
  "SELECT agent_name, trigger, status, usage_input_tokens, usage_output_tokens FROM agent_runs"
sqlite3 examples/simple-research-kernel/.agent-kernel/trace.db \
  "SELECT agent_name, model, prompt_hash FROM pi_agent_sessions"
bun run packages/kernel/src/doctor-cli.ts examples/simple-research-kernel/.agent-kernel/trace.db
```

- Check the rollup arithmetic yourself: run tokens should sum to the container
  row exactly.
- `model` on sessions should be the resolved `codex-lb/...` string, not the
  `research-default` alias.
- Doctor should report zero violations across all 8 invariants.

Judge: is this the schema you'd want to write ad-hoc analysis queries against?
Any columns missing or misnamed? Is doctor output readable enough to trust?

## Station 4 — Agent bundle on disk (~5 min) · authoring model

```sh
ls examples/simple-research-kernel/src/agent-catalog/source-scout/
cat examples/simple-research-kernel/src/agent-catalog/source-scout/agent.json
less examples/simple-research-kernel/src/agent-catalog/source-scout/prompt.rendered.md
```

- Bundle is `agent.json` + `prompt.json` + `prompt.rendered.md` (derived) +
  `context.ts` + `tools.ts`. No `agent.ts`, no frontmatter anywhere.
- Skim `prompt.json` — this is what the lab edits and what gets hashed.
- The coordinator's `agent.json` has a `deep` variant and the alias model.

Judge: would you be comfortable hand-editing `agent.json`? Is `prompt.json`
tolerable to read raw, or does it confirm the lab should be the only editing
surface? Is the rendered snapshot useful as a PR-review artifact?

## Station 5 — PromptLab editing (~15 min) · the editor

Viewer → Agents workspace → select an agent → Prompt Lab toggle.

- Edit blocks: insert, drag to reorder, edit text, change a section in the
  inspector. Try both Sections and Agent XML modes.
- Undo/redo (mod+z / mod+shift+z) through a series of edits.
- Introduce a validation error (reference an undeclared `variable(...)` via
  the inspector) — it should surface in the diagnostics footer and block a
  clean save.
- Save a real small edit (e.g. add a rule to source-scout). Watch the hash
  chip change; check the revision history panel shows `registry-boot` +
  `lab-save` rows; select two revisions and read the block diff.
- Confirm on disk: `git diff examples/.../source-scout/prompt.json` shows a
  canonical, readable change and `prompt.rendered.md` regenerated.

Judge: does the Notion-style editing actually feel better than editing the
file? What's clunky — insert affordances, drag targets, inspector fields,
diff readability? This station is where your feedback matters most.

## Station 6 — Close the loop (~10 min) · the thesis

With your Station 5 edit saved:

```sh
curl -s -X POST http://127.0.0.1:8788/api/run -H 'content-type: application/json' \
  -d '{"prompt":"Short follow-up run to exercise the edited scout prompt."}'
```

- New source-scout sessions should carry the NEW hash — no server restart.
- The stats strip in the lab should show run count / avg tokens / failures for
  the new revision once the run completes.
- Old sessions keep the old hash (check Station 3's session query again).

Judge: is this per-revision feedback the thing you wanted? What else belongs
in the stats strip (median vs avg, per-agent split, cost once prices are
configured)?

## Station 7 — Variants + backfill (~10 min) · control + recovery

```sh
curl -s -X POST http://127.0.0.1:8788/api/run -H 'content-type: application/json' \
  -d '{"prompt":"Variant check run.","variant":"deep"}'
sqlite3 examples/simple-research-kernel/.agent-kernel/trace.db \
  "SELECT display_label, model FROM pi_agent_sessions ORDER BY created_at DESC LIMIT 4"
```

- The coordinator session should show `(deep)` in its label with the variant's
  settings applied.
- Crash recovery: stop the server, delete the db
  (`rm examples/simple-research-kernel/.agent-kernel/trace.db*`), then rebuild
  it from Pi's JSONL transcripts (check `.agent-kernel/kernel.json` for the
  pi-sessions dir):

```sh
bun run packages/tailer/src/backfill-cli.ts \
  examples/simple-research-kernel/.agent-kernel/pi-sessions \
  --db examples/simple-research-kernel/.agent-kernel/trace.db
bun run packages/kernel/src/doctor-cli.ts examples/simple-research-kernel/.agent-kernel/trace.db
```

- Rerun the backfill — second pass should insert zero rows.

Judge: is the variant override surface right (what it can and can't change)?
Does backfill recover enough of the picture (kernel-side lifecycle events
don't live in JSONL — is what's missing acceptable for a recovery path)?

## Station 8 — API surface + docs (~20 min) · reading

The "would I build a harness on this" review:

- `examples/simple-research-kernel/src/simple-research-kernel-store.ts` — the
  whole harness wiring is one `createKernel(config)` call plus domain logic.
  This is the melee-port preview.
- `packages/kernel/src/index.ts` — the config type and instance surface.
- `docs/10-system-design/15-identity-model.md` — the identity spec.
- `docs/10-system-design/10-runtime-model.md`, `20-observability-model.md`,
  `30-event-protocol.md` — do the docs now read like the system you just used?
- `docs/10-system-design/60-prompt-system-model.md` — the D70–D76 amendments.

Judge: config slot names, what's still awkward to wire, anything in the docs
that contradicts what you experienced at Stations 1–7.

---

## Feedback log

(updated as feedback comes in)

- [x] S1: `make research-ui` came up on unexpected ports — Makefile predated
  the overhaul (overrode to 8791/5175, printed a dead Postgres URL). Fixed in
  `ac9a777`: defaults now 8788/5174 with an accurate SQLite line, plus a
  `make doctor` target.
- [x] S2: trace-builder code quality ("spaghetti, especially spanAttributes")
  — refactored in `68c2093` behind a byte-identical characterization snapshot
  captured from the real walkthrough run. spanAttributes' four parallel
  switches became one declarative EVENT_SPECS registry; build-trace-spans is
  now a staged pipeline. Output unchanged by construction.
- [x] S2: spawner tools (D77) — done in `98610b0` (kernel) + `40aceb0`
  (viewer): defineSpawnerTool with per-tool spawns allowlist and scoped
  dispatch, canSpawnSubagent retired, dispatch events render as
  "Dispatch: <agent>" nodes with agent chips. QA review caught and fixed a
  queued-dispatch identity bug before commit. Known accepted gap: JSONL
  backfill can't stamp spawner marking (recovery-path display only).
- [x] S3: usage summary over-indexed — done in `670871a`: one-line USAGE strip
  above the tree, full summary in the detail column on click (runs table rows
  select their span), container/session/run spans show their aggregate in the
  detail panel. Browser-verified both directions.
- [x] S5: prompt editor evolution — done in `d0cf1cf` + `5e0483f`: Agent XML
  is the primary surface, rendered as a true code editor (strict 21px grid,
  continuous gutter with Raw parity, indent guides + tag-line landmarks,
  hover range bars), pointer-based drag with full-block ghost + depth-aware
  insertion line, chrome relocated to the pinned details column, VS Code
  Dark+ palette via shared editor tokens. Browser-verified geometrically.
- [ ] OPEN (owner decision): grain overlay screen-blend lifts all dark
  surfaces app-wide — keep as atmosphere, change default blend to
  soft-light, or exempt the editor (masking work)?
- [ ] DEFERRED: dedicated cost-summary page (cross-container comparison) —
  revisit once real multi-session history accumulates.
- [ ] NOTE: API server does not hot-reload — server-side changes need a
  `make research-ui` restart; zeros in usage UI = stale API process.
- [x] S2: icons should be part of the card, colors don't convey roles, fonts
  inconsistent — done in `058e923`: integrated icon caps (inline end cell /
  boxed corner cell sharing the card border), semantic color groups
  (orchestration violet, user blue, assistant green, tools cyan, lifecycle
  gray, amber/red reserved for diagnostics), unified mono type scale, info
  rows became MetaCard mini-cards. Browser-verified.
- [x] S2: span cards hard to scan without type icons — done in `814ec3a`:
  Nucleo edge-icon chips per span type (13 icons, outline + fill), with
  "Icon style" (outline/solid) and "Icon side" (left/right) in the style
  rail. Both treatments browser-verified; pick by eye and tell me which wins.
- [x] S1: white screen at the viewer — top-level `node:crypto` imports in
  `protocol/ids.ts` and prompt-kit `canonicalize.ts` failed module
  instantiation in the browser (silent — no console error), blanking the app
  once Phase 5a pulled those packages into the viewer graph. Fixed in
  `22b9768` (+ submodule): dependency-free sha256, byte-identical output,
  parity-tested. Reload the page to pick it up.
