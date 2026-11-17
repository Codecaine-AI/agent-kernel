export const FULL_REVIEW_RISKS =
  'Full review applies to wire formats and persisted contracts or schemas; concurrency over shared state; isolation, auth, security and credential boundaries; destructive or irreversible paths and data loss; integration boundaries; lifecycle ownership; and parsers over user-authored text. Uncertainty earns full review. Each engaged risk gets an explicit attempt to refute its invariant; a prose-only change gets the minimum.';

/**
 * The review lenses of the codecaine pack: its 2 reviewer nodes. The `output_format` of
 * `mode` names one flag per lens, and `review-complete` reports one state per lens.
 */
export const REVIEW_LENSES = ['review-codex', 'review-claude'] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];
