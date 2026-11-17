/**
 * The pull request a review's requested scope names, decided apart from the forge
 * reads that answer it.
 *
 * publish-review writes only to the pull request the scope names. The scope agent
 * declares the pull request it reviewed, and that declaration is the thing checked,
 * so the identity it is checked against comes from the scope and from forge facts:
 * - A number, `13` or `#13`, names a pull request in the checkout's repository, the
 *   one repository the checkout's remotes name, as the forge resolves them.
 * - A URL names the pull request the forge resolves it to.
 * - A JSON record, `{"repo": {"host", "path"}, "number"}`, names itself.
 * - Empty text or a branch name names no pull request by itself: the declaration
 *   stands, and publish's head check binds it to the reviewed commit.
 *
 * Every other spelling refuses rather than guessing. That includes a zero-padded
 * number such as `0013`: no forge or trigger writes a pull request number that way,
 * and the same text can be a branch name, so the scope agent and this check could
 * read it as two different targets.
 */

import { parseQualifiedPr, record, samePr, sameRepo, type QualifiedPr } from './forge.ts';

type Repo = QualifiedPr['repo'];

/** The forge facts a scope needs, read only when its form needs them. */
export interface ScopeFacts {
  /** The pull request a web URL names, or undefined when it names none. */
  readonly prAtUrl: (url: string) => QualifiedPr | undefined;
  /** The repositories the checkout's remotes name, as the forge resolves them. */
  readonly checkoutRepos: () => readonly Repo[];
}

export function prLabel(pr: QualifiedPr | undefined): string {
  return pr ? `${pr.repo.host}/${pr.repo.path}#${String(pr.number)}` : 'no pull request';
}

function repoLabel(repo: Repo): string {
  return `${repo.host}/${repo.path}`;
}

/**
 * The qualified pull request the scope names, or undefined when it names none by
 * itself (empty, or a branch name). Throws for a scope it cannot read as one target.
 */
export function scopeIdentity(scope: string, facts: ScopeFacts): QualifiedPr | undefined {
  const value = scope.trim();
  if (value === '') return undefined;
  if (/^#?[0-9]+$/.test(value) || value.startsWith('#')) {
    const number = /^#?([1-9][0-9]*)$/.exec(value)?.[1];
    if (number === undefined || !Number.isSafeInteger(Number(number))) {
      throw new Error(`the review scope "${value}" is not a pull request number: write it as 13 or #13`);
    }
    const repos = facts.checkoutRepos().filter(
      (repo, index, all) => all.findIndex(other => sameRepo(other, repo)) === index
    );
    if (repos.length !== 1) {
      throw new Error(
        `the review scope "${value}" names a pull request in the checkout's repository, but the checkout's remotes name ` +
          (repos.length === 0 ? 'no forge repository' : `${String(repos.length)} (${repos.map(repoLabel).join(', ')})`) +
          ': pass the pull request URL or its record instead'
      );
    }
    return { repo: repos[0], number: Number(number) };
  }
  if (value.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('the review scope starts like a pull request record but is not valid JSON');
    }
    if (!record(parsed)) throw new Error('the review scope is not a pull request record');
    try {
      return parseQualifiedPr(value);
    } catch {
      throw new Error('the review scope is a record without a qualified repo and positive number');
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const pr = facts.prAtUrl(value);
    if (pr === undefined) throw new Error(`the review scope ${value} names no pull request`);
    return pr;
  }
  return undefined;
}

/**
 * The refusal when the scope agent declared another pull request than the scope
 * names, or undefined when they are the same one. Host and repository compare the
 * way a forge registers them (./forge.ts `sameRepo`).
 */
export function declaredMismatch(asked: QualifiedPr, declared: QualifiedPr | undefined): string | undefined {
  return declared !== undefined && samePr(asked, declared)
    ? undefined
    : `the review scope names ${prLabel(asked)}, but the scope agent declared ${prLabel(declared)}`;
}
