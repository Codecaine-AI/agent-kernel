# @agent-kernel/tui

The kernel's terminal harness: a pi extension that boots any agent bundle as
an interactive pi session. A peer of the app harnesses (canvas-agent,
prompt-kit-agent) — kernels do not require it.

Model and rationale: [`docs/10-system-design/70-harness-model.md`](../../docs/10-system-design/70-harness-model.md).

## Setup

Four links, from machine to session:

1. **pi itself** — installed globally (npm, Node ≥ 23). `pi` runs the base
   coding agent; nothing kernel-related loads yet.
2. **Global config = the pi-config repo** (`Lascari AI/pi-config`).
   `./link.sh` symlinks the managed set (`settings.json`, `models.json`,
   `keybindings.json`, `AGENTS.md`, `extensions/`, `skills/`, `themes/`)
   into `~/.pi/agent/`. Machine-local state (`auth.json`, `sessions/`) stays
   real files. New machine: clone → `(cd .pi && pnpm install)` → `./link.sh`.
3. **The extension pointer** — pi-config's `settings.json` `extensions`
   array points at this repo's `packages/tui/src/extension.ts`, and its
   `skills`/`prompts` arrays point at this repo's `skills/` and `prompts/`.
   Because the settings are global, every pi session on the machine
   registers `/kernel` — no per-repo setup, no `/trust` needed (trust gates
   project-local `.pi/` resources only).
4. **The repo's kernel** — `/kernel`'s roster comes from the cwd: any
   `.agent-kernel/kernel.json` found up-tree contributes its catalog roots
   (project agents), and this repo's `catalog/` is always the generic
   fallback. Repos need nothing TUI-specific.

## Use

In any directory:

```
pi                              # ordinary pi session; extension is passive
/kernel                         # table of resolvable agents (project + generic)
/kernel <name>                  # soft-reboot this session as that agent
/kernel <name> --fixture <id>   # seed ③ from a named state fixture
/prime-agent [agent]            # orient in the cwd's agent system (template)
```

Resolution is project-first: the cwd repo's `.agent-kernel/kernel.json`
catalog roots shadow the generic catalog in `agent-kernel/catalog/`.
The boot notice reports the assembled prompt size, bound tools, and any
`built-ins disabled: …` line from the bundle's `disallowedTools` policy
(enforced by blocking at `tool_call` while the agent is active). Rows marked
`⊘ can't run in TUI` are `host:"app"` bundles — boot those through their
owning app harness; they are never evaluated here.

## Adding an agent

Author a folder-form bundle (see
[`docs/30-authoring/`](../../docs/30-authoring/00-overview.md)):

- **Generic** (available everywhere): under this repo's `catalog/`. Declare
  `host: "any"` and keep every sidecar Node-portable.
- **Repo-specific**: under a catalog root of that repo's kernel. Same name
  as a generic agent = it shadows it in that repo.
- Guardrails: to force mutations through the bundle's own typed tools, add a
  `tools/` sidecar and `disallowedTools: ["write", "edit"]` — reads stay
  open (`docs-writer` is the exemplar).

Verify: `bunx agent-kernel-render-prompts --check <catalog>`,
`bunx agent-kernel-doctor --catalog <catalog>` (includes the host
portability check), then a real boot (`pi --mode rpc` headlessly, or
`/kernel <name>` interactively). For tools sidecars the real-pi boot is the
gate — see Troubleshooting.

## Tracing sessions

`/kernel` boots append session-binding markers to the pi transcript;
`bunx agent-kernel-tui-ingest` (batch, idempotent, from this repo) folds
marked sessions into the owning repo's `trace.db`, where the Observatory
renders them with a `tui` badge. pi writes the transcript lazily — at least
one model turn must happen before a session exists on disk. The core harness
(`bun run core-harness`, :4860) additionally serves this repo's catalog and
prompt-edit sessions to the Observatory.

## Development

```
bun test ./packages/tui/src        # from the agent-kernel repo root
bun run typecheck:tui
bun packages/tui/scripts/dry-boot.ts <repo-root> <agent>   # assembled ①②③ (bun-only dev script)
```

The extension runs under pi's **Node** runtime (jiti): keep the import graph
and all `host:"any"` sidecars Node-clean, and verify changes with `pi -p`
and a real `pi --mode rpc` boot — bun-side checks alone have missed three
runtime breaks (bun:sqlite via a barrel, `import.meta.dir`, a typebox
flavor mismatch).

## Troubleshooting

Almost every real failure so far has been one thing: **pi runs extensions
and sidecars under Node (jiti), the kernel ecosystem is bun-first.**

| Symptom | Cause / fix |
|---|---|
| `Failed to load extension … bun:sqlite` | Something in the extension's import graph reached the db package. Import deep db-free kernel subpaths (`agent-registry/registry`), never the barrels. |
| Agent listed as `failed to load` | Its sidecar uses a bun-only API (`import.meta.dir`, `Bun.*`) or a dependency barrel that breaks under pi's module flavors (e.g. typebox). Use `dirname(fileURLToPath(import.meta.url))`; import deep subpaths. |
| Works in `bun test`/doctor, breaks in pi | Doctor proves loadability under *a* Node runtime, not pi's exact dependency graph. Reproduce under pi: `pi --mode rpc` and send `{"type":"prompt","message":"/kernel <name>"}`. |
| `/kernel` shows no generic catalog | The extension resolves `catalog/` relative to its own file — check the settings pointer targets this repo's checkout, not a copy. |
| Booted agent, no session in ingest | No model turn yet (lazy JSONL), or the session predates the markers. |
