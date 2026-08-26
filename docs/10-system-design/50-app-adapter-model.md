---
covers: "App adapter design: how host applications compose kernel packages while keeping workflow state, tools, loaders, routes, and panels app-owned — the adapter surface, container mapping, app-side loaders and events, transcript recovery, read API and viewer integration, and the models-process access pattern."
concepts: [app-adapter, host-app, spectre-adapter, custom-loader, custom-tool, container-mapping, tool-sidecar, models-process, transcript-recovery, read-api, viewer]
depends-on: [../00-foundation/30-boundaries.md, 10-runtime-model.md, 40-viewer-model.md]
---

# App Adapter Model

An app adapter turns the generic kernel into a product-specific agent system. It should be explicit, testable, and mostly one-way: app code depends on kernel packages, kernel packages know nothing about the app. That dependency direction is the important contract; git topology and package linking are delivery mechanisms. The structural decisions that enforce the boundary live in [20-implementation/70-app-adapters.md](../20-implementation/70-app-adapters.md).

---

## Adapter Responsibilities

An app adapter typically provides:

- kernel instance configuration (`createKernel` config: catalog roots, db handle, model aliases and prices, tool profiles)
- app domain to kernel container mapping (kind + key vocabulary)
- shared tool factories and an app tool runtime for private sidecars
- custom context loaders
- run-context app state through `appContext`
- app-specific event emission through the trace writer
- read API mount and response mapping
- viewer plugins and custom payload renderers

## The Adapter Surface

The adapter creates the kernel instance from one config object. App-shaped behavior enters only through the function slots — `appContext`, `loaders`, `sharedTools`, `toolRuntime` — and everything else is data:

```ts
createKernel({
  id, db,
  catalog: { roots: [agentCatalogDir] },
  models: { aliases: { strong: "provider/big-model" }, prices: { … } },
  toolProfiles: { reader: ["read", "glob", "grep"] },
  loaders: [myWorkflowLoader],
  toolRuntime: appToolRuntime,
  appContext: ({ agentName, cwd, options }) => ({ stateManager, sessionData }),
  concurrency: { maxBackgroundAgents: 4 },
});
```

The instance exposes `spawnAgent` (with manifest `variant` selection and model-alias resolution), `container()`, `agentManager`, `traceWriter`, `readApiService`, `registry()`, `doctor()`, and `dispose()`. Spawns require a `containerId` — derived with `kernel.container({ kind, key })` — and a run `trigger`.

At startup the adapter opens the kernel's per-kernel SQLite database, ensures the observability schema, and writes the local kernel manifest (`@agent-kernel/db`: `openKernelDatabase`, `ensureKernelObservabilitySchema`, `writeKernelManifest`).

## Container Mapping

The kernel uses containers as the portable grouping primitive. The app keeps its own workflow tables wherever it likes and links them to kernel rows by container `kind` + `key`:

```ts
const container = await kernel.container({
  kind: "session",
  key: [appSessionRowId],
  label: topic,
  metadata: { app: "my-app" },
});
```

The same kind and key always resolve to the same container id, so the mapping needs no join table and the app never stores hashed grouping ids of its own. App workflow tables carry product semantics; kernel rows carry runtime and observability.

## App-Side Tools

Agent-specific private tools live in the bundle's tools sidecar beside the agent manifest (`defineTools((pi, runtime) => …)` from `@agent-kernel/kernel/agent-definition`); the kernel binds the sidecar to the config `toolRuntime` at spawn time, and the registry harvests tool names at boot so they enter the allowlist automatically. Tools that many agents need come from the `sharedTools` config slot instead. The runtime object is the app's callback surface — it is how sidecar tools reach app-owned state without the kernel learning app concepts.

## App-Side Loaders

Kernel loaders stay generic. A loader that reads app tables, app artifacts, or product workflow state belongs in the host app and enters through the `loaders` config slot as a `{ kind, resolve(decl, ctx) }` object. Spectre's `checkpoint-slice` is the canonical example.

## App Events Through The Trace Writer

The app decides when domain-level events happen; the event protocol gives them a portable shape. App code builds events with `@agent-kernel/protocol` factories — identity first, as a single `ids` object (inside a run scope, `currentTraceIds()`) — and submits them through `kernel.traceWriter`. Runtime events (messages, tools, turns, usage) are emitted by the kernel's in-process emitter automatically; the adapter never synthesizes those.

## Transcript Recovery

The primary trace path is in-process emission — there is no tailer daemon. The kernel's transcript-recovery module (`@agent-kernel/kernel/transcript-recovery`) is a recovery tool, not a running process: `runBackfill` re-imports Pi JSONL transcripts idempotently after a crash, or imports sessions that ran outside the kernel. Marker custom types are configurable where compatibility names are needed.

## Read API And Viewer

The kernel instance ships a default container-backed read API service, mounted through the route factory in `@agent-kernel/kernel/read-api`. Product routes stay separate from kernel read routes: product routes may join app workflow state; kernel read routes return viewer-core DTOs.

The base viewer path is read API response → `@agent-kernel/viewer-core` transforms → `@agent-kernel/viewer-shell` `KernelTraceViewer`. The host app owns surrounding navigation, headers, filters, and workflow panels; generic trace-tree behavior belongs in viewer packages, domain interpretation in the host app.

## Model Access: The Models Process, Not Auth

Kernels do not use interactive provider auth. Every kernel points at the local **models process** — a proxy/load-balancer endpoint that owns the real provider credentials — through a custom provider in the `piAgentDir` `models.json`:

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

- `auth.json` in the `piAgentDir` stays an empty object — no `/login` flow, no provider keys on disk in any kernel.
- The `apiKey` is a token for the local proxy, not an upstream secret; the proxy holds upstream credentials in one place for all kernels.
- Agent manifests and kernel `models.aliases` resolve to model ids served by the proxy provider, so retargeting a fleet is one config edit.
- Kernels stay headless-safe (no interactive auth on boot) and model routing is observable at a single endpoint.

`examples/simple-research-kernel/.pi-agent/` is the reference shape: a `codex-lb` provider in `models.json`, an empty `auth.json`.

## The Boundary As A Contract

The adapter boundary is testable, not conventional. Beyond the package-dependency direction (enforced structurally — see the implementation entries), a host app's checks should assert the behavioral half: trace writes carry container ids, subagents carry parent tool-use ids, custom loaders live in the app, and viewer pages consume viewer-core DTOs rather than database schema.

## Spectre Reference Mapping

| Kernel Concept | Spectre Adapter Mapping |
|---|---|
| Container | Spectre session/workflow grouping, with app state kept in Spectre tables |
| Container kind + key | Spectre session id mapped through `kernel.container({ kind: "session", key })` |
| Phase label | `spec`, `plan`, `build`, `docs`, or other Spectre workflow labels |
| Custom loader | `checkpoint-slice`, which reads Spectre plan/build state |
| App state manager | `SessionStateManager` passed through run context |
| Domain tools | Spectre tools that mutate spec, plan, build, docs, projects, or asks |
| Viewer plugin | Spectre session header and phase-specific panels |

Spectre keeps app-side: session rows and phase state, `SessionStateManager`, the spec/plan/build/docs/intake/onboarding services, project/worktree/git behavior, the `checkpoint-slice` loader, domain tools that write Spectre state, durable ask tables, and phase-specific UI panels. It consumes from the kernel: protocol event types and factories, kernel DB tables and query helpers, the spawn pipeline and run context, registry mechanics and prompt revisions, transcript recovery, the read API route factory, and the viewer packages.

## Spectre Compatibility Note

Spectre still has backend files named `apps/backend/src/agent-kernel/*` because the kernel was extracted from that path. In the current split, those files are app adapter code and compatibility shims around the standalone packages — many are transitional re-export wrappers that forward to `@agent-kernel/kernel` while preserving old import paths — not the portable kernel source of truth.

A new app should not recreate the Spectre backend tree. It should create a small app-specific adapter and import kernel package exports directly; the structural decisions for that adapter shape live in [20-implementation/70-app-adapters.md](../20-implementation/70-app-adapters.md). Spectre remains useful as the one real vertical app on the kernel — read `apps/backend/src/agent-kernel/*` as the adapter and its shims, `apps/backend/src/agent-catalog/*` as app agents/tools/loaders, and `apps/frontend/*` as the viewer mount and workflow UI.
