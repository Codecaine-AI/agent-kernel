# TUI Harness Design

> **SETTLED 2026-08-14** into
> `../10-system-design/70-harness-model.md` — read that for the current
> model; this file is the design-session record (rationale + decisions log)
> and is no longer maintained. See also
> `core-kernel-observatory.design.md` for the core-kernel session record.

This document records the design session of 2026-08-06. It covers
`@agent-kernel/tui` — a terminal harness that boots any kernel bundle as an
interactive pi session — plus the global pi layout it slots into and the
slimming of the `pi-config` repo into the personal layer. Updated 2026-08-06
with as-built status (see Build order / status and the disposition section).
Reference artifact; implementation does not depend on this file.

## Motivation

Two goals converged:

1. **pi as the daily driver.** Move interactive coding work to the pi TUI
   (away from Codex CLI / Claude Code), booting directly into purpose-built
   agents instead of a blank session.
2. **Quickly adjusting the agent system's own context and state.** The prompt
   editor covers ① (prompt.json is an AST with transactions). Context ② and
   state ③ are code and markdown spanning the repo — no closed-world editor is
   possible. The right tool is a *session* that already knows the system:
   boot, say "we're changing X," go.

The original proof of the pattern is the `Lascari AI/pi-config` repo:
bootable configs (`pi -e .pi/configs/<name>/index.ts`) over an always-on
extension floor, each config owning a templated system prompt, boot-time
context injection, and domain tools. Its `prompting` config is a proto-kernel
— `prompt.md` placeholders ≈ ③ state, `<skill_reference>` ≈ ② context, run
discovery/injection ≈ sessionData seeding. The kernel industrialized that
anatomy; the TUI harness ports the bootable-config idea onto it.

## Position in the architecture

The package is a **peer of the app harnesses**, not infrastructure kernels
need. Nothing about running kernels depends on it.

```
                agent-kernel (library)
               /          |           \
  canvas-agent      prompt-kit-agent    @agent-kernel/tui
  (app harness,     (app harness,       (terminal harness,
   server :4820)     server :4850)       pi extension)
```

Hence the name: it is the TUI leg. "runner" was rejected because it implies
kernels require it.

## The package: `agent-kernel/packages/tui`

One pi extension plus supporting modules:

```
packages/tui/
  package.json          @agent-kernel/tui
  src/
    extension.ts        entry — loadable via settings `extensions` array or `pi -e`
    catalog.ts          multi-root agent resolution with precedence (below)
    boot.ts             thin spawn: assemble ① ② ③ from a bundle
    state-loop.ts       per-turn ③ re-render via before_agent_start
    tools.ts            tools-sidecar → pi.registerTool bindings
    commands.ts         /kernel <name>, picker TUI, per-agent flags
```

### Boot contract (thin spawn)

The full `spawn-pipeline/` is db-tangled; the TUI harness does its own thin
spawn from the fs-only kernel exports (verified: `src/context/**` and
`src/state/**` import no db, no server):

1. `buildRegistry({ roots })` — discover and load bundles (db-free).
2. `buildContext` + `createDefaultCatalog` — assemble section ②; the trace
   emitter is optional and omitted in v1.
3. State: seed from `module.seed(ctx)` or a fixture
   (`discoverStateFixtures`), render via `module.render` +
   `normalizeRenderOutput`. The exact recipe exists as private code in
   `catalog-service.ts` (`buildStatePreview`, ~30 lines) — reproduce it from
   the exported primitives.
4. `before_agent_start` → return `{ systemPrompt: ① + ② + ③ }`. Re-render ③
   each turn here (the kernel's seed-once contract applies to server spawns;
   interactively, per-turn re-render is the point).
5. Tools sidecar → `pi.registerTool(...)` (works at load or mid-session).

pi capabilities this relies on, confirmed in `ai_docs/pi_agent/docs/`:
`before_agent_start` can replace the chained system prompt;
`registerTool`/`registerCommand` work after startup; extensions auto-discover
globally from `~/.pi/agent/extensions/` and per-project from
`.pi/extensions/` (after trust); settings `extensions`/`skills`/`prompts`
arrays accept absolute paths, `~`, and globs.

### Catalog precedence

Mirror pi's own global→project settings rule, applied to agent catalogs:

```
resolve(name) over [ cwd .agent-kernel/kernel.json catalogRoots…,
                     global generic catalog (agent-kernel/catalog/) ]
```

Project-first: a repo bundle with the same name **shadows** the generic one.
This is the whole specialization mechanism — no forks of the harness or the
skills. A generic `context-editor` lives in `agent-kernel/catalog/`; canvas
later ships its own `context-editor` (same anatomy, canvas ripple map baked
into its ② blocks) and the same `/kernel context-editor` command resolves to
it inside canvas. `catalogRoots` is already plural and `buildRegistry` takes
multiple roots; this is configuration, not new machinery.

Do NOT specialize via pi skill-name collisions (pi warns and keeps the first
found). Generic skills get unambiguous names (`kernel-agent-authoring`);
specialization happens only through catalog shadowing.

### Interaction surface

- `/kernel <name>` — boot a bundle into the current session (picker when no
  arg, pattern: pi-config's SessionPicker).
- Per-agent namespaced flags (`--<id>-model`, `--<id>-thinking`) — carried
  over from pi-config's `applyAgentConfig`.
- `/prime-agent` prompt template (`agent-kernel/prompts/prime-agent.md`) —
  orient in cwd: run the brief, report the bundle map, await the change
  request.

## The generalized layer in agent-kernel

```
agent-kernel/
  catalog/                          generic bundles
    context-editor/                 agent.json · prompt/ · context/ · state/
  skills/
    kernel-agent-authoring/
      SKILL.md                      model (① ② ③, seed-once), orientation
                                    procedure, cross-artifact invariants
      scripts/brief.ts              deterministic orientation: cwd →
                                    kernel.json → catalogRoots → print bundle
                                    anatomy + assembled ② + rendered ③ fixture
  prompts/
    prime-agent.md
```

Skill authoring rules settled earlier in the session:

- The skill is a thin router: body carries only what the docs don't (the
  orientation procedure, the invariants); it references
  `docs/30-authoring/*` as the single source of truth. References list
  **both** path forms — relative from the skill dir and repo-root-anchored —
  so the route is unambiguous from any cwd.
- Invariants the skill must state: `system.md` is generated (regenerate via
  `bunx agent-kernel-render-prompts`; prompt.json edits belong to the prompt
  lab); state `S` must be JSON-serializable (why app registries exist);
  changing a state render requires updating the matching ② grammar block;
  `*.generated.ts` files are regenerated, never hand-edited.
- This finally builds the `kernel-agent-authoring` parent skill called for by
  `prompt-skills-design-session.md` (2026-06-27).
- Forward-compatible: the kernel's `skill` context loader
  (`context/loaders/skill.ts`) expects this SKILL.md shape; when a
  `SkillRegistry` implementation lands, the same directory feeds
  kernel-spawned agents. Author once, two consumers.

## Global pi layout

pi's two-level layering (global `~/.pi/agent/` + project `.pi/`, project
overrides, resource arrays additive) carries the rest. Key move: the global
dir holds **pointers, not copies** — resource arrays reference the live
checkouts, so config drift (the pi-config failure mode) becomes structurally
impossible.

```
~/.pi/agent/                        thin; managed by pi-config's link.sh
  settings.json → pi-config         defaults + resource pointer arrays:
                                    extensions → agent-kernel/packages/tui
                                    skills     → agent-kernel/skills
                                    prompts    → agent-kernel/prompts
  settings/models/keybindings/AGENTS.md/extensions/skills/themes
                                    → symlinks into the pi-config checkout
  auth.json · sessions/ · bin/      machine-local, never managed

pi-config repo                      the personal floor (kept live, slimmed)
  .pi/extensions/{base,shell,ui}    copy-all/diff/yeet · zsh routing · UI
  .pi/{AGENTS.md,themes,settings…}  link.sh + `just link` (idempotent,
                                    displaced files backed up)

<member repo>/.pi/settings.json     optional overrides only (one-time /trust)
```

Per-repo surface is near zero: the harness reads the existing
`.agent-kernel/kernel.json`; canvas and prompt-kit need no changes to boot.

## pi-config disposition

As built (2026-08-06): the originally planned `Core/pi/` port was **dropped**
— `Lascari AI/pi-config` stays alive as the personal layer, symlinked into
`~/.pi/agent/` by its `link.sh`, and was slimmed to core pieces the same day.

| Piece | Fate |
|---|---|
| `extensions/` floor, `AGENTS.md`, themes, settings | Kept in pi-config (live via symlinks) |
| `agent-config/index.ts`, `configs/*`, `modules/` | Deleted (superseded by the TUI harness + bundles; recoverable from git history) |
| `skills/prompting`, old `docs/` + docs-framework submodule, `ai_docs/`, `.claude/` | Deleted (retired / duplicated elsewhere in Core) |
| `.prompt-runs`, `to_add/`, `.spectre/` | Deleted |
| Repo | Kept — it *is* the portable global config (`clone → pnpm install → ./link.sh`) |

Pain points of the original the port fixes: per-config hand-rolled prompt
templating (→ ③ state contract), no tool-removal mechanism, docs drifted from
the justfile, dead code accumulation, and `~/.pi` drifting from the repo
(→ pointer arrays + doctor).

## Known constraints

- Bundles whose tools reach into app services (canvas `place`/`arrange`
  depend on the live `LayoutSessionStore`) will not run standalone. Quick
  agents keep tools self-contained; the tools-sidecar contract already
  supports this.
- v1 records no kernel traces — pi session JSONL only (pi's `sessionDir`).
  Trace-db recording is a later phase; per the trace-ownership rule, a TUI
  session's traces would belong to the kernel of the repo it runs in.
- Project `.pi/` resources require a one-time `/trust` per repo.
- **pi runs extensions under Node, not bun.** The tui import graph must stay
  Node-clean: import the db-free `agent-registry/registry` sub-barrel, never
  the `agent-registry` barrel (its `register-prompt-revisions` neighbor pulls
  `@agent-kernel/db` → `bun:sqlite`, which crashes extension load; hit and
  fixed 2026-08-06). Verify extension changes with `pi -p`, not `bun -e`.
- The same rule extends to **bundle sidecar code**: the registry evaluates
  `context.ts`/`state.ts` under pi's runtime, so sidecars must avoid bun-only
  APIs — use `dirname(fileURLToPath(import.meta.url))`, never
  `import.meta.dir` (hit in context-editor's AND prompt-editor's ② sidecars,
  both fixed 2026-08-06; layer failures now surface as warnings in the
  `/kernel` list instead of silently hiding the catalog).
- Runtime placement is declared, not crash-discovered: the manifest field
  `host?: "app" | "any"` (default `"app"`) ships as of 2026-08-06. `"app"`
  bundles are classified from the manifest JSON alone — the TUI never
  evaluates their sidecars — and list as "app-harness agent (runs in its
  owning harness)". `"any"` bundles list and boot; the doctor's host
  portability check (`agent-kernel-doctor --catalog`) imports each `"any"`
  bundle's sidecars in a Node subprocess through jiti and flags false
  declarations. Per-bundle isolation (attempt-whole, then exclude-and-retry)
  remains the backstop for `"any"` bundles that fail to load anyway.
- Kernel `command`/`directory` context loaders use Bun APIs at call time —
  under Node-pi they degrade to a visible `context input failed` warning on
  that ② input (no crash). Dual-runtime loaders are open kernel-side work.
- The personal floor lives in the pi-config repo (kept, not ported to Core)
  — see the disposition section.

## Build order / status

1. **Phase 1 — daily driver. SHIPPED 2026-08-06** (Fable agents).
   `packages/tui` boot path (`extension.ts`, `catalog.ts`, `boot.ts`,
   `tools.ts`, `commands.ts`, `scripts/dry-boot.ts`, 8 tests); wiring via
   pi-config settings pointer arrays; floor stayed in pi-config (see
   disposition). Deferred with marked seams: `state-loop.ts` per-turn ③
   re-render, picker TUI, per-agent `--<id>-model/-thinking` flags.
2. **Phase 2 — the context agent. SHIPPED 2026-08-06** (except state-loop).
   `kernel-agent-authoring` skill + `scripts/brief.ts`, generic
   `context-editor` bundle, `/prime-agent` template. Verified: brief green on
   simple-research-kernel + canvas; bundle passes doctor +
   `render-prompts --check`.
3. **Phase 3 — specialization + fan-out. OPEN.** Canvas-specialized
   `context-editor` bundle; `spawn_agent` tool over the kernel `subagents/`
   module resolving through the same catalog precedence (every bundle becomes
   both interactively bootable and spawnable as a sub-agent); plus the
   deferred phase-1 items above.

## Decisions log

- Package name: `tui` ("runner" rejected — implies kernels need it; this is
  the terminal *leg*, a harness peer).
- Runtime placement is a manifest declaration (2026-08-06): `host: "app" |
  "any"`, default `"app"`. Harnesses trust the declaration (classify, don't
  evaluate); the doctor verifies `"any"` sidecars actually load under Node.
  Alias/model resolution stays out of scope for the TUI.
- No worktree/session-service machinery, no diff-review UI for context/state
  edits — plain pi session, normal git; context is too dynamic for diff-first
  review to pay off.
- Specialization via catalog shadowing, never skill-name collisions.
- Global config = pointers to checkouts. As built: managed by pi-config's
  `link.sh` symlinks (the planned `install.ts` + doctor check remain optional
  follow-ups).
- pi-config repo retained as the live personal layer, not archived — the
  symlink setup (2026-08-06) reversed the archive plan; the repo was slimmed
  to floor + settings + link.sh instead.
- Live session-state editing stays out of scope; edits target the generators
  (sidecars), which take effect on next spawn. Fixtures (including
  capture-from-live later) preview mutable states.
- Command named `/kernel` (renamed from `/agent`, 2026-08-06) — "agent" was too generic; the command boots a kernel bundle.
