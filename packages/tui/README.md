# @agent-kernel/tui

The kernel's terminal harness: a pi extension that boots any agent bundle as
an interactive pi session. A peer of the app harnesses (canvas-agent,
prompt-kit-agent) — kernels do not require it.

Model and rationale: [`docs/10-system-design/70-harness-model.md`](../../docs/10-system-design/70-harness-model.md).

## Use

Loaded globally via the pi settings `extensions` pointer (see the pi-config
repo). Then, in any directory:

```
pi                       # ordinary pi session; extension is passive
/kernel                  # table of resolvable agents (project + generic)
/kernel <name>           # boot a bundle into this session
/kernel <name> --fixture <id>   # seed ③ from a named state fixture
```

Resolution is project-first: the cwd repo's `.agent-kernel/kernel.json`
catalog roots shadow the generic catalog in `agent-kernel/catalog/`.
`host:"app"` bundles list as app-harness-only and are never evaluated here;
manifest `disallowedTools` are blocked at `tool_call` while the agent is
active. Boots append session-binding markers so `agent-kernel-tui-ingest`
can fold the transcript into the owning kernel's trace.db.

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
