---
covers: QA workflow for PromptKit prompt artifacts.
concepts: [qa, evaluation, rendered-review]
---

# QA

PromptKit QA checks both the authored source and the rendered model-facing text.

Use:

- `10-evaluation.md` for quality dimensions.
- `20-rendered-review.md` for XML-tagged Markdown review.

Minimum QA:

1. Confirm the archetype fits.
2. Confirm every section changes behavior.
3. Confirm runtime values use `variable()` or context policy.
4. Confirm output format is literal enough.
5. Check anti-patterns.
6. Validate or render when practical.
