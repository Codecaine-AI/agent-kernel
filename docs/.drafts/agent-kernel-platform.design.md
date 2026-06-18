# Agent Kernel Platform — Repo Split Design

**Status:** Draft / proposal
**Date:** 2026-06-10
**Scope:** Top-level repo topology for extracting the agent kernel into a reusable platform, with Spectre repositioned as the reference application built on top of it.

---

## 1. Vision

The agent kernel is a general-purpose **agent runtime + observability platform**: it spawns agents from declarative definitions, assembles their context, runs them through the Pi SDK, and — critically — makes everything they do **viewable**. Observability is not a side feature; it is the kernel's product. You cannot design agent processes well if you cannot watch them run.

An **application** (Spectre being the first) defines *what the agents do*: the agent definitions, the workflow state machines (sessions → phases → checkpoints), the domain tools, and the workflow-specific frontend. The application's frontend *is* its workflow logic — the kernel supplies the runtime and the viewing primitives underneath it.

Spectre becomes the reference implementation: "here is how you build a coding harness on top of the agent kernel." Future platforms (other agent process designs) reuse the kernel and define their own agent types, context loaders, state models, and frontend shells.

---

## 2. Repo Topology

Three repos:

```
agent-kernel/        Platform monorepo (Bun workspace). Submoduled or published into consumers.
docs-framework/      Claude Code plugin (skills + commands + templates + audit tooling).
spectre/             Reference application: coding harness built on agent-kernel.
```

### 2.1 `agent-kernel` — platform monorepo

```
agent-kernel/
├── packages/protocol/     Event + trace + run type definitions. THE contract.
│                          Everything else (kernel, db, tailer, viewer) keys off this.
├── packages/kernel/       Spawn pipeline, agent registry + frontmatter parsing,
│                          context assembler + base loaders (file, directory, command,
│                          text, skill), subagent manager, domain guard, streaming,
│                          turn limits, tool-factory mechanism.
├── packages/db/           Kernel-owned tables as exported Drizzle schema + query
│                          helpers: pi_agent_sessions, agent_runs, events/trace.
├── packages/tailer/       Pi JSONL → DB ingestion (watcher, mapper, queue, cursor).
│                          Moves from apps/tailer nearly as-is.
├── packages/viewer-core/  Data layer: protocol-typed API client, SSE client,
│                          query hooks. No rendering.
├── packages/viewer-ui/    Headless-ish components: trace tree, run inspector,
│                          streaming transcript, container browser.
└── packages/viewer-shell/ The base UI. A mountable application component
                           (<KernelViewer/>) with plugin slots — every vertical
                           ships this; customization happens through registered
                           panels, not forks. See §5.
```

### 2.2 `docs-framework` — companion plugin

- Separate repo, packaged as a Claude Code plugin (skills + commands bundle).
- The kernel has **no hard dependency** on it. The kernel needs the *context-loading
  mechanism* (skill loader against a `SkillRegistry` interface); the docs framework is
  *content* that mechanism loads, plus the methodology for producing it.
- In practice every app ships with it attached: the kernel distribution documents it as
  the default companion, and the skill/context loader interfaces are the injection
  points. Swapping in different doc conventions must remain possible without touching
  kernel code.

### 2.3 `spectre` — reference application

Keeps: agent definitions (intake/spec/plan/build/docs/completion), app services
(spec/plan/build pipelines, state manager), app DB schema, API routes, frontend shell
with workflow UX (spec editor, plan view, checkpoint board), session skills,
worktree/git machinery.

Consumes: `agent-kernel` as a workspace submodule (`packages/platform/` or similar)
during co-development; published packages once the API stabilizes and a second
consumer exists.

---

## 3. First-Class Concepts: Kernel vs Application

The dividing principle:

> **The kernel owns identity and grouping for observability.
> The application owns workflow semantics.**

The kernel must be able to answer "what ran, under what container, spawned by whom,
and what happened" — generically, for any app. It must NOT know what a phase *means*,
when a checkpoint is *done*, or how state transitions are gated.

### Kernel first-class nouns

| Noun | Notes |
|------|-------|
| **Agent definition** | `agent.md` frontmatter + context resolver + private tools. Registry walks, parses, validates at boot. |
| **Run** (`agent_runs`) | One spawn. Carries `parentRunId` (run tree), status, timing. |
| **Pi session** (`pi_agent_sessions`) | Pi SDK conversation identity + JSONL location. |
| **Container** | Minimal generic grouping of runs: id, label, working dir / worktree, status, opaque app metadata. The viewer's unit of "watch this work stream." |
| **Phase vocabulary** | A container declares an ordered list of phase labels (e.g. `["spec", "plan", "build"]`). Pure data — the kernel/viewer use it to organize runs into a phase timeline; only the app knows what a phase means or when it transitions. Orchestration-with-phases recurs in ~every vertical, so the *shape* is kernel-side while the *semantics* stay app-side. |
| **Run labels** | `phase`, `containerId`, `displayLabel` already exist in `SpawnOptions` — today they're Spectre DB columns; they become **opaque kernel grouping fields**. The kernel stores and displays them; only the app interprets them. |
| **Trace / lifecycle events** | Defined in `packages/protocol`, emitted by kernel, ingested by tailer, rendered by viewer. |
| **Context loader** | Extensible catalog; base kinds ship with kernel, apps register custom kinds. |
| **Tool** | Private (per-agent) and shared tool *mechanisms*. Concrete domain tools are app-side. |

### Application first-class nouns (Spectre's exemplars)

| Noun | Notes |
|------|-------|
| **Session** (Spectre's) | Long-lived work unit with spec/plan/build phase slices. Maps 1:1 onto a kernel **container**; the app row FKs to the kernel container row and adds workflow state. |
| **Phase** | Spec / plan / build semantics, transitions, gating. App state machine. Kernel sees only the opaque `phase` label on runs. |
| **Checkpoint** | Plan/build structure within a phase. Pure app concept — the kernel groups runs, it does not understand task graphs. |
| **Pending asks** | App-side (per decision below). |
| **Domain tools** | `ask`, `plan_set_outline`, `session_set_status`, etc. — all write app tables. |
| **Custom loaders** | `checkpoint-slice` is the template: app-registered loader that reads app state. |

### Decision: sessions and checkpoints

- **Checkpoints/phases: app-side, unambiguously.** They are workflow semantics. A
  different platform might have stages, episodes, tickets, or nothing.
- **Sessions: split the concept.** The *grouping* half (a container of runs with a
  label, a working directory, a lifecycle status) is kernel-first-class — without it,
  every app reinvents grouping and the viewer cannot render run trees generically.
  The *workflow* half (phase slices, spec/plan/build state) is app-side. Spectre's
  `sessions` table decomposes into kernel `containers` row + Spectre session-state row.

### Decision: pending asks

App-side for v1 — current implementation writes Spectre tables and the resume helper
is coupled to Spectre's session model. Flagged as a **promotion candidate**: the
underlying mechanism (pause a run, surface a question to a human, resume with the
answer) is a generic human-in-the-loop primitive that most platforms will want. Promote
once a second app needs it and the generic shape is clear.

---

## 4. Data Ownership

- **Kernel tables** (in `packages/db`): `containers`, `pi_agent_sessions`,
  `agent_runs`, trace/event tables. Kernel owns the schema and exports Drizzle table
  objects.
- **App tables** (in Spectre): session workflow state, phase slices, pending asks —
  foreign-keying **into** kernel tables (app → kernel, never the reverse).
- **One database, one migration pipeline:** the app imports the kernel's exported
  schema objects into its own Drizzle config, so a single `drizzle-kit migrate` covers
  both. The kernel does not abstract persistence behind a port — owning the
  observability schema outright is what lets tailer and viewer work identically across
  apps.

---

## 5. Frontend: Viewer as Foundation

Premise: every system built on the kernel will have a UI, and that UI's spine is
always the tracing/observability surface — it is how you verify your agent processes
are designed and running properly. So the viewer is not a component library the app
optionally embeds; it is the **base UI every vertical starts from and customizes**.

Three models were considered for "base UI with customization":

1. **Component library only** — app owns the shell, imports trace components.
   Rejected as the primary model: every vertical rebuilds the shell, consistency
   erodes, day-zero viewability is lost.
2. **Fork/template starter app** — copy a reference app and modify. Rejected:
   forks immediately drift; kernel UI improvements never reach existing verticals.
3. **Plugin-slot shell** — **chosen.** The kernel ships the base UI as a mountable
   application component with registration points. The vertical's app (Next.js or
   otherwise) owns routing, auth, and deployment, and mounts the shell; all
   customization flows through registered panels rather than forked source.

Sketch of the slot contract:

```tsx
<KernelViewer
  api={kernelApiClient}
  plugins={{
    // Keyed off the opaque labels the kernel already stores (§3).
    phasePanels:     { spec: SpecEditorPanel, plan: PlanBoardPanel, build: CheckpointBoard },
    containerHeader: SessionHeader,        // app metadata rendered above run views
    runDecorators:   [diffBadge, costBadge],
  }}
/>
```

- Base shell renders generically with **zero plugins**: container browser, phase
  timeline (from the container's phase vocabulary), run tree, trace inspector,
  live transcripts. That is the day-zero guarantee.
- The vertical registers **phase panels** keyed to its phase labels — Spectre's spec
  editor, plan view, and checkpoint board become registered panels, not a separate
  app surrounding the viewer.
- Layering: `viewer-core` (data) → `viewer-ui` (components) → `viewer-shell`
  (slot-bearing shell). Verticals needing deeper divergence can drop down a layer
  and compose `viewer-ui` directly — the escape hatch that keeps the slot API from
  having to anticipate everything.

---

## 6. Decoupling Work Required (kernel-side)

The DB-port abstraction considered earlier is **rejected** — replaced by the schema
split (§4). Remaining work, all mechanical:

1. `SpawnContext.sessionData` → generic `TSessionData` (phase types are app state).
2. `RunContext.SessionStateManager` → narrow interface; app supplies implementation.
3. Move `checkpoint-slice` loader to Spectre; register via the loader catalog.
4. Lifecycle emitter consumes `packages/protocol` types instead of
   `@spectre/database/events` (a code move once protocol exists).
5. Path constants (`PI_SESSIONS_DIR`, `PI_AGENT_DIR`) → injected config object.
6. Shared-tools split: factory mechanism stays kernel; concrete tools move app-side.
7. Genericize `containerId` / `phase` / `displayLabel` as opaque grouping columns on
   kernel tables (§3).

---

## 7. Migration Sequencing

1. **In-repo extraction.** Create `packages/` inside Spectre
   (`workspaces: ["apps/*", "packages/*"]`); move kernel code into the package
   shape of §2.1; do the §6 work. Viewer extraction can lag the backend packages —
   start it by carving Spectre's existing trace components into `viewer-ui`.
2. **Boundary enforcement.** Lint rule: no `@spectre/*` imports inside `packages/`.
   Prove Spectre runs fully on the seam while iteration is still single-commit.
3. **Repo split.** New `agent-kernel` repo; consume as git submodule pinned by SHA.
4. **Publish later.** Move to a private registry once the API stabilizes and a second
   consumer exists.
5. **Order within step 1:** `packages/protocol` first — tailer, viewer, kernel, and
   db all converge on it, and it is what makes the viewer portable.

---

## 8. Open Questions

- **Container naming.** "Session" collides with Pi sessions and Spectre sessions;
  "container" collides with Docker. Candidates: `container`, `workspace`, `workstream`.
- **Viewer ↔ backend API surface.** With viewer-as-foundation (§5), the kernel almost
  certainly ships a read API too — likely an Elysia route module the app mounts, so
  `viewer-core` targets a stable, kernel-versioned API rather than each app's routes.
  Confirm, and decide where SSE fan-out lives (kernel route module vs app).
- **Slot API surface.** Which extension points exist at v1 (phase panels, container
  header, run decorators?) and how stable they must be — this is the platform's de
  facto public frontend API, and slot churn breaks every vertical.
- **Tailer deployment.** Stays a standalone process per app, or becomes embeddable in
  the app backend?
- **Skill-library placement.** The backend `skill-library/` registry mechanism is
  kernel-shaped; its content (docs-framework, spec-writing, idk-vocab) is app/companion
  content. Likely: mechanism → kernel, content → app + docs-framework plugin.
- **Ask promotion.** Criteria and timing for promoting human-in-the-loop asks into the
  kernel (§3).
