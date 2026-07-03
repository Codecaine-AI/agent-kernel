/**
 * SQLite client helper — one database file per kernel.
 *
 * Standard path convention: <root>/.agent-kernel/trace.db. WAL mode is
 * enabled on open so readers (viewer) never block the writer (kernel).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/** Standard per-kernel database file, relative to the kernel's root dir. */
export const KERNEL_DB_RELATIVE_PATH = ".agent-kernel/trace.db";

/** The Drizzle handle every db action is typed against (SQLite-first). */
export type KernelDatabase = BunSQLiteDatabase<Record<string, never>>;

export interface KernelDatabaseHandle {
  db: KernelDatabase;
  /** Absolute or caller-provided path of the opened database file. */
  path: string;
  close: () => void;
}

/** Resolve the standard trace.db path under a kernel root directory. */
export function kernelDatabasePath(rootDir: string): string {
  return join(rootDir, KERNEL_DB_RELATIVE_PATH);
}

/**
 * Open (creating if needed) a kernel SQLite database: mkdir -p the parent
 * directory, open the file, enable WAL, and return a Drizzle handle plus
 * close(). Schema creation is separate — see ensureKernelObservabilitySchema.
 */
export function openKernelDatabase(opts: { path: string }): KernelDatabaseHandle {
  mkdirSync(dirname(opts.path), { recursive: true });
  const sqlite = new Database(opts.path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);
  return {
    db,
    path: opts.path,
    close: () => sqlite.close(),
  };
}
