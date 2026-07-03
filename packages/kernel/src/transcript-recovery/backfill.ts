/**
 * runBackfill — import complete Pi JSONL transcripts into a kernel trace db.
 *
 * The transcript-recovery role: disaster rebuild, importing sessions that ran
 * outside the kernel, and schema re-derivation. In-process emission (the
 * kernel emitter) is the primary trace path; Pi's JSONL is the durable
 * transcript this module re-derives trace rows from. It reads whole files,
 * maps them through the EventMapper (identity arrives via the session-binding
 * marker in the JSONL), and batch-inserts idempotently by event_id — re-running
 * over the same files inserts zero new rows.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureKernelObservabilitySchema,
  insertTraceEventsBatch,
  openKernelDatabase,
  type KernelDatabase,
} from "@agent-kernel/db";
import type { TraceEvent } from "@agent-kernel/protocol";
import { createRecoveryConfig } from "./config";
import { EventMapper, type EventMapperOptions } from "./mapper";
import { readJsonlFile } from "./reader";

export interface RunBackfillOptions {
  /** Directory scanned recursively for `.jsonl` files. */
  jsonlDir?: string;
  /** Explicit file list — used instead of jsonlDir when provided. */
  files?: string[];
  /** Path to the kernel SQLite db (opened, schema ensured, closed on exit). */
  dbPath?: string;
  /** Already-open db handle — caller owns lifecycle and schema. */
  db?: KernelDatabase;
  /** Mapper options (session-binding marker type/fields, lifecycle types). */
  mapper?: EventMapperOptions;
  /** Events per idempotent batch insert. */
  batchSize?: number;
}

export interface BackfillSummary {
  filesProcessed: number;
  eventsMapped: number;
  eventsInserted: number;
  /** Mapped events already present in the db (idempotent replays). */
  eventsSkipped: number;
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

export async function runBackfill(options: RunBackfillOptions): Promise<BackfillSummary> {
  const config = createRecoveryConfig(
    options.batchSize !== undefined ? { batchSize: options.batchSize } : {},
  );

  const files =
    options.files ?? (options.jsonlDir ? scanJsonlRecursive(options.jsonlDir) : null);
  if (files === null) {
    throw new Error("runBackfill requires either `files` or `jsonlDir`.");
  }

  let db: KernelDatabase;
  let close: (() => void) | null = null;
  if (options.db) {
    db = options.db;
  } else if (options.dbPath) {
    const handle = openKernelDatabase({ path: options.dbPath });
    db = handle.db;
    close = handle.close;
    await ensureKernelObservabilitySchema(db);
  } else {
    throw new Error("runBackfill requires either `db` or `dbPath`.");
  }

  const summary: BackfillSummary = {
    filesProcessed: 0,
    eventsMapped: 0,
    eventsInserted: 0,
    eventsSkipped: 0,
    warnings: [],
  };

  try {
    for (const filePath of files) {
      const { events, malformedLines, truncatedTail } = await readJsonlFile(filePath);
      if (malformedLines > 0) {
        summary.warnings.push(`${filePath}: skipped ${malformedLines} malformed line(s)`);
      }
      if (truncatedTail) {
        summary.warnings.push(`${filePath}: ignored partial (non-terminated) last line`);
      }

      const mapper = new EventMapper(options.mapper);
      const mapped: TraceEvent[] = [];
      for (const event of events) {
        const result = mapper.map(event);
        mapped.push(...result.traceEvents);
        if (result.warnings) {
          summary.warnings.push(...result.warnings.map((w) => `${filePath}: ${w}`));
        }
      }

      if (mapper.hasPending()) {
        summary.warnings.push(
          `${filePath}: ${mapper.pendingCount()} event(s) never bound to a container ` +
            `(no session-binding marker) — dropped`,
        );
      }

      summary.eventsMapped += mapped.length;
      for (let i = 0; i < mapped.length; i += config.batchSize) {
        const batch = mapped.slice(i, i + config.batchSize);
        const inserted = await insertTraceEventsBatch(db, batch);
        summary.eventsInserted += inserted;
        summary.eventsSkipped += batch.length - inserted;
      }

      summary.filesProcessed++;
    }
  } finally {
    close?.();
  }

  return summary;
}
