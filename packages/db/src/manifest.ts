/**
 * Local kernel manifest — replaces the old kernel_registrations table.
 *
 * With one SQLite database per kernel there is no shared plane to register
 * with; a kernel just writes a small JSON manifest next to its trace.db:
 * <root>/.agent-kernel/kernel.json.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const KERNEL_MANIFEST_RELATIVE_PATH = ".agent-kernel/kernel.json";

interface KernelManifestBase {
  kernelId: string;
  displayName: string;
  /** Directory Pi writes its durable JSONL transcripts into. */
  piSessionsDir: string;
  /** Base URL of a viewer serving this kernel, when one is running. */
  viewerBaseUrl?: string;
}

/** Legacy manifest shape, retained for backward-compatible reads. */
export interface KernelManifestV1 extends KernelManifestBase {
  manifestVersion?: 1;
  kernelRoot?: undefined;
  dbPath?: undefined;
  catalogRoots?: undefined;
  readApiBaseUrl?: undefined;
}

/** Self-describing kernel manifest written by current harnesses. */
export interface KernelManifest extends KernelManifestBase {
  manifestVersion: 2;
  /** Absolute path to this kernel's .agent-kernel directory. */
  kernelRoot: string;
  /** Absolute path to this kernel's trace database. */
  dbPath: string;
  /** Absolute paths to the agent-catalog roots exposed by this kernel. */
  catalogRoots: string[];
  /** Base URL of the harness read/catalog API, when one is running. */
  readApiBaseUrl?: string;
}

export type ReadKernelManifest = KernelManifest | KernelManifestV1;

/** Resolve the manifest path under a kernel root directory. */
export function kernelManifestPath(rootDir: string): string {
  return join(rootDir, KERNEL_MANIFEST_RELATIVE_PATH);
}

/**
 * Atomically write <dir>/.agent-kernel/kernel.json (creating the directory if
 * needed). Returns the path written.
 */
export async function writeKernelManifest(
  dir: string,
  manifest: KernelManifest,
): Promise<string> {
  const path = kernelManifestPath(dir);
  const manifestDir = dirname(path);
  const temporaryPath = join(
    manifestDir,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(manifestDir, { recursive: true });
  let replaced = false;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf-8", flag: "wx" },
    );
    await rename(temporaryPath, path);
    replaced = true;
  } finally {
    if (!replaced) {
      // Best-effort cleanup must not replace the original write/rename error.
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
  return path;
}

/**
 * Read <dir>/.agent-kernel/kernel.json. Returns undefined when the manifest
 * does not exist; throws on malformed JSON or a missing required field.
 */
export async function readKernelManifest(
  dir: string,
): Promise<ReadKernelManifest | undefined> {
  const path = kernelManifestPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Kernel manifest at ${path} must be a JSON object`);
  }

  for (const field of ["kernelId", "displayName", "piSessionsDir"] as const) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
      throw new Error(`Kernel manifest at ${path} is missing "${field}"`);
    }
  }

  if (
    parsed.manifestVersion !== undefined &&
    parsed.manifestVersion !== 1 &&
    parsed.manifestVersion !== 2
  ) {
    throw new Error(
      `Kernel manifest at ${path} has unsupported "manifestVersion"`,
    );
  }

  if (parsed.manifestVersion === 2) {
    for (const field of ["kernelRoot", "dbPath"] as const) {
      if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
        throw new Error(`Kernel manifest at ${path} is missing "${field}"`);
      }
    }
    if (
      !Array.isArray(parsed.catalogRoots) ||
      parsed.catalogRoots.some(
        (root) => typeof root !== "string" || root.length === 0,
      )
    ) {
      throw new Error(`Kernel manifest at ${path} is missing "catalogRoots"`);
    }
  }

  return parsed as unknown as ReadKernelManifest;
}
