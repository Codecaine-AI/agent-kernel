---
covers: "How to author an agent state sidecar: choosing a file shape, implementing defineState, configuring the conversation window, and adding preview fixtures."
concepts: [agent-authoring, state-sidecar, define-state, state-fixture, window-policy, rendered-state]
code-ref: packages/kernel/src/state/, packages/kernel/src/agent-definition/index.ts, packages/kernel/src/agent-registry/registry/state-fixtures.ts
depends-on: [00-overview.md, ../20-implementation/20-kernel/60-agent-state.md, ../10-system-design/60-prompt-system-model.md]
---

# State Sidecar

Add or change the state sidecar when the agent needs a live working picture in section ③ of each provider request. Use `state.ts` for a small sidecar or `state/index.ts` when the implementation needs supporting modules. Both forms are permanent; when both entry points exist, the file form wins.

An agent that needs only a rolling conversation window can omit the sidecar and configure `state.window` in `agent.json`. Omit both the sidecar and window config for pass-through behavior. The rationale and rejected alternatives are D81–D99 in [60-prompt-system-model.md](../10-system-design/60-prompt-system-model.md).

---

## Implement `defineState`

Export `state` or a default value created with `defineState`:

```ts
import { defineState } from "@agent-kernel/kernel/agent-definition";
import { kernelStateMessage, renderRollingWindow } from "@agent-kernel/kernel/state";

interface WorkState {
  objective: string;
  eventsSeen: number;
}

export const state = defineState<WorkState>({
  seed(ctx, prior) {
    return prior ?? { objective: String(ctx.variables.objective ?? ""), eventsSeen: 0 };
  },
  update(current, event) {
    return { ...current, eventsSeen: event.seq + 1 };
  },
  render(current, ctx) {
    const tail = renderRollingWindow(ctx);
    return {
      messages: [
        kernelStateMessage(`<state events-seen="${current.eventsSeen}" />`),
        ...tail.messages,
      ],
      stateMessageCount: 1 + (tail.stateMessageCount ?? 0),
    };
  },
});
```

Replace the placeholder `update` and `render` behavior with the agent's domain rules:

- `seed` builds the initial `S` from `SpawnContext`; use `prior` only when the caller explicitly supplies continuity.
- `update` returns the next `S` for each ordered session event. Keep it as the single writer, including changes requested through private tools.
- `render` emits section ③: leading state message(s), followed by the real conversation messages the agent should retain. Set `stateMessageCount` to the number of leading state messages.
- Keep `S` JSON-serializable. The kernel treats it as opaque and snapshots it to `state.json`.
- Window over `ctx.messages`; do not duplicate the transcript inside `S`.

The complete event shapes, render output rules, persistence behavior, and activation gate live in [Agent State](../20-implementation/20-kernel/60-agent-state.md).

## Configure the Window

Put the durable per-agent policy in `agent.json`:

```json
{
  "state": {
    "window": {
      "strategy": "turns",
      "maxTurns": 8,
      "maxImages": 4,
      "elisionMarker": true
    }
  }
}
```

Use `"token-budget"` with `maxTokens` when a turn count is the wrong bound. Cuts always land on turn boundaries, so a tool call is never separated from its result. A spawn override wins over `agent.json`, which wins over the sidecar's optional `window`, which wins over kernel defaults.

## Add Preview Fixtures

Put JSON envelopes in `state/fixtures/`. Keep `default.json` as the baseline and name additional files for materially different render states, such as `empty-queue.json` or `stale-base.json`:

```json
{
  "label": "Stale base",
  "variables": { "objective": "Reconcile the branch" },
  "state": {
    "objective": "Reconcile the branch",
    "eventsSeen": 4
  }
}
```

The envelope is `{ label?, variables?, state }`. `variables` overlays manifest defaults for the preview `SpawnContext`; `state` is an `S` sample supplied as explicit prior state before rendering. Fixtures feed previews and tests only. They never load in a real spawn.

Open the agent lab's State view after changing `seed`, `render`, variables, or a fixture. The State view appears only when the bundle has discoverable fixtures.
