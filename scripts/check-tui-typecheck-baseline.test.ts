/**
 * Runs the TUI baseline guard's --self-test under `bun test ./scripts`, so
 * `test:boundaries` proves the guard still fails on each canned regression.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

test("the TUI typecheck baseline guard fails every canned regression", async () => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, "check-tui-typecheck-baseline.ts"), "--self-test"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect({ exitCode, stderr, failedCases: stdout.split("\n").filter((l) => l.startsWith("FAIL")) }).toEqual({
    exitCode: 0,
    stderr: "",
    failedCases: [],
  });
  expect(stdout).toContain("TUI baseline guard self-test passed");
});
