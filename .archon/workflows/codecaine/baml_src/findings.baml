class Finding {
  sources string[] @description("The reviewers that reported it: review-codex, review-claude, or both")
  file string @description("The repository path the finding cites")
  line int @description("The line number the finding cites, in the file at the reviewed head")
  claim string @description("What is wrong, in one sentence")
  evidence string @description("The evidence the reviewer gave: code, a command and its output, or the path that reaches the failure")
  correction string @description("The smallest correction the reviewer proposed")
}

class ReviewFindings {
  findings Finding[]
}

// The extract node extract-findings of pre-pr-review. Its input is the 2 reviewer
// reports in one string. Each report marks whether a finding's cited line is a line
// the diff adds or changes; only those findings are kept.
function ExtractFindings(reports: string) -> ReviewFindings {
  client PackDefault
  prompt #"
    {{ _.role("system") }}
    You read the reports of 2 code reviewers, review-codex and review-claude, on one diff.
    Turn their findings into one list of typed findings.

    - Keep a finding only when the report places it on a line the diff adds or changes.
      Drop a finding on an unchanged line, a finding with no file and line, and a
      finding the report marks as off the diff.
    - When both reviewers report the same defect, give one finding whose sources name both.
    - Copy each claim, evidence and correction from the report. Do not add findings,
      and do not judge whether a finding is right.
    - When no finding is left, return an empty list.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ reports }}
  "#
}
