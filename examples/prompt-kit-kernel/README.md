# Prompt Kit Kernel

Standalone development harness for the first-party `prompt-editor` agent. It
lives under `agent-kernel/examples/` because it is a runnable kernel host that
depends on Prompt Kit; placing it inside the `prompt-kit` library would invert
that dependency.

The kernel exposes only `agent-kernel/catalog`, which contains the
`prompt-editor` bundle. Its valid edit target is `prompt-editor` itself:
recursive self-editing is intentional in this standalone harness. Other
projects' agents are not included in the Prompt Kit catalog.

Runtime state is isolated under this directory's `.agent-kernel/`, including
`trace.db`, `kernel.json`, prompt-edit session directories, and Pi session
transcripts. Each launched edit gets a kernel session container, so its agent
run appears in Observatory's trace viewer with active/done/error lifecycle.

## Start

From the `agent-kernel` repository root:

```bash
bun run dev:prompt-kit
```

The API listens on `http://127.0.0.1:4850`. Override the port with
`PROMPT_KIT_KERNEL_PORT`. Override the prompt-editor model alias with
`PROMPT_KIT_KERNEL_PROMPT_EDITOR_MODEL`.

By default the harness reuses the Simple Research example's local
`.pi-agent/` models-process configuration. Set `PROMPT_KIT_KERNEL_PI_AGENT_DIR`
to use another Pi agent directory. This directory must contain the usual empty
`auth.json` plus a `models.json` that defines the model selected above.

## Observatory

1. Start this kernel with `bun run dev:prompt-kit`.
2. Start Observatory from the Core checkout with `make observatory`.
3. Open `http://127.0.0.1:4891`.
4. Under **Projects → Prompt Kit**, click **Agents**.
5. Select **prompt-editor** to inspect its manifest and structured prompt.
6. Under **Projects → Prompt Kit**, click **Traces** to inspect prompt-editor
   session runs in the trace viewer.

Observatory probes `GET /health`. Catalog, annotation, prompt-edit session, and
trace-read routes are mounted under the plain `/kernel` prefix.
