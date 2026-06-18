---
covers: "How to set up a host application on top of the Pi Agent Kernel packages without moving app-specific workflow semantics into the kernel."
concepts: [application-setup, host-app, adapter, workspace, create-kernel, read-api, viewer, tailer]
depends-on: [00-overview.md, ../../00-foundation/30-boundaries.md, ../../10-system-design/50-app-adapter-model.md]
---

# Application Setup

A host application is the product-specific layer above the kernel. It owns workflow state, domain tools, routing, product UI, and persistence choices while consuming `@agent-kernel/*` packages for runtime, observability, trace reading, tailing, and viewer primitives.

---

## Mental Model

```text
host app packages
  backend adapter
  database composition
  domain agents/tools/loaders
  tailer wrapper
  read API mount
  frontend viewer mount
        |
        v
@agent-kernel/* packages
  protocol
  db
  kernel
  tailer
  viewer-core
  viewer-ui
  viewer-shell
```

The dependency direction is one-way. App code imports kernel packages. Kernel packages must not import app code or know app concepts.

## What Not To Copy From Spectre

Spectre has an `apps/backend/src/agent-kernel/` directory because it was the original extraction site. In Spectre today, many files in that directory are compatibility wrappers or adapter files that forward to `@agent-kernel/kernel` while preserving old import paths.

When starting a new app, do not copy Spectre's `apps/backend/src/agent-kernel/` tree as if it were kernel source. Use it only as a reference for the app-adapter pattern:

- `kernel-instance.ts` shows how Spectre configures `createKernel()`.
- `run-context.ts` shows how Spectre maps old session identity to generic app-session identity.
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
    "@agent-kernel/tailer": "workspace:*",
    "@agent-kernel/viewer-core": "workspace:*",
    "@agent-kernel/viewer-shell": "workspace:*",
    "@agent-kernel/viewer-ui": "workspace:*"
  }
}
```

After package contracts stabilize, published package versions can replace `workspace:*`.

## Step 2: Compose Persistence

The kernel provides reusable schema and read helpers in `@agent-kernel/db`. The host app decides how those tables enter its migration system.

The usual shape is:

```text
app database package
  app workflow tables
  app project/user/session tables
  kernel table exports from @agent-kernel/db/schema
  app-specific actions and joins
```

The app should keep domain workflow rows separate from kernel observability rows. Link them through generic correlation fields such as app session identity or kernel container ids.

## Step 3: Create A Kernel Instance

The app adapter creates the kernel instance and supplies the app-specific spawn implementation.

```ts
import { createKernel, AgentManager } from "@agent-kernel/kernel";

export function createAppKernel() {
  let kernel!: ReturnType<typeof createKernel>;

  kernel = createKernel({
    id: "my-app",
    concurrency: {
      maxBackgroundAgents: 4,
    },
    spawnAgent: async (name, prompt, ctx, opts) => {
      return spawnAgentThroughMyApp(name, prompt, ctx, opts);
    },
    createAgentManager: ({ maxConcurrentBackgroundAgents }) =>
      new AgentManager(undefined, maxConcurrentBackgroundAgents, undefined, {
        spawnAgent: (name, prompt, ctx, opts) => kernel.spawnAgent(name, prompt, ctx, opts),
      }),
  });

  return kernel;
}
```

The spawn adapter is where the host app wires model resolution, app session identity, working directories, trace writers, agent catalog roots, and app run context.

## Step 4: Define App Session And Container Mapping

The kernel uses containers as portable grouping units. The app can keep its own workflow sessions and map them to containers.

```text
app session row
  id
  topic
  workflow status
  current app phase
  kernel_container_id -> kernel containers.id
```

Use app-owned workflow tables for product semantics. Use kernel rows for runtime and observability.

## Step 5: Register Custom Loaders App-Side

Kernel loaders should stay generic. App-specific loaders should live in the host app and be registered into the loader catalog.

```ts
import { createDefaultCatalog } from "@agent-kernel/kernel/context/loaders";

const catalog = createDefaultCatalog();

catalog.register({
  kind: "my-workflow-slice",
  async load(input, ctx) {
    const state = await loadMyWorkflowState(ctx.appSessionId);
    return {
      status: "ok",
      content: JSON.stringify(state, null, 2),
      bytes: 0,
      fromCache: false,
    };
  },
});
```

If a loader reads app tables, app artifacts, or product workflow state, it belongs in the app adapter.

## Step 6: Emit Protocol Events Through A Trace Writer

Use `@agent-kernel/protocol` factories for trace events and write them into the app-composed kernel tables.

```ts
import { createAgentRunStartEvent } from "@agent-kernel/protocol";

await traceWriter.submit(
  createAgentRunStartEvent(appSessionId, userId, runId, agentName, {
    containerId,
    phase,
  }),
);
```

The app decides when domain-level events happen. The event protocol gives those events a portable shape.

## Step 7: Wrap The Tailer

`@agent-kernel/tailer` provides file watching, JSONL reading, event mapping, cursor storage, queueing, and health primitives. The app wrapper supplies:

- watch directory
- cursor snapshot path
- database connection
- queue insert/upsert callbacks
- app-session binding marker names
- lifecycle/subagent custom marker names if compatibility is needed

New apps should prefer generic marker names. Existing apps can configure compatibility names.

## Step 8: Mount The Kernel Read API

The read API route factory lives in `@agent-kernel/kernel/read-api`. The app provides a service that resolves app routes into kernel read DTOs.

```ts
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";

app.use(
  createKernelTraceReadApi({
    async getTraceSessionDetail(id, query) {
      return readKernelTraceForAppSession(id, query);
    },
    async listTraceSessions(query) {
      return listKernelTraceSessions(query);
    },
  }),
);
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
- Add kernel schema to the app migration path.
- Create app workflow/session tables.
- Create a small app kernel adapter with `createKernel()`.
- Provide a spawn adapter and trace writer.
- Register app-owned custom loaders.
- Wrap the tailer if JSONL ingestion is needed.
- Mount the kernel read API.
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
apps/tailer/*                         Spectre tailer wrapper
apps/frontend/*                       Spectre viewer mount and workflow UI
```

That separation is the template for a new application.
