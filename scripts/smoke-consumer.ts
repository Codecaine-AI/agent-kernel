#!/usr/bin/env bun
/**
 * Consumer smoke check: installs the publishable packages the way an npm user
 * gets them, then imports the kernel's public entry points.
 *
 * 1. Rewrites each public manifest to its publish form (`workspace:*` becomes
 *    `^<version>`, dev workspace deps drop out), the same way Core's
 *    scripts/release.ts does, packs it with `npm pack`, and restores the manifest.
 * 2. Installs the tarballs into a new, empty temp folder with a fresh
 *    resolution from the registry: no lockfile, no workspace, `--no-cache`.
 *    Third-party ranges such as `@earendil-works/pi-*` resolve to the newest
 *    version they allow, which is what a new consumer gets.
 * 3. Imports each entry point in ENTRY_POINTS and checks its key exports.
 *
 * It never publishes. It leaves the working tree as it found it.
 *
 * Usage: bun run smoke:consumer   (needs network access to the npm registry)
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"] as const;

/** Entry points a consumer imports, with the exports each one must provide as functions. */
const ENTRY_POINTS: Record<string, string[]> = {
  "@codecaine-ai/agent-kernel": ["createKernel"],
  "@codecaine-ai/agent-kernel/archon-provider": ["createAgentKernelProvider"],
};

type Member = { dir: string; raw: string; manifest: any };

/** Throws, so the finally block below still restores the manifests and removes the temp folder. */
function fail(message: string): never {
  throw new Error(message);
}

function run(cmd: string[], cwd: string): string {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString();
  if (proc.exitCode !== 0) fail(`${cmd.join(" ")} failed in ${cwd}:\n${proc.stderr.toString().trim() || out.trim()}`);
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
const restoreAll = () => {
  for (const m of publicMembers) writeFileSync(join(m.dir, "package.json"), m.raw);
};
process.once("SIGINT", () => {
  restoreAll();
  rmSync(work, { recursive: true, force: true });
  process.exit(130);
});

try {
  // 1. Pack each public package with its publish-form manifest.
  const tarballs = new Map<string, string>();
  for (const m of publicMembers) {
    const indent = m.raw.match(/^\{\n([ \t]+)/)?.[1] ?? "  ";
    writeFileSync(join(m.dir, "package.json"), JSON.stringify(publishManifest(m), null, indent) + "\n");
    try {
      const out = run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", work], m.dir);
      tarballs.set(m.manifest.name, `file:${join(work, JSON.parse(out)[0].filename)}`);
    } finally {
      writeFileSync(join(m.dir, "package.json"), m.raw);
    }
  }
  console.log(`packed ${[...tarballs.keys()].map((n) => `${n}@${localVersions.get(n)}`).join(", ")}`);

  // 2. Install the tarballs into an empty consumer with a fresh registry resolution.
  // The overrides make each package's ^<version> range on its siblings use the local tarball.
  const consumer = join(work, "consumer");
  run(["mkdir", consumer], work);
  const deps = Object.fromEntries(tarballs);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "smoke-consumer", private: true, type: "module", dependencies: deps, overrides: deps }, null, 2),
  );
  run(["bun", "install", "--no-cache", "--no-save"], consumer);
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
  const proc = Bun.spawnSync(["bun", "check.mjs"], { cwd: consumer, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) fail("a consumer import failed on a fresh install");
  console.log("consumer smoke check passed");
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  restoreAll();
  rmSync(work, { recursive: true, force: true });
}
