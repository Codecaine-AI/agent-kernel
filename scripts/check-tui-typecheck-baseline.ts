/**
 * Guards packages/tui's known type errors so they cannot grow.
 *
 * `typecheck:tui` fails today, so it cannot sit in `typecheck:green`. Instead
 * this compares its diagnostics, as a multiset of { file, code, message } with
 * line and column dropped (edits elsewhere in a file do not churn), against the
 * committed scripts/tui-typecheck-baseline.json. A new or replaced diagnostic,
 * or one more copy of a known one, fails; one that disappears is allowed.
 *
 * Usage:
 *   bun scripts/check-tui-typecheck-baseline.ts             # check (run by `verify`)
 *   bun scripts/check-tui-typecheck-baseline.ts --record    # rewrite the baseline
 *   bun scripts/check-tui-typecheck-baseline.ts --self-test # prove the check fails on canned regressions
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const baselinePath = join(import.meta.dir, "tui-typecheck-baseline.json");
const tscArgs = ["bunx", "--bun", "tsc", "-p", "packages/tui/tsconfig.json", "--noEmit", "--pretty", "false"];
const diagnosticLine =
  /^(?<file>[^(]+)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.*)$/;

type Diagnostic = { file: string; code: string; message: string };
type CompilerRun = { exitCode: number; output: string };
type ProblemKind = "exit-code" | "no-diagnostics" | "unparsed-line" | "new-diagnostic";
type Problem = { kind: ProblemKind; detail: string };
type CheckResult = { problems: Problem[]; notes: string[]; diagnostics: Diagnostic[] };

function keyOf(d: Diagnostic): string {
  return JSON.stringify([d.file, d.code, d.message]);
}

// Code-unit order, so a re-record never reorders the file across locales.
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const ka = keyOf(a);
  const kb = keyOf(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function countByKey(diagnostics: Diagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of diagnostics) counts.set(keyOf(d), (counts.get(keyOf(d)) ?? 0) + 1);
  return counts;
}

/**
 * Parses one compiler run and rejects any run whose diagnostics cannot be
 * trusted: an exit code other than 0 (clean) or 2 (diagnostics reported), exit
 * 2 with nothing parsed, or an error line the pattern does not understand.
 */
function readRun(run: CompilerRun): { diagnostics: Diagnostic[]; problems: Problem[] } {
  const diagnostics: Diagnostic[] = [];
  const problems: Problem[] = [];
  if (run.exitCode !== 0 && run.exitCode !== 2) {
    problems.push({ kind: "exit-code", detail: `tsc exited ${run.exitCode} (expected 0 or 2)` });
  }
  for (const rawLine of run.output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = diagnosticLine.exec(line);
    if (match?.groups) {
      diagnostics.push({
        file: relative(root, resolve(root, match.groups.file!)),
        code: match.groups.code!,
        message: match.groups.msg!,
      });
    } else if (/^error\b/.test(line) || /\berror TS\d+\b/.test(line)) {
      problems.push({ kind: "unparsed-line", detail: `unparseable compiler line: ${line}` });
    }
  }
  if (run.exitCode === 2 && diagnostics.length === 0) {
    problems.push({ kind: "no-diagnostics", detail: "tsc exited 2 but no diagnostic line parsed" });
  }
  return { diagnostics: diagnostics.sort(compareDiagnostics), problems };
}

function check(run: CompilerRun, baseline: Diagnostic[]): CheckResult {
  const { diagnostics, problems } = readRun(run);
  const notes: string[] = [];
  const allowed = countByKey(baseline);
  const current = countByKey(diagnostics);
  for (const [key, count] of current) {
    const known = allowed.get(key) ?? 0;
    if (count > known) {
      const [file, code, message] = JSON.parse(key) as [string, string, string];
      problems.push({
        kind: "new-diagnostic",
        detail: `${file}: ${code}: ${message} (${count} now, ${known} in baseline)`,
      });
    }
  }
  let gone = 0;
  for (const [key, known] of allowed) gone += Math.max(0, known - (current.get(key) ?? 0));
  if (gone > 0) {
    notes.push(`${gone} baseline diagnostic(s) no longer reported; baseline can shrink: rerun --record`);
  }
  return { problems, notes, diagnostics };
}

async function runCompiler(): Promise<CompilerRun> {
  try {
    const proc = Bun.spawn(tscArgs, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, output: stdout + stderr };
  } catch (error) {
    return { exitCode: 127, output: `could not run ${tscArgs.join(" ")}: ${String(error)}` };
  }
}

async function readBaseline(): Promise<Diagnostic[]> {
  const text = await readFile(baselinePath, "utf-8").catch(() => {
    throw new Error(`no baseline at ${relative(root, baselinePath)}; run --record`);
  });
  const parsed = JSON.parse(text) as { diagnostics?: unknown };
  if (!Array.isArray(parsed.diagnostics)) {
    throw new Error(`${relative(root, baselinePath)} has no diagnostics array; rerun --record`);
  }
  return parsed.diagnostics as Diagnostic[];
}

function printProblems(problems: Problem[]) {
  for (const problem of problems) console.error(`  ${problem.kind}: ${problem.detail}`);
}

async function record(): Promise<number> {
  const { diagnostics, problems } = readRun(await runCompiler());
  if (problems.length > 0) {
    console.error("TUI typecheck baseline not recorded: the compiler run is not trustworthy.");
    printProblems(problems);
    return 1;
  }
  const body = { command: tscArgs.join(" "), diagnostics };
  await writeFile(baselinePath, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`Recorded ${diagnostics.length} TUI diagnostics in ${relative(root, baselinePath)}.`);
  return 0;
}

async function checkAgainstBaseline(): Promise<number> {
  let baseline: Diagnostic[];
  try {
    baseline = await readBaseline();
  } catch (error) {
    console.error(`TUI typecheck baseline check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const result = check(await runCompiler(), baseline);
  if (result.problems.length > 0) {
    console.error("TUI typecheck baseline check failed:");
    printProblems(result.problems);
    return 1;
  }
  for (const note of result.notes) console.log(note);
  console.log(
    `TUI typecheck baseline check passed: ${result.diagnostics.length} diagnostics, none new (baseline ${baseline.length}).`,
  );
  return 0;
}

function selfTest(): number {
  const a = "packages/tui/src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.";
  const b = "packages/tui/src/b.ts(10,5): error TS5097: An import path can only end with a '.ts' extension.";
  const b2 = "packages/tui/src/b.ts(11,9): error TS5097: An import path can only end with a '.ts' extension.";
  const c = "packages/tui/src/c.ts(7,2): error TS2678: Type '\"quote\"' is not comparable to type 'Kind'.";
  const baseline = readRun({ exitCode: 2, output: [a, b, b2].join("\n") }).diagnostics;

  const cases: Array<{ name: string; run: CompilerRun; fails?: ProblemKind; note?: boolean }> = [
    {
      name: "the baseline output at other lines and columns",
      run: { exitCode: 2, output: [a.replace("(3,1)", "(40,8)"), b2, b].join("\n") },
    },
    { name: "a known diagnostic disappears", run: { exitCode: 2, output: [a, b].join("\n") }, note: true },
    { name: "a clean compile", run: { exitCode: 0, output: "" }, note: true },
    { name: "one new diagnostic replacing a fixed one", run: { exitCode: 2, output: [c, b, b2].join("\n") }, fails: "new-diagnostic" },
    { name: "one more copy of a known diagnostic", run: { exitCode: 2, output: [a, b, b2, b].join("\n") }, fails: "new-diagnostic" },
    { name: "exit 1 with empty output", run: { exitCode: 1, output: "" }, fails: "exit-code" },
    { name: "exit 127 (compiler missing)", run: { exitCode: 127, output: "bunx: command not found" }, fails: "exit-code" },
    { name: "exit 2 with no diagnostic line", run: { exitCode: 2, output: "Found 3 errors." }, fails: "no-diagnostics" },
    {
      name: "an unparseable error line",
      run: { exitCode: 2, output: [a, b, b2, "error TS5083: Cannot read file 'packages/tui/tsconfig.base.json'."].join("\n") },
      fails: "unparsed-line",
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const result = check(testCase.run, baseline);
    const kinds = result.problems.map((p) => p.kind);
    // A failing case must fail for its own reason only, not for an unrelated one.
    const ok = testCase.fails
      ? kinds.length === 1 && kinds[0] === testCase.fails
      : kinds.length === 0 && (result.notes.length > 0) === Boolean(testCase.note);
    const expected = testCase.fails ? `fails with ${testCase.fails}` : testCase.note ? "passes with a shrink note" : "passes";
    const actual = kinds.length > 0 ? `failed with ${kinds.join(", ")}` : `passed${result.notes.length > 0 ? " with a note" : ""}`;
    console.log(`${ok ? "ok  " : "FAIL"} ${testCase.name}: expected ${expected}, ${actual}`);
    if (!ok) failures++;
  }
  if (failures > 0) {
    console.error(`TUI baseline guard self-test failed: ${failures} of ${cases.length} cases.`);
    return 1;
  }
  console.log(`TUI baseline guard self-test passed: ${cases.length} cases.`);
  return 0;
}

const mode = process.argv[2];
if (mode === "--record") process.exit(await record());
if (mode === "--self-test") process.exit(selfTest());
if (mode !== undefined) {
  console.error(`unknown argument ${mode}; expected --record, --self-test or nothing`);
  process.exit(2);
}
process.exit(await checkAgainstBaseline());
