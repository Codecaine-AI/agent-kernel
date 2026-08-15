---
description: Orient in this repo's agent-kernel catalog, report the bundle map, then await a change request
argument-hint: "[agent-name]"
---
Orient in the current repo's agent-kernel catalog. In order:

1. Run the authoring brief for the current working directory. It ships with
   the `kernel-agent-authoring` skill (listed in your available skills) at
   `scripts/brief.ts` inside that skill's directory:
   `bun <skill-dir>/scripts/brief.ts ${1:-}` — the optional argument narrows
   the brief to one agent.
2. Load the `kernel-agent-authoring` skill (read its SKILL.md) for the
   request model, the invariants, and the doc references.
3. Report a compact bundle map from the brief's output: per bundle its name,
   one-line purpose, anatomy (which sections exist and in which form), the
   assembled ② block tags, and a one-line summary of the rendered ③ fixture.
   Call out anything degraded (registry errors, missing roots, error-status
   loaders).

Then stop and await my change request. Do not edit anything yet.
