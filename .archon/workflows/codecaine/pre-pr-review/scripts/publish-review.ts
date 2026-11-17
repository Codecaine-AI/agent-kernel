/**
 * Publish the review report as the pull request's one canonical comment.
 *
 * The reviewer judges and writes the report; this node owns the public write, so
 * every round edits the same marked comment instead of appending another. A review
 * whose scope was a working diff has no pull request and publishes nothing. The
 * verdict passes through unchanged either way: publication is not what makes a
 * review true.
 *
 * This is the review's one head check. A report goes public only about the
 * commit its round fixed at the start (review-round): the checkout must still be
 * at it and the pull request's remote head must be it. The head is checked before the scope agent's declaration, so a
 * correction that was never pushed is named as that rather than as a scope
 * mismatch. Any mismatch refuses, so a verdict about one commit can never
 * stand as the verdict on another. This node stamps that commit and the certified
 * verdict on the comment itself (../../.shared/review-comment.ts) rather than trusting
 * the report's text to name them, so a merge gate can read both. Once published, the
 * commit is recorded beside the report as the next round's cursor.
 *
 * Bound inputs (`with:` bindings, canonical text in env):
 * - INPUTS_SCOPE: the review's requested scope. When it names a pull request (a
 *   number or `#number` in the checkout's repository, a URL, or a recorded pull
 *   request as JSON; ../../.shared/scope.ts), that pull request is the only write
 *   target, and the declaration must be it: same host, repository and number.
 * - INPUTS_PR: the qualified pull request the scope agent declared it reviewed,
 *   or `null` for a working diff. It names the target only when the scope names
 *   none: an empty scope or a branch.
 * - INPUTS_REPORT: path to the report this node publishes.
 * - INPUTS_HEAD: the commit this round reviewed, as review-round fixed it.
 * - INPUTS_READY / INPUTS_ACTION / INPUTS_SUMMARY / INPUTS_REPORT_POINTER /
 *   INPUTS_DISCOVERIES / INPUTS_CONTRACT_LEFT: the certified verdict fields this
 *   node forwards.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nodeStartCommit } from '../../.shared/checkout.ts';
import { checkoutRepos, resolvePrUrl, upsertComment, viewPr } from '../../.shared/pr.ts';
import { parseQualifiedPr, type QualifiedPr } from '../../.shared/forge.ts';
import { emit, note, refuse, text } from '../../.shared/io.ts';
import { REVIEW_MARKER, reviewCommentBody } from '../../.shared/review-comment.ts';
import { declaredMismatch, prLabel as label, scopeIdentity } from '../../.shared/scope.ts';

/** The pull request the scope agent declared, or undefined for a working diff. */
function declaredPr(value: string): QualifiedPr | undefined {
  const target = value.trim() || 'null';
  const parsed: unknown = JSON.parse(target);
  // Older persisted scope output used `{}` for a working diff.
  if (parsed === null || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
    return undefined;
  }
  return parseQualifiedPr(target);
}

try {
  const verdict = {
    ready: JSON.parse(text(process.env.INPUTS_READY)) as boolean,
    action: text(process.env.INPUTS_ACTION),
    findings_summary: text(process.env.INPUTS_SUMMARY),
    report: JSON.parse(text(process.env.INPUTS_REPORT_POINTER)) as unknown,
    discoveries: JSON.parse(text(process.env.INPUTS_DISCOVERIES)) as unknown,
    contract_left: JSON.parse(text(process.env.INPUTS_CONTRACT_LEFT)) as unknown,
  };
  // Complete only on an empty list: a review that left anything open never lets a merge close the issue.
  const coverage = Array.isArray(verdict.contract_left) && verdict.contract_left.length === 0 ? 'complete' : 'open';
  const declared = declaredPr(text(process.env.INPUTS_PR));
  // The pull request the scope names, from the scope and forge facts alone, never from
  // the declaration it checks. A bare number, such as the trigger's subject.number,
  // names one in the checkout's repository.
  const asked = scopeIdentity(text(process.env.INPUTS_SCOPE), { prAtUrl: resolvePrUrl, checkoutRepos });
  const pr = asked ?? declared;
  const head = text(process.env.INPUTS_HEAD).trim();
  const reportPath = text(process.env.INPUTS_REPORT);
  const report = readFileSync(reportPath, 'utf8');
  if (report.trim() === '') throw new Error('the review report is empty');
  const checkout = nodeStartCommit();
  if (checkout !== head) {
    throw new Error(`this round reviewed ${head}, but the checkout is now at ${checkout}`);
  }
  if (pr) {
    const remote = viewPr(pr).pr.head_revision;
    if (remote !== head) {
      throw new Error(
        `this round reviewed ${head}, but ${label(pr)} is at ${remote ?? 'an unknown head'}: push the commits under review, or review from a checkout of the pull request's head`
      );
    }
  }
  const mismatch = asked && declaredMismatch(asked, declared);
  if (mismatch) throw new Error(mismatch);
  if (!pr) {
    note('publish-review: the review scope is a working diff, so no comment was published.');
  } else {
    const comment = upsertComment(
      { kind: 'pr', ref: pr },
      REVIEW_MARKER,
      reviewCommentBody(head, verdict.ready, coverage, report)
    );
    note(`publish-review: canonical review comment at ${comment.url}`);
  }
  // review-round reads this as the next round's cursor.
  writeFileSync(join(dirname(reportPath), 'reviewed-head'), `${head}\n`);
  emit(verdict);
} catch (error) {
  refuse(`publish-review: ${error instanceof Error ? error.message : String(error)}`);
}
