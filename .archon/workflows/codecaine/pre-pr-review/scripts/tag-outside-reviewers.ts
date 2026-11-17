/**
 * Tag the outside reviewers, Greptile and CodeRabbit, once for the pull request's head.
 *
 * The pack's own review runs first; this node runs after the `rounds` loop. It posts one
 * comment that tags both outside reviewers and carries a marker with the head commit.
 * Before it posts, it searches the pull request's comments for that marker and that head:
 * when a comment has both, the head is already tagged and it posts nothing. So a rerun of
 * the workflow, or a replayed node, tags each head at most once.
 *
 * Usage:
 *   bun tag-outside-reviewers.ts [--dry-run] [<pull request>]
 * As a workflow script node it reads the pull request from INPUTS_PR and always posts.
 * The pull request is a number, URL or branch, as `gh pr view` takes it; empty selects
 * the open pull request of the current branch. With --dry-run it posts nothing.
 *
 * Output: `already tagged` when the head has its tag, `would tag <sha>` on a dry run,
 * and `tagged <sha>: <comment url>` after it posts.
 */

const MARKER = 'codecaine-outside-reviewers';
const TAGS = ['@greptileai review', '@coderabbitai review'];

function gh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args[0]} ${args[1] ?? ''} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
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
  const view = JSON.parse(gh(['pr', 'view', ...(pr === '' ? [] : [pr]), '--json', 'number,headRefOid,url'])) as {
    number: number;
    headRefOid: string;
    url: string;
  };
  const repo = new URL(view.url).pathname.split('/').slice(1, 3).join('/');
  const marker = markerLine(view.headRefOid);
  const tagged = gh([
    'api',
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
    const url = gh(['pr', 'comment', String(view.number), '--repo', repo, '--body', body]);
    console.log(`tagged ${view.headRefOid}: ${url}`);
  }
} catch (error) {
  console.error(`tag-outside-reviewers: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
