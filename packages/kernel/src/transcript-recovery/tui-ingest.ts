/**
 * TUI transcript ingest — import /kernel-booted Pi TUI sessions into the
 * OWNING kernel's trace db.
 *
 * A TUI boot appends two custom entries into the live Pi JSONL (see
 * @agent-kernel/tui session-binding.ts):
 *
 *   agent-kernel:session-binding   { containerId, runId }        — mapper identity
 *   agent-kernel:tui-session-meta  { containerId, runId, agentName, source,
 *                                    cwd, kernelId, targetKernelRoot, origin }
 *
 * This module scans a sessions directory, and for every file carrying a
 * tui-session-meta marker it (1) upserts the identity rows the backfill does
 * NOT create — container (kind "session"), pi_agent_session, agent_run — and
 * (2) runs the standard backfill over the file into the same db. Everything
 * is idempotent: upserts key on stable ids from the markers, and backfill
 * event ids are deterministic (INSERT OR IGNORE), so re-runs are zero-delta.
 *
 * Ownership rule: each marker's `targetKernelRoot` names the `.agent-kernel/`
 * whose db owns the traces (the repo the operator was working in). The db is
 * resolved from `<root>/kernel.json` dbPath, defaulting to `<root>/trace.db`.
 *
 * Files without the meta marker are plain pi sessions — skipped silently.
 *
 * Concurrent-writer caveat: this batch ingest may open a db a live app
 * harness is also writing. createDbTraceWriter assumes single-writer; a batch
 * run leans on SQLite locking instead, which is acceptable for occasional
 * batch imports but not for a continuous tailer.
 *
 * Multi-boot quirks (also noted in the mapper): a second /kernel boot in one
 * session appends a fresh binding — the mapper stamps subsequent events onto
 * the LATEST container, and the single pi_agent_sessions row (keyed by the pi
 * session uuid) ends up pointing at the last container upserted. If two boots
 * in one session target DIFFERENT kernel roots, the whole file is backfilled
 * into each target db; events bound to the other root's container become
 * orphan rows there (the read API joins through containers, so they simply
 * don't render).
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureKernelObservabilitySchema,
  openKernelDatabase,
  upsertAgentRun,
  upsertContainer,
  upsertPiAgentSession,
  type KernelDatabase,
} from "@agent-kernel/db";
import { runBackfill } from "./backfill";
import { readJsonlFile } from "./reader";
import type { PiCustomEvent, PiEvent } from "./types";

export const SESSION_BINDING_CUSTOM_TYPE = "agent-kernel:session-binding";
export const TUI_SESSION_META_CUSTOM_TYPE = "agent-kernel:tui-session-meta";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TuiIngestOptions {
  /** Directory scanned recursively for `.jsonl` files. */
  sessionsDir?: string;
  /** Explicit file list — used instead of sessionsDir when provided. */
  files?: string[];
  /** Report what would happen without opening or writing any db. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface TuiIngestFileResult {
  file: string;
  dbPath: string;
  containerIds: string[];
  eventsMapped: number;
  eventsInserted: number;
  eventsSkipped: number;
}

export interface TuiIngestSummary {
  filesScanned: number;
  /** Files carrying a tui-session-meta marker that were (or would be) ingested. */
  filesIngested: number;
  containersUpserted: number;
  sessionsUpserted: number;
  runsUpserted: number;
  eventsMapped: number;
  eventsInserted: number;
  eventsSkipped: number;
  results: TuiIngestFileResult[];
  warnings: string[];
}

interface TuiBoot {
  containerId: string;
  runId: string | null;
  /** JSONL timestamp of the binding entry (stable across re-runs). */
  timestamp: string;
  agentName: string;
  source: string | null;
  cwd: string | null;
  kernelId: string | null;
  targetKernelRoot: string;
}

interface ParsedTuiFile {
  piSessionUuid: string | null;
  sessionCwd: string | null;
  sessionTimestamp: string | null;
  lastTimestamp: string | null;
  boots: TuiBoot[];
  /** True when at least one tui-session-meta entry exists (even if unusable). */
  hasMeta: boolean;
  warnings: string[];
}

function scanJsonlRecursive(dir: string): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(abs);
      }
    }
  }
  return results.sort();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Pair meta markers with their bindings. Pairing is by containerId (both
 * markers carry it); a meta whose containerId matches no binding is reported
 * rather than guessed at.
 */
function parseTuiFile(events: PiEvent[], filePath: string): ParsedTuiFile {
  const parsed: ParsedTuiFile = {
    piSessionUuid: null,
    sessionCwd: null,
    sessionTimestamp: null,
    lastTimestamp: null,
    boots: [],
    hasMeta: false,
    warnings: [],
  };
  const bindings = new Map<string, { runId: string | null; timestamp: string }>();

  for (const event of events) {
    if (typeof (event as { timestamp?: unknown }).timestamp === "string") {
      parsed.lastTimestamp = event.timestamp;
    }
    if (event.type === "session") {
      if (UUID_RE.test(event.id)) parsed.piSessionUuid = event.id;
      parsed.sessionCwd = str(event.cwd);
      parsed.sessionTimestamp = event.timestamp;
      continue;
    }
    if (event.type !== "custom") continue;
    const custom = event as PiCustomEvent;

    if (custom.customType === SESSION_BINDING_CUSTOM_TYPE) {
      const containerId = str(custom.data.containerId);
      if (containerId && UUID_RE.test(containerId)) {
        bindings.set(containerId, {
          runId: str(custom.data.runId),
          timestamp: custom.timestamp,
        });
      }
      continue;
    }

    if (custom.customType === TUI_SESSION_META_CUSTOM_TYPE) {
      parsed.hasMeta = true;
      const containerId = str(custom.data.containerId);
      const targetKernelRoot = str(custom.data.targetKernelRoot);
      const binding = containerId ? bindings.get(containerId) : undefined;
      if (!containerId || !binding) {
        parsed.warnings.push(
          `${filePath}: tui-session-meta without a matching session-binding (containerId: ${containerId ?? "missing"}) — skipped`,
        );
        continue;
      }
      if (!targetKernelRoot) {
        parsed.warnings.push(
          `${filePath}: tui-session-meta for ${containerId} has no targetKernelRoot — skipped`,
        );
        continue;
      }
      parsed.boots.push({
        containerId,
        runId: str(custom.data.runId) ?? binding.runId,
        timestamp: binding.timestamp,
        agentName: str(custom.data.agentName) ?? "unknown",
        source: str(custom.data.source),
        cwd: str(custom.data.cwd),
        kernelId: str(custom.data.kernelId),
        targetKernelRoot,
      });
    }
  }
  return parsed;
}

interface ResolvedTarget {
  dbPath: string;
  kernelId: string;
}

/**
 * `<root>/kernel.json` → { dbPath, kernelId }. Registry semantics: dbPath
 * defaults to `<root>/trace.db`; a relative dbPath resolves against the root.
 */
function resolveTarget(
  targetKernelRoot: string,
  fallbackKernelId: string | null,
): ResolvedTarget | { error: string } {
  const kernelFile = path.join(targetKernelRoot, "kernel.json");
  let manifest: { kernelId?: unknown; dbPath?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(kernelFile, "utf8")) as typeof manifest;
  } catch (err) {
    return {
      error: `cannot read ${kernelFile}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const rawDbPath = str(manifest.dbPath);
  const dbPath = rawDbPath
    ? path.isAbsolute(rawDbPath)
      ? rawDbPath
      : path.resolve(targetKernelRoot, rawDbPath)
    : path.join(targetKernelRoot, "trace.db");
  const kernelId = str(manifest.kernelId) ?? fallbackKernelId ?? "agent-kernel";
  return { dbPath, kernelId };
}

export async function runTuiIngest(
  options: TuiIngestOptions = {},
): Promise<TuiIngestSummary> {
  const log = options.log ?? (() => {});
  const files =
    options.files ??
    (options.sessionsDir ? scanJsonlRecursive(options.sessionsDir) : null);
  if (files === null) {
    throw new Error("runTuiIngest requires either `files` or `sessionsDir`.");
  }

  const summary: TuiIngestSummary = {
    filesScanned: 0,
    filesIngested: 0,
    containersUpserted: 0,
    sessionsUpserted: 0,
    runsUpserted: 0,
    eventsMapped: 0,
    eventsInserted: 0,
    eventsSkipped: 0,
    results: [],
    warnings: [],
  };

  /** One handle per db across the whole run (files often share a target). */
  const handles = new Map<string, { db: KernelDatabase; close: () => void }>();
  async function openDb(dbPath: string): Promise<KernelDatabase> {
    const cached = handles.get(dbPath);
    if (cached) return cached.db;
    const handle = openKernelDatabase({ path: dbPath });
    await ensureKernelObservabilitySchema(handle.db);
    handles.set(dbPath, handle);
    return handle.db;
  }

  try {
    for (const filePath of files) {
      summary.filesScanned++;
      const { events, malformedLines } = await readJsonlFile(filePath);
      if (malformedLines > 0) {
        summary.warnings.push(
          `${filePath}: skipped ${malformedLines} malformed line(s)`,
        );
      }
      const parsed = parseTuiFile(events, filePath);
      summary.warnings.push(...parsed.warnings);
      // No meta marker → a plain pi session; not ours, skip silently.
      if (!parsed.hasMeta) continue;
      if (parsed.boots.length === 0) continue;
      if (!parsed.piSessionUuid) {
        summary.warnings.push(
          `${filePath}: marked TUI session has no session entry uuid — skipped`,
        );
        continue;
      }

      // Group boots by owning kernel root (almost always exactly one).
      const bootsByRoot = new Map<string, TuiBoot[]>();
      for (const boot of parsed.boots) {
        const group = bootsByRoot.get(boot.targetKernelRoot) ?? [];
        group.push(boot);
        bootsByRoot.set(boot.targetKernelRoot, group);
      }

      let ingested = false;
      for (const [root, boots] of bootsByRoot) {
        const target = resolveTarget(root, boots[0]!.kernelId);
        if ("error" in target) {
          summary.warnings.push(`${filePath}: ${target.error} — skipped`);
          continue;
        }

        if (options.dryRun) {
          ingested = true;
          log(
            `[dry-run] ${filePath} -> ${target.dbPath} (kernel ${target.kernelId}): ` +
              `${boots.length} boot(s): ${boots
                .map((b) => `${b.agentName} container=${b.containerId}`)
                .join("; ")}`,
          );
          summary.results.push({
            file: filePath,
            dbPath: target.dbPath,
            containerIds: boots.map((b) => b.containerId),
            eventsMapped: 0,
            eventsInserted: 0,
            eventsSkipped: 0,
          });
          continue;
        }

        const db = await openDb(target.dbPath);

        for (const boot of boots) {
          await upsertContainer(db, {
            id: boot.containerId,
            kernelId: target.kernelId,
            kind: "session",
            appKey: ["tui-session", boot.containerId],
            label: `tui: ${boot.agentName}`,
            status: "done",
            workingDir: boot.cwd ?? parsed.sessionCwd,
            metadata: {
              origin: "tui",
              agentName: boot.agentName,
              cwd: boot.cwd ?? parsed.sessionCwd,
              ...(boot.source ? { source: boot.source } : {}),
              piSessionUuid: parsed.piSessionUuid,
            },
            createdAt: boot.timestamp,
            startedAt: boot.timestamp,
            endedAt: parsed.lastTimestamp,
          });
          summary.containersUpserted++;

          // One row per pi session (pk = pi uuid): with several boots the row
          // tracks the LATEST container, mirroring the mapper's rebinding.
          await upsertPiAgentSession(db, {
            id: parsed.piSessionUuid,
            containerId: boot.containerId,
            agentName: boot.agentName,
            status: "ended",
            createdAt: parsed.sessionTimestamp ?? boot.timestamp,
            endedAt: parsed.lastTimestamp,
          });
          summary.sessionsUpserted++;

          if (boot.runId && UUID_RE.test(boot.runId)) {
            await upsertAgentRun(db, {
              id: boot.runId,
              piSessionId: parsed.piSessionUuid,
              containerId: boot.containerId,
              agentName: boot.agentName,
              trigger: "operator",
              status: "done",
              startedAt: boot.timestamp,
              endedAt: parsed.lastTimestamp,
            });
            summary.runsUpserted++;
          }
        }

        const backfill = await runBackfill({
          files: [filePath],
          db,
          mapper: {
            sessionBinding: { customType: SESSION_BINDING_CUSTOM_TYPE },
          },
        });
        summary.eventsMapped += backfill.eventsMapped;
        summary.eventsInserted += backfill.eventsInserted;
        summary.eventsSkipped += backfill.eventsSkipped;
        summary.warnings.push(...backfill.warnings);
        summary.results.push({
          file: filePath,
          dbPath: target.dbPath,
          containerIds: boots.map((b) => b.containerId),
          eventsMapped: backfill.eventsMapped,
          eventsInserted: backfill.eventsInserted,
          eventsSkipped: backfill.eventsSkipped,
        });
        ingested = true;
        log(
          `${filePath} -> ${target.dbPath}: ${boots.length} boot(s), ` +
            `${backfill.eventsInserted} inserted / ${backfill.eventsSkipped} already present`,
        );
      }
      if (ingested) summary.filesIngested++;
    }
  } finally {
    for (const handle of handles.values()) handle.close();
  }

  return summary;
}
