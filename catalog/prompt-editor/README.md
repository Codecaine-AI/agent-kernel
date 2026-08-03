# prompt-editor

First-party kernel agent that edits another agent's PromptDocument on behalf
of a human, driven by an annotation request queue (the prompt-lab
annotate → agent-edit → inline-review loop).

Folder-form bundle per `bundle-layout.ts`:

- `agent.json` — manifest; declares the one variable `targetAgent`.
- `prompt/prompt.json` — canonical PromptDocument (source of truth; semantic
  node ids, layout-editor conventions). `prompt/system.md` is the generated
  render — regenerate with `bunx agent-kernel-render-prompts --agent <dir>`.
- `context/index.ts` — three standing blocks: `<prompt_kit_authoring>` (key
  files of `skills/prompt-kit-authoring/`, via kernel `file` loaders),
  `<target_prompt>` and `<requests>` (session-service payload via
  `sessionData`, placeholder-degrading).

Session-service contract (Phase 1 track: session service + tools v1):

- `variables.targetAgent` — catalog name of the agent being edited.
- `sessionData.targetPromptRender` — target prompt rendered with node ids.
- `sessionData.targetPromptHash` — canonical `pk1-…` hash proposals build on.
- `sessionData.requestQueue` — rendered R-alias queue (target, note, thread).
- Tools v1 the prompt is written against: `read_prompt`,
  `propose_transaction`, `resolve_request`, `reply_request`, `add_note`.
  Registration is service-side (no `tools/` sidecar here yet); a `tools/`
  sidecar can be added without touching the prompt as long as names and
  behavior hold.

Gate: `catalog/prompt-assembly.test.ts` (registry discovery, canonical bytes,
variable validation, snapshot freshness, section shape, context assembly).
