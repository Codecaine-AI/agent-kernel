/**
 * Tag the outside reviewers, Greptile and CodeRabbit, once for the pull request's head.
 *
 * The pack's own review runs first; this node runs after the `rounds` loop. It posts one
 * comment that tags both outside reviewers and carries a marker with the head commit.
 * Before it posts, it searches the pull request's comments for that marker and that head:
 * when a comment has both, the head is already tagged and it posts nothing. So sequential
 * runs, or a replayed node, tag each head at most once. Two runs on one pull request at the
 * same time can both post: the trigger binding runs 1 run per pull request at a time.
 *
 * Usage:
 *   bun tag-outside-reviewers.ts [--dry-run] [<pull request>]
 * As a workflow script node it reads the pull request from INPUTS_PR (the review's scope
 * input) and always posts. The pull request is a number, URL or branch, as `gh pr view`
 * takes it, or a recorded pull request as JSON (`{"repo": {"host", "path"}, "number"}`).
 * Empty selects the open pull request of the current branch, and a branch with none (a
 * working-diff review) has nothing to tag. With --dry-run it posts nothing.
 *
 * Output: `already tagged` when the head has its tag, `would tag <sha>` on a dry run,
 * `tagged <sha>: <comment url>` after it posts, and `no pull request` when there is none.
 */

const MARKER = 'codecaine-outside-reviewers';
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

/** The head line of the marker. A comment that holds it tagged that head. */
function markerLine(head: string): string {
  return `<!-- ${MARKER} head=${head} -->`;
}

function parseArgs(argv: string[]): { dryRun: boolean; pr: string } {
  const flags = argv.filter(arg => arg.startsWith('--'));
  const unknown = flags.filter(flag => flag !== '--dry-run');
  if (unknown.length > 0) throw new Error(`unknown flag ${unknown.join(', ')}`);
  const positional = argv.filter(arg => !arg.startsWith('--'));
  if (positional.length > 1) throw new Error('give at most one pull request');
  return {
    dryRun: flags.includes('--dry-run'),
    pr: positional[0] ?? (process.env.INPUTS_PR ?? '').trim(),
  };
}

try {
  const { dryRun, pr } = parseArgs(process.argv.slice(2));
  const target = selector(pr);
  const viewed = spawnGh(['pr', 'view', ...(target === '' ? [] : [target]), '--json', 'number,headRefOid,url']);
  if (!viewed.ok && target === '' && /no pull requests found|no git remotes found/i.test(viewed.stderr)) {
    console.log('no pull request');
    process.exit(0);
  }
  if (!viewed.ok) throw new Error(`gh pr view failed: ${viewed.stderr}`);
  const view = JSON.parse(viewed.stdout) as { number: number; headRefOid: string; url: string };
  const url = new URL(view.url);
  const repo = url.pathname.split('/').slice(1, 3).join('/');
  const marker = markerLine(view.headRefOid);
  const tagged = gh([
    'api',
    '--hostname',
    url.hostname,
    '--paginate',
    `repos/${repo}/issues/${String(view.number)}/comments`,
    '--jq',
    `.[] | select(.body | contains(${JSON.stringify(marker)})) | .id`,
  ]);
  if (tagged !== '') {
    console.log('already tagged');
  } else if (dryRun) {
    console.log(`would tag ${view.headRefOid}`);
  } else {
    const body = [marker, ...TAGS].join('\n');
    const posted = gh(['pr', 'comment', String(view.number), '--repo', `${url.hostname}/${repo}`, '--body', body]);
    console.log(`tagged ${view.headRefOid}: ${posted}`);
  }
} catch (error) {
  console.error(`tag-outside-reviewers: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
