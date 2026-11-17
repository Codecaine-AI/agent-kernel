/**
 * Tag the outside reviewers, Greptile and CodeRabbit, once for the head the review
 * published about.
 *
 * The pack's own review runs first; this node runs after the `rounds` loop completes, so a
 * review whose publish failed or refused tags nothing. It posts one comment that tags both
 * outside reviewers and carries a marker with the head commit. Before it posts, it reads the
 * pull request's live head and its comments, and ../../.shared/outside-reviewers.ts decides:
 * - The live head is not the reviewed head (a push after the loop's check): it posts
 *   nothing, prints `head moved: reviewed <sha>, now <sha>` and fails, as publish fails on
 *   a push during the round. The run did not review the head the pull request now carries,
 *   so it must not end as a success; the next run reviews and tags the new head.
 * - A comment already holds the marker with that head: it posts nothing. So sequential
 *   runs, or a replayed node, tag each head at most once. Two runs on one pull request at
 *   the same time can both post: the trigger binding runs 1 run per pull request at a time.
 *
 * Usage:
 *   bun tag-outside-reviewers.ts [--dry-run] [--reviewed-head <sha>] [<pull request>]
 * The pull request is a number, URL or branch, as `gh pr view` takes it, or a recorded pull
 * request as JSON (`{"repo": {"host", "path"}, "number"}`). With --dry-run it posts nothing.
 *
 * As a workflow script node it reads the reviewed pull request from INPUTS_PR and the
 * reviewed head from INPUTS_HEAD, the loop's output, and always posts. With a reviewed head,
 * an empty or `null` pull request means the review was of a working diff: there is nothing
 * to tag. The engine binds the loop's null field as the text `null`, where it binds a body
 * node's declared null field as empty text.
 * Without one (a hand run), an empty pull request selects the open pull request of the
 * current branch, and the live head is tagged as is.
 *
 * Output: `would tag <sha>` on a dry run, `tagged <sha>: <comment url>` after it posts,
 * `already tagged <sha>`, `no pull request` when there is none, and `no open pull request`
 * when it is closed or merged.
 */

import { decideTag, tagMarker } from '../../.shared/outside-reviewers.ts';
import { note, refuse, report, trimmed } from '../../.shared/io.ts';

const TAGS = ['@greptileai review', '@coderabbitai review'];

function spawnGh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString().trim() };
}

function gh(args: string[]): string {
  const result = spawnGh(args);
  if (!result.ok) throw new Error(`gh ${args[0]} ${args[1] ?? ''} failed: ${result.stderr}`);
  return result.stdout;
}

/** A recorded pull request as its URL; any other selector unchanged. */
function selector(pr: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(pr);
  } catch {
    return pr; // a number, URL or branch
  }
  const record = parsed as { repo?: { host?: unknown; path?: unknown }; number?: unknown } | null;
  if (typeof record?.repo?.host === 'string' && typeof record.repo.path === 'string' && Number.isInteger(record.number)) {
    return `https://${record.repo.host}/${record.repo.path}/pull/${String(record.number)}`;
  }
  return pr;
}

function parseArgs(argv: string[]): { dryRun: boolean; pr: string; reviewedHead: string | undefined } {
  let dryRun = false;
  let reviewedHead: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--reviewed-head') reviewedHead = argv[++i] ?? '';
    else if (arg.startsWith('--reviewed-head=')) reviewedHead = arg.slice('--reviewed-head='.length);
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new Error('give at most one pull request');
  const head = reviewedHead ?? process.env.INPUTS_HEAD;
  if (head !== undefined && head.trim() === '') throw new Error('the reviewed head is empty');
  return { dryRun, pr: positional[0] ?? trimmed(process.env.INPUTS_PR), reviewedHead: head?.trim() };
}

function main(): void {
  const { dryRun, pr, reviewedHead } = parseArgs(process.argv.slice(2));
  if ((pr === '' || pr === 'null') && reviewedHead !== undefined) {
    report('no pull request');
    note('tag-outside-reviewers: the review was of a working diff, so there is nothing to tag.');
    return;
  }
  const target = selector(pr);
  const viewed = spawnGh(['pr', 'view', ...(target === '' ? [] : [target]), '--json', 'number,headRefOid,url,state']);
  if (!viewed.ok && target === '' && /no pull requests found|no git remotes found/i.test(viewed.stderr)) {
    report('no pull request');
    return;
  }
  if (!viewed.ok) throw new Error(`gh pr view failed: ${viewed.stderr}`);
  const view = JSON.parse(viewed.stdout) as { number: number; headRefOid: string; url: string; state: string };
  if (view.state !== 'OPEN') {
    report(`no open pull request: #${String(view.number)} is ${view.state.toLowerCase()}`);
    return;
  }
  const url = new URL(view.url);
  const repo = url.pathname.split('/').slice(1, 3).join('/');
  const repoArg = `${url.hostname}/${repo}`;
  const comments = gh(['api', '--hostname', url.hostname, '--paginate', `repos/${repo}/issues/${String(view.number)}/comments`, '--jq', '.[].body | @json'])
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as string);
  // Read the head again after the comments, the last read before the post, so a push
  // during pagination refuses too. The read and the post are still not atomic.
  const liveHead = gh(['pr', 'view', String(view.number), '--repo', repoArg, '--json', 'headRefOid', '-q', '.headRefOid']);
  const decision = decideTag({ reviewedHead, liveHead, comments });
  switch (decision.kind) {
    case 'head-moved':
      refuse(`tag-outside-reviewers: head moved: reviewed ${decision.reviewed}, now ${decision.live}; tagged nothing`);
      return;
    case 'already-tagged':
      report(`already tagged ${decision.head}`);
      return;
    case 'tag': {
      if (dryRun) {
        report(`would tag ${decision.head}`);
        return;
      }
      const body = [tagMarker(decision.head), ...TAGS].join('\n');
      const posted = gh(['pr', 'comment', String(view.number), '--repo', repoArg, '--body', body]);
      report(`tagged ${decision.head}: ${posted}`);
      return;
    }
    default: {
      const unhandled: never = decision;
      throw new Error(`unknown decision ${JSON.stringify(unhandled)}`);
    }
  }
}

try {
  main();
} catch (error) {
  refuse(`tag-outside-reviewers: ${error instanceof Error ? error.message : String(error)}`);
}
