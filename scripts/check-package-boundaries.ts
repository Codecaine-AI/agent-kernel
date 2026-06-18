import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const forbiddenPatterns = [
  "@spectre/",
  "apps/backend",
  "apps/frontend",
  "apps/data-backend",
  "apps/tailer",
  "SessionStateManager",
  "checkpoint-slice",
  ".spectre",
];
const checkedExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
]);
const ignoredDirs = new Set(["dist", "node_modules", ".turbo", ".next"]);

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        yield* walk(abs);
      }
      continue;
    }
    if (entry.isFile() && checkedExtensions.has(extensionOf(entry.name))) {
      yield abs;
    }
  }
}

const violations: Array<{ file: string; line: number; text: string }> = [];

for await (const file of walk(packagesDir)) {
  const text = await readFile(file, "utf-8");
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const pattern of forbiddenPatterns) {
      if (lineText.includes(pattern)) {
        violations.push({
          file: relative(root, file),
          line: index + 1,
          text: lineText.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Package boundary check failed: packages must stay app-neutral.");
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log("Package boundary check passed: no app-specific references under packages/.");
