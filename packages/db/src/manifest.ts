/**
 * Local kernel manifest — replaces the old kernel_registrations table.
 *
 * With one SQLite database per kernel there is no shared plane to register
 * with; a kernel just writes a small JSON manifest next to its trace.db:
 * <root>/.agent-kernel/kernel.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const KERNEL_MANIFEST_RELATIVE_PATH = ".agent-kernel/kernel.json";

export interface KernelManifest {
  kernelId: string;
  displayName: string;
  /** Directory Pi writes its durable JSONL transcripts into. */
  piSessionsDir: string;
  /** Base URL of a viewer serving this kernel, when one is running. */
  viewerBaseUrl?: string;
}

/** Resolve the manifest path under a kernel root directory. */
export function kernelManifestPath(rootDir: string): string {
  return join(rootDir, KERNEL_MANIFEST_RELATIVE_PATH);
}

/**
 * Write <dir>/.agent-kernel/kernel.json (creating the directory if needed).
 * Returns the path written.
 */
export async function writeKernelManifest(
  dir: string,
  manifest: KernelManifest,
): Promise<string> {
  const path = kernelManifestPath(dir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return path;
}

/**
 * Read <dir>/.agent-kernel/kernel.json. Returns undefined when the manifest
 * does not exist; throws on malformed JSON or a missing required field.
 */
export async function readKernelManifest(
  dir: string,
): Promise<KernelManifest | undefined> {
  const path = kernelManifestPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<KernelManifest>;
  for (const field of ["kernelId", "displayName", "piSessionsDir"] as const) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
      throw new Error(`Kernel manifest at ${path} is missing "${field}"`);
    }
  }
  return parsed as KernelManifest;
}
