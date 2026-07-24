---
covers: "How to set up a host application on top of the Pi Agent Kernel packages without moving app-specific workflow semantics into the kernel."
concepts: [application-setup, host-app, adapter, workspace, create-kernel, read-api, viewer, transcript-recovery, models-process, model-access]
depends-on: [00-overview.md, ../../00-foundation/30-boundaries.md, ../../10-system-design/50-app-adapter-model.md]
---

# Application Setup

A host application is the product-specific layer above the kernel. It owns workflow state, domain tools, routing, product UI, and persistence choices while consuming `@agent-kernel/*` packages for runtime, observability, trace reading, transcript recovery, and viewer primitives.

---

## Mental Model

```text
host app packages
  backend adapter
  database composition
  domain agents/tools/loaders
  transcript-recovery wrapper
  read API mount
  frontend viewer mount
        |
        v
@agent-kernel/* packages
  protocol
  db
  kernel
  viewer-core
  viewer-ui
  viewer-shell
```

The dependency direction is one-way. App code imports kernel packages. Kernel packages must not import app code or know app concepts.

## What Not To Copy From Spectre

Spectre has an `apps/backend/src/agent-kernel/` directory because it was the original extraction site. In Spectre today, many files in that directory are compatibility wrappers or adapter files that forward to `@agent-kernel/kernel` while preserving old import paths.

When starting a new app, do not copy Spectre's `apps/backend/src/agent-kernel/` tree as if it were kernel source. Use it only as a reference for the app-adapter pattern:

- `kernel-instance.ts` shows how Spectre configures `createKernel()`.
- `run-context.ts` shows how Spectre maps old session identity onto kernel containers.
- `spawn-pipeline/*` and `subagents/*` contain many transitional re-export shims.
- Spectre-specific loaders, tools, phase transitions, and `SessionStateManager` stay in Spectre.

A new app should create a small adapter surface with app-owned names and import kernel package exports directly.

## Step 1: Link The Kernel Packages

During active development, use either a workspace/submodule or local workspace package path:

```json
{
  "workspaces": [
    "apps/*",
    "packages/pi-agent-kernel/packages/*"
  ]
}
```

Then app packages can depend on kernel packages with `workspace:*`:

```json
{
  "dependencies": {
    "@agent-kernel/kernel": "workspace:*",
    "@agent-kernel/protocol": "workspace:*",
    "@agent-kernel/db": "workspace:*",
    "@agent-kernel/viewer-core": "workspace:*",
    "@agent-kernel/viewer-shell": "workspace:*",
    "@agent-kernel/viewer-ui": "workspace:*"
  }
}
```

After package contracts stabilize, published package versions can replace `workspace:*`.

## Step 2: Open The Kernel Database

The kernel stores observability rows in one local SQLite file per kernel. Open it during backend startup and write the local kernel manifest:

```ts
import {
  ensureKernelObservabilitySchema,
  kernelDatabasePath,
  openKernelDatabase,
  writeKernelManifest,
} from "@agent-kernel/db";

const handle = openKernelDatabase({ path: kernelDatabasePath(appRoot) });
await ensureKernelObservabilitySchema(handle.db);
await writeKernelManifest(appRoot, {
  kernelId: "my-app",
  displayName: "My App",
  piSessionsDir: ".agent-kernel/pi-sessions",
  viewerBaseUrl: "http://127.0.0.1:5174",
});
```

The app keeps its own workflow tables wherever it likes and links them to kernel rows through container `kind` + `key` — the kernel derives container ids deterministically, so the app never stores hashed grouping ids of its own.

## Step 3: Create A Kernel Instance

The app adapter creates the kernel instance from one config object. App-shaped behavior enters through the function slots (`appContext`, `loaders`, `sharedTools`); everything else is data.

```ts
import { createKernel } from "@agent-kernel/kernel";

export function createAppKernel(db: KernelDatabase) {
  return createKernel({
    id: "my-app",
    db,
    catalog: { roots: [agentCatalogDir] },
    models: {
      aliases: { strong: "provider/big-model", fanout: "provider/small-model" },
      prices: { "provider/big-model": { inputPerMTok: 3, outputPerMTok: 15 } },
    },
    toolProfiles: { reader: ["read", "glob", "grep"] },
    loaders: [myWorkflowLoader],
    toolRuntime: appToolRuntime,
    appContext: ({ agentName, cwd, options }) => ({ stateManager, sessionData }),
    piSessionsDir: ".agent-kernel/pi-sessions",
    concurrency: { maxBackgroundAgents: 4 },
  });
}
```

The instance exposes `spawnAgent` (with manifest `variant` selection and model-alias resolution), `container()`, `agentManager`, `traceWriter`, `readApiService`, `registry()`, `doctor()`, and `dispose()`. Spawns require a `containerId` — derive one with `kernel.container({ kind, key })` and pass it in the spawn options along with the run `trigger`.

### Private Tool Sidecars

Agent-specific private tools should live beside the agent manifest:

```text
src/agent-catalog/report-writer/
  agent.json
  prompt.json
  prompt.rendered.md
  context.ts
  tools.ts
```

`agent.json` declares the durable agent config; `prompt.json` is the canonical prompt document; the code sidecars attach by filename convention. `tools.ts` implements the tools for that one agent:

```ts
import { Type } from "@mariozechner/pi-ai";
import { defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools((pi, runtime) => {
  pi.registerTool({
    name: "write_report",
    label: "Write report",
    parameters: Type.Object({ content: Type.String() }),
    async execute(_toolCallId, params) {
      return runtime.writeReport(params);
    },
  });
});
```

The kernel binds the sidecar to the config `toolRuntime` at spawn time; the registry harvests the tool names at boot so they enter the allowlist automatically.

Shared tools that should be available across many agents can still come from the `sharedTools` config slot. Tools that only make sense for one agent should use the colocated `tools.ts` path so the implementation, prompt, and manifest stay together.

### Model Access: The Models Process, Not Auth

Kernels do not use interactive provider auth. The standard pattern is that every kernel points at the local **models process** — a proxy/load-balancer endpoint that owns the real provider credentials — through a custom provider in the `piAgentDir` `models.json`:

```json
{
  "providers": {
    "codex-lb": {
      "baseUrl": "http://127.0.0.1:2455/backend-api/codex",
      "api": "openai-responses",
      "apiKey": "<local proxy token>",
      "models": [{ "id": "gpt-5.5", "reasoning": true, "input": ["text", "image"] }]
    }
  }
}
```

- `auth.json` in the `piAgentDir` stays an empty object (`{}`) — no `/login` flow, no provider keys on disk in any kernel.
- The `apiKey` here is a token for the local proxy, not an upstream provider secret; the proxy holds upstream credentials in one place for all kernels.
- Agent manifests and kernel `models.aliases` resolve to model ids served by the proxy provider, so retargeting a fleet is still one config edit.
- This keeps kernels headless-safe (no interactive auth on boot) and makes model routing observable at a single endpoint.

`examples/simple-research-kernel/.pi-agent/` is the reference: a `codex-lb` provider in `models.json`, an empty `auth.json`. New kernels should copy that shape.

## Step 4: Define App Container Mapping

The kernel uses containers as the portable grouping primitive. The app keeps its own workflow rows and maps them to containers by kind + key:

```ts
const container = await kernel.container({
  kind: "session",
  key: [appSessionRowId],
  label: topic,
  metadata: { app: "my-app" },
});
```

The same kind and key always resolve to the same container id, so the mapping needs no join table. Use app-owned workflow tables for product semantics. Use kernel rows for runtime and observability.

## Step 5: Register Custom Loaders App-Side

Kernel loaders should stay generic. App-specific loaders should live in the host app and be passed through the `loaders` config slot.

```ts
const myWorkflowLoader = {
  kind: "my-workflow-slice",
  async resolve(decl, ctx) {
    const state = await loadMyWorkflowState(ctx.containerId);
    return {
      status: "ok",
      content: JSON.stringify(state, null, 2),
      bytes: 0,
      hash: "",
    };
  },
};
```

If a loader reads app tables, app artifacts, or product workflow state, it belongs in the app adapter.

## Step 6: Emit App Events Through The Trace Writer

Use `@agent-kernel/protocol` factories for app-level trace events and write them through the kernel's trace writer. Identity comes first as a single `ids` object; inside a run scope, build it with `currentTraceIds()`.

```ts
import { createPhaseStartEvent } from "@agent-kernel/protocol";

kernel.traceWriter.submit(
  createPhaseStartEvent({ containerId: container.id }, "build"),
);
```

The app decides when domain-level events happen. The event protocol gives those events a portable shape. Runtime events (messages, tools, turns, usage) are emitted by the kernel's in-process emitter automatically.

## Step 7: Backfill When Needed

The primary trace path is in-process emission; there is no tailer daemon to run. Reach for the kernel's transcript-recovery module (`@agent-kernel/kernel/transcript-recovery`) as a recovery tool: `runBackfill({ jsonlDir, db })` re-imports Pi JSONL transcripts idempotently after a crash, or imports sessions that ran outside the kernel. Marker custom types are configurable if compatibility names are needed.

## Step 8: Mount The Kernel Read API

The read API route factory lives in `@agent-kernel/kernel/read-api`, and the kernel instance ships a default container-backed service:

```ts
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";

app.use(createKernelTraceReadApi(kernel.readApiService));
```

Keep product routes separate from kernel read routes. Product routes can join app workflow state; kernel read routes should return viewer-core DTOs.

## Step 9: Mount The Viewer

The base viewer path is:

```text
read API response
  -> @agent-kernel/viewer-core transforms
  -> @agent-kernel/viewer-shell KernelTraceViewer
```

The host app owns surrounding navigation, headers, filters, and workflow panels. Generic trace tree behavior belongs in viewer packages; domain interpretation belongs in the host app.

## Step 10: Add Boundary Tests

Every host app should have a portability check:

- kernel packages do not import app packages
- kernel packages do not reference app paths
- app-specific loader names do not appear in kernel packages
- app packages depend on exported kernel package paths
- no duplicate local copies of `@agent-kernel/*` exist outside the chosen package source

This turns the adapter boundary into a testable contract instead of a convention.

## Minimal App Checklist

- Link or install `@agent-kernel/*`.
- Open the kernel SQLite database, ensure the schema, and write the kernel manifest on backend startup.
- Create app workflow tables and map them to containers by kind + key.
- Create a small app kernel adapter with `createKernel(config)`.
- Colocate per-agent private tools in agent `tools.ts` sidecars and pass an app `toolRuntime`.
- Register app-owned custom loaders through the `loaders` config slot.
- Keep `runBackfill` handy for crash recovery and imports.
- Mount the kernel read API over `kernel.readApiService`.
- Mount `KernelTraceViewer` or compose `viewer-ui` directly.
- Add boundary tests.

## Spectre As Reference

Spectre is useful because it shows a real vertical app using the kernel. It is also noisy because it still carries compatibility paths from the extraction.

Read Spectre this way:

```text
packages/pi-agent-kernel/packages/*   kernel source of truth
apps/backend/src/agent-kernel/*       Spectre backend adapter and compatibility shims
apps/backend/src/agent-catalog/*      Spectre agents, tools, and custom loaders
apps/database/*                       Spectre schema composed with kernel schema
apps/transcript-recovery/*            Spectre transcript-recovery wrapper
apps/frontend/*                       Spectre viewer mount and workflow UI
```

That separation is the template for a new application.
