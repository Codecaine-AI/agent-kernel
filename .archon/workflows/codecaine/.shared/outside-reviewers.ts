/**
 * What tag-outside-reviewers does with one pull request, apart from the forge calls
 * that read and post. The script reads the live head and the comments, asks this, and
 * acts on the answer.
 */

export const OUTSIDE_REVIEWERS_MARKER = 'codecaine-outside-reviewers';

/** The marker line of a tag comment. A comment that holds it tagged that head. */
export function tagMarker(head: string): string {
  return `<!-- ${OUTSIDE_REVIEWERS_MARKER} head=${head} -->`;
}

export type TagDecision =
  /** The pull request moved off the commit the review published about: tag nothing. */
  | { readonly kind: 'head-moved'; readonly reviewed: string; readonly live: string }
  /** A comment already tagged this head: tag nothing. */
  | { readonly kind: 'already-tagged'; readonly head: string }
  | { readonly kind: 'tag'; readonly head: string };

/**
 * `reviewedHead` is the commit the review published about. It is undefined only when an
 * operator runs the script by hand without one; then the live head is tagged as is.
 * `comments` are the bodies of the pull request's comments.
 */
export function decideTag(input: {
  readonly reviewedHead: string | undefined;
  readonly liveHead: string;
  readonly comments: readonly string[];
}): TagDecision {
  const { reviewedHead, liveHead, comments } = input;
  if (reviewedHead !== undefined && reviewedHead !== liveHead) {
    return { kind: 'head-moved', reviewed: reviewedHead, live: liveHead };
  }
  const marker = tagMarker(liveHead);
  return comments.some(body => body.includes(marker))
    ? { kind: 'already-tagged', head: liveHead }
    : { kind: 'tag', head: liveHead };
}
