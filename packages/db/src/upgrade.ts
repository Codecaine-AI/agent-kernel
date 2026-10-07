/**
 * Idempotent, additive schema upgrades for databases created before a column
 * existed. No migration tooling: each step probes the live schema and applies
 * a metadata-only change when it is missing.
 *
 * `ALTER TABLE … ADD COLUMN` with a constant default rewrites no rows in
 * SQLite, so it is safe on very large databases. No index is added for the
 * new column: CREATE INDEX would scan the whole table.
 */
import { sql } from "drizzle-orm";
import type { KernelDatabase } from "./client";

export interface SchemaUpgradeReport {
  /** Steps that added something (including a column another handle added concurrently). */
  applied: string[];
  /** Steps with nothing to do, or that could not run on a read-only handle. */
  skipped: string[];
  /** True when a needed step could not run because the handle is read-only. */
  readOnly: boolean;
}

const SESSION_KIND_STEP = "pi_agent_sessions.kind";

/** SQLITE_BUSY retries for the ALTER: 5 retries, 100 ms apart. */
const BUSY_RETRIES = 5;
const BUSY_RETRY_DELAY_MS = 100;

/**
 * Handles known to have pi_agent_sessions.kind. Only positive results are
 * cached: a column is never removed, but a read-only handle must notice as
 * soon as another process adds it.
 */
const sessionKindColumnKnown = new WeakMap<KernelDatabase, true>();

/**
 * The error and its causes: Drizzle wraps driver errors from `db.run()` in a
 * DrizzleError whose `cause` is the bun:sqlite error.
 */
function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && chain.length < 5) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** True when the error (or a cause) has a SQLite code starting with `prefix`. */
function hasSqliteCode(error: unknown, prefix: string): boolean {
  return errorChain(error).some((link) => {
    const code = (link as { code?: unknown }).code;
    return typeof code === "string" && code.startsWith(prefix);
  });
}

/** SQLITE_BUSY (or an extended BUSY code) anywhere in the cause chain. */
export function isSqliteBusyError(error: unknown): boolean {
  return hasSqliteCode(error, "SQLITE_BUSY");
}

function isSqliteReadOnlyError(error: unknown): boolean {
  return hasSqliteCode(error, "SQLITE_READONLY");
}

function isDuplicateColumnError(error: unknown): boolean {
  return errorChain(error).some(
    (link) => link instanceof Error && /duplicate column name/i.test(link.message),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tableColumns(db: KernelDatabase, table: string): string[] {
  return db
    .all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`)
    .map((column) => column.name);
}

/**
 * True when pi_agent_sessions has `kind`. Safe on read-only handles. Caches
 * only a POSITIVE result per handle; a negative result re-probes
 * `PRAGMA table_info` on every call (microseconds), so a long-lived read-only
 * handle sees the column as soon as another process upgrades the database.
 */
export function hasSessionKindColumn(db: KernelDatabase): boolean {
  if (sessionKindColumnKnown.has(db)) return true;
  const present = tableColumns(db, "pi_agent_sessions").includes("kind");
  if (present) sessionKindColumnKnown.set(db, true);
  return present;
}

/**
 * Bring an existing kernel database up to the current schema. Idempotent;
 * a duplicate-column error from a concurrent upgrader counts as applied,
 * SQLITE_BUSY is retried, and a read-only handle is reported (not thrown).
 * Any other failure throws.
 */
export async function upgradeKernelObservabilitySchema(
  db: KernelDatabase,
): Promise<SchemaUpgradeReport> {
  const report: SchemaUpgradeReport = { applied: [], skipped: [], readOnly: false };

  const columns = tableColumns(db, "pi_agent_sessions");
  // No table yet: the bootstrap CREATE (which already has `kind`) makes it.
  if (columns.length === 0 || columns.includes("kind")) {
    if (columns.length > 0) sessionKindColumnKnown.set(db, true);
    report.skipped.push(SESSION_KIND_STEP);
    return report;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      db.run(
        sql`ALTER TABLE pi_agent_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'pi'`,
      );
      break;
    } catch (error) {
      if (isDuplicateColumnError(error)) break;
      if (isSqliteReadOnlyError(error)) {
        report.readOnly = true;
        report.skipped.push(SESSION_KIND_STEP);
        return report;
      }
      if (isSqliteBusyError(error) && attempt < BUSY_RETRIES) {
        await sleep(BUSY_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  sessionKindColumnKnown.set(db, true);
  report.applied.push(SESSION_KIND_STEP);
  return report;
}
