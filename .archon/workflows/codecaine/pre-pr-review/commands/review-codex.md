# Review the Change — review-codex

Find the defects the change introduces, and return them as your reply. You are one of 2 reviewers. The other reviews the same diff at the same time, and an extract step merges both reports.

You are read-only. Never modify this checkout, commit, or post anywhere: the other reviewer reads the same checkout, and the engine fails a reviewer that leaves it changed. To try a change, use a scratch worktree under this run (`git worktree add --detach "$(mkdir -p "$ARTIFACTS_DIR/.archon/scratch/review-codex" && mktemp -d "$ARTIFACTS_DIR/.archon/scratch/review-codex/XXXXXX")" HEAD`; the workflow removes it). Any other file you write goes under `$ARTIFACTS_DIR`, never in this checkout.

## Read

1. Read `$ARTIFACTS_DIR/review/scope.md`. It records the change under review, the exact diff command, and the accepted contract. Review exactly that diff, at commit `$mode.output.head`.
2. Read the review brief. It says what the change does and which docs and conventions apply:

$pack-context.output.brief

3. Apply the full-review policy: **$mode.output.risks**
4. Open the repository's steering files (`CLAUDE.md`, `AGENTS.md`, the docs the brief names) only when a finding depends on a rule one of them states. Cite the section you rely on.

## What counts as a finding

- A reachable input or state that produces a wrong outcome: wrong behavior, false success, lost data, or an isolation or security hole.
- A comment, doc, name or type that the change makes false.
- A rule of the repository's steering files that the changed code breaks.

Every finding needs the changed line that causes it, the path that reaches it, the wrong outcome, the evidence (code, a test, or a command and its output), and the smallest correction. When the chain of cause holds a "might" or a "could", investigate until it is concrete, or leave it out. Taste that no project document states is not a finding.

## Reply

Reply with your report as plain Markdown. It is the output of this node. For each finding, give:

- `file:line` at commit `$mode.output.head`
- `On diff: yes` when that line is one the diff adds or changes, otherwise `On diff: no`
- the claim in one sentence
- the evidence and the path that reaches the failure
- the smallest correction

End with one line that counts the findings. When you find none, say so in one line.
