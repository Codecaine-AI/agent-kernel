#!/usr/bin/env bun
/**
 * Consumer smoke check: installs the publishable packages the way an npm user
 * gets them, then imports the kernel's public entry points.
 *
 * 1. Copies each public package folder into a temp folder, rewrites the copy's
 *    manifest to its publish form (`workspace:*` becomes `^<version>`, dev
 *    workspace deps drop out) and adds the repo LICENSE and README.md when the
 *    package has none, the same way Core's scripts/release.ts does. Then it
 *    packs the copy with `npm pack`. The source tree is never written.
 * 2. Installs the tarballs into a new, empty temp folder with a fresh
 *    resolution from the registry: no lockfile, no workspace, `--no-cache`.
 *    Third-party ranges such as `@earendil-works/pi-*` resolve to the newest
 *    version they allow, which is what a new consumer gets.
 * 3. Imports each entry point in ENTRY_POINTS and checks its key exports.
 *
 * It never publishes. Its only output is the temp folder, which it removes on
 * exit, on an error and on SIGINT or SIGTERM.
 *
 * Usage: bun run smoke:consumer   (needs network access to the npm registry)
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Glob, type Subprocess } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"] as const;

/** Entry points a consumer imports, with the exports each one must provide as functions. */
const ENTRY_POINTS: Record<string, string[]> = {
  "@codecaine-ai/agent-kernel": ["createKernel"],
  "@codecaine-ai/agent-kernel/archon-provider": ["createAgentKernelProvider"],
};

type Member = { dir: string; raw: string; manifest: any };

/** Throws, so the finally block below still removes the temp folder. */
function fail(message: string): never {
  throw new Error(message);
}

/** The child process that runs now, so a signal handler can stop it before it removes the temp folder. */
let child: Subprocess | undefined;

async function run(cmd: string[], cwd: string): Promise<string> {
  child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ]);
  child = undefined;
  if (exitCode !== 0) fail(`${cmd.join(" ")} failed in ${cwd}:\n${err.trim() || out.trim()}`);
  return out;
}

const rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const members: Member[] = (rootManifest.workspaces as string[]).flatMap((pattern) =>
  [...new Glob(`${pattern}/package.json`).scanSync({ cwd: ROOT, onlyFiles: true })].map((file) => {
    const raw = readFileSync(join(ROOT, file), "utf8");
    return { dir: dirname(join(ROOT, file)), raw, manifest: JSON.parse(raw) };
  }),
);
const publicMembers = members.filter((m) => m.manifest.private !== true);
const localVersions = new Map(publicMembers.map((m) => [m.manifest.name as string, m.manifest.version as string]));

/** Version of a workspace dependency from another repo (such as prompt-kit), read from the installed copy. */
function installedVersion(dep: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const path = join(dir, "node_modules", dep, "package.json");
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")).version;
    if (dir === dirname(dir)) fail(`cannot find an installed ${dep} to read its version`);
  }
}

function publishManifest(m: Member): any {
  const manifest = structuredClone(m.manifest);
  for (const field of DEP_FIELDS) {
    const deps = manifest[field] ?? {};
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
      if (field === "devDependencies") delete deps[dep];
      else deps[dep] = `^${localVersions.get(dep) ?? installedVersion(dep, m.dir)}`;
    }
  }
  return manifest;
}

const work = mkdtempSync(join(tmpdir(), "agent-kernel-smoke-"));
const removeWork = () => rmSync(work, { recursive: true, force: true });
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, async () => {
    const running = child;
    running?.kill();
    await running?.exited;
    removeWork();
    process.exit(code);
  });
}

try {
  // 1. Pack a copy of each public package with its publish-form manifest. The source folder stays untouched.
  const tarballs = new Map<string, string>();
  for (const m of publicMembers) {
    const copy = join(work, "packages", basename(m.dir));
    cpSync(m.dir, copy, { recursive: true, filter: (src) => basename(src) !== "node_modules" });
    const indent = m.raw.match(/^\{\n([ \t]+)/)?.[1] ?? "  ";
    writeFileSync(join(copy, "package.json"), JSON.stringify(publishManifest(m), null, indent) + "\n");
    for (const file of ["LICENSE", "README.md"]) {
      if (!existsSync(join(copy, file))) cpSync(join(ROOT, file), join(copy, file));
    }
    const out = await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", work], copy);
    tarballs.set(m.manifest.name, `file:${join(work, JSON.parse(out)[0].filename)}`);
  }
  console.log(`packed ${[...tarballs.keys()].map((n) => `${n}@${localVersions.get(n)}`).join(", ")}`);

  // 2. Install the tarballs into an empty consumer with a fresh registry resolution.
  // The overrides make each package's ^<version> range on its siblings use the local tarball.
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  const deps = Object.fromEntries(tarballs);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "smoke-consumer", private: true, type: "module", dependencies: deps, overrides: deps }, null, 2),
  );
  await run(["bun", "install", "--no-cache", "--no-save"], consumer);
  const resolved = Object.keys(publishManifest(publicMembers.find((m) => m.manifest.name === "@codecaine-ai/agent-kernel")!).dependencies)
    .filter((dep) => !tarballs.has(dep))
    .map((dep) => `${dep}@${JSON.parse(readFileSync(join(consumer, "node_modules", dep, "package.json"), "utf8")).version}`);
  console.log(`installed fresh: ${resolved.join(", ")}`);

  // 3. Import each entry point in the consumer, as a consumer would.
  const check = `
    const entries = ${JSON.stringify(ENTRY_POINTS)};
    let failed = 0;
    for (const [entry, names] of Object.entries(entries)) {
      try {
        const mod = await import(entry);
        const missing = names.filter((n) => typeof mod[n] !== "function");
        if (missing.length) throw new Error("not a function: " + missing.join(", "));
        console.log("✓ " + entry);
      } catch (error) {
        failed++;
        console.error("✗ " + entry + ": " + (error?.message ?? error));
      }
    }
    process.exit(failed ? 1 : 0);
  `;
  writeFileSync(join(consumer, "check.mjs"), check);
  child = Bun.spawn(["bun", "check.mjs"], { cwd: consumer, stdout: "inherit", stderr: "inherit" });
  const exitCode = await child.exited;
  child = undefined;
  if (exitCode !== 0) fail("a consumer import failed on a fresh install");
  console.log("consumer smoke check passed");
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  removeWork();
}
