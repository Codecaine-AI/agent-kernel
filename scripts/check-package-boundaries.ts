import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

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

// The kernel never loads BAML, not even for types: the harness injects its own
// module (one native addon per process). These match against a whole file with
// comments blanked, so multiline imports are caught and prose is not.
const bamlPackage = "@boundaryml/baml";
const bamlLoadPatterns = [
  /\bimport\s*(?:type\s+)?(?:[\s\S]*?\bfrom\s*)?["']@boundaryml\/baml(?:\/[^"']*)?["']/g,
  /\bexport\s+[\s\S]*?\bfrom\s*["']@boundaryml\/baml/g,
  /\bimport\s*\(\s*["']@boundaryml\/baml/g,
  /\brequire\s*\(\s*["']@boundaryml\/baml/g,
];
const bamlMessage = "packages must not load @boundaryml/baml; inject the harness's module";
const testFilePattern = /\.test\.[cm]?[jt]sx?$/;

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

const regexKeywords = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/** A `/` after one of these starts a regex literal rather than a division. */
function regexMayFollow(previous: string): boolean {
  return (
    previous === "" ||
    (previous.length === 1 && "(,=:[!&|?{};+-*%<>~^".includes(previous)) ||
    regexKeywords.has(previous)
  );
}

/**
 * Blanks every comment to spaces, keeping newlines so offsets and line numbers
 * still point into the original text. Strings, template literals and regex
 * literals are copied untouched, so a `//` inside them is not a comment.
 */
function stripComments(source: string): string {
  const n = source.length;
  let out = "";
  let i = 0;
  let previous = "";
  let braceDepth = 0;
  const templateBraceDepths: number[] = [];

  const scanQuoted = (start: number, quote: string): number => {
    let j = start + 1;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === quote) return j + 1;
      if (c === "\n") return j;
      j++;
    }
    return n;
  };
  // Scans template text from `start` to its closing backtick or next `${`.
  const scanTemplate = (start: number): { end: number; opensExpression: boolean } => {
    let j = start;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") return { end: j + 1, opensExpression: false };
      if (c === "$" && source[j + 1] === "{") return { end: j + 2, opensExpression: true };
      j++;
    }
    return { end: n, opensExpression: false };
  };
  const scanRegex = (start: number): number => {
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const c = source[j];
      if (c === "\n") return -1;
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (j < n && /[A-Za-z]/.test(source[j]!)) j++;
        return j;
      }
      j++;
    }
    return -1;
  };
  const copyTemplateFrom = (start: number) => {
    const scanned = scanTemplate(start);
    out += source.slice(i, scanned.end);
    i = scanned.end;
    if (scanned.opensExpression) {
      templateBraceDepths.push(braceDepth);
      previous = "{";
    } else {
      previous = "`";
    }
  };

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      out += source.slice(i, end).replace(/[^\r\n]/g, " ");
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = scanQuoted(i, c);
      out += source.slice(i, end);
      i = end;
      previous = c;
      continue;
    }
    if (c === "`") {
      copyTemplateFrom(i + 1);
      continue;
    }
    if (
      c === "}" &&
      templateBraceDepths.length > 0 &&
      braceDepth === templateBraceDepths[templateBraceDepths.length - 1]
    ) {
      templateBraceDepths.pop();
      copyTemplateFrom(i + 1);
      continue;
    }
    if (c === "/" && regexMayFollow(previous)) {
      const end = scanRegex(i);
      if (end > 0) {
        out += source.slice(i, end);
        i = end;
        previous = "/regex/";
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j]!)) j++;
      previous = source.slice(i, j);
      out += previous;
      i = j;
      continue;
    }
    if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    if (!/\s/.test(c)) previous = c;
    out += c;
    i++;
  }
  return out;
}

/** Offsets of each `@boundaryml/baml` specifier that a load statement names. */
function bamlLoadOffsets(source: string): number[] {
  if (!source.includes(bamlPackage)) return [];
  const code = stripComments(source);
  if (!code.includes(bamlPackage)) return [];
  const offsets = new Set<number>();
  for (const pattern of bamlLoadPatterns) {
    for (const match of code.matchAll(pattern)) {
      offsets.add(match.index + match[0].lastIndexOf(bamlPackage));
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

const violations: Array<{ file: string; line: number; text: string }> = [];
const bamlViolations: Array<{ file: string; line: number; text: string }> = [];

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
  if (testFilePattern.test(basename(file))) continue;
  for (const offset of bamlLoadOffsets(text)) {
    const line = text.slice(0, offset).split("\n").length;
    bamlViolations.push({
      file: relative(root, file),
      line,
      text: (lines[line - 1] ?? "").trim(),
    });
  }
}

if (violations.length > 0) {
  console.error("Package boundary check failed: packages must stay app-neutral.");
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
}

if (bamlViolations.length > 0) {
  console.error(`Package boundary check failed: ${bamlMessage}.`);
  for (const violation of bamlViolations) {
    console.error(`${violation.file}:${violation.line}: ${bamlMessage}: ${violation.text}`);
  }
}

if (violations.length > 0 || bamlViolations.length > 0) {
  process.exit(1);
}

console.log(
  "Package boundary check passed: no app-specific references and no @boundaryml/baml loads under packages/.",
);
