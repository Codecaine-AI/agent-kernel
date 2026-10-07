/**
 * The BAML fence in check-package-boundaries.ts, exercised end to end: each
 * case copies the real script into a temp repo whose packages/ holds one
 * fixture file, runs it, and reads its exit code and report.
 */
import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = join(import.meta.dir, "check-package-boundaries.ts");
const bamlMessage = "packages must not load @boundaryml/baml; inject the harness's module";

async function checkPackages(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "ak-boundaries-"));
  try {
    await mkdir(join(root, "scripts"));
    await copyFile(script, join(root, "scripts", "check-package-boundaries.ts"));
    for (const [path, text] of Object.entries(files)) {
      const abs = join(root, "packages", path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    }
    const proc = Bun.spawn([process.execPath, join(root, "scripts", "check-package-boundaries.ts")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("BAML fence", () => {
  const loads: Array<[name: string, source: string, line: number]> = [
    ["a from import", 'import { Collector } from "@boundaryml/baml";\n', 1],
    ["a type-only import", 'import type { Collector } from "@boundaryml/baml";\n', 1],
    ["a side-effect import", 'import "@boundaryml/baml";\n', 1],
    ["a multiline import", 'import {\n  Collector\n} from\n  "@boundaryml/baml";\n', 4],
    ["a dynamic import()", 'export async function load() {\n  return await import("@boundaryml/baml");\n}\n', 2],
    ["a require()", 'const baml = require("@boundaryml/baml");\n', 1],
    ["a re-export", 'export { Collector } from "@boundaryml/baml";\n', 1],
    // A naive comment stripper would blank everything after the `//` in the URL.
    ["a load after a string holding //", 'const docs = "https://docs.boundaryml.com"; const baml = require("@boundaryml/baml");\n', 1],
  ];

  test.each(loads)("rejects %s", async (_name, source, line) => {
    const result = await checkPackages({ "kernel/src/engine.ts": source });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`packages/kernel/src/engine.ts:${line}: ${bamlMessage}`);
  });

  test("passes comments that mention the package", async () => {
    const source = [
      "// The harness passes its own `import * as baml from \"@boundaryml/baml\"`.",
      "/*",
      ' * import { Collector } from "@boundaryml/baml";',
      ' * const baml = require("@boundaryml/baml");',
      " */",
      'import type { BamlRuntimeLike } from "./baml-runtime-types"; /* not import("@boundaryml/baml") */',
      "export const engine = (baml: BamlRuntimeLike) => baml; // export * from \"@boundaryml/baml\"",
      "",
    ].join("\n");

    const result = await checkPackages({ "kernel/src/engine.ts": source });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
