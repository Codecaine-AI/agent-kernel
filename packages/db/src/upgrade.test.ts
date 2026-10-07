import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPreKindDatabase, tableColumnNames } from "./__fixtures__/pre-kind-schema";
import { ensureKernelObservabilitySchema } from "./bootstrap";
import {
  openKernelDatabase,
  openKernelDatabaseReadOnly,
  type KernelDatabase,
  type KernelDatabaseHandle,
} from "./client";
import {
  hasSessionKindColumn,
  isSqliteBusyError,
  upgradeKernelObservabilitySchema,
} from "./upgrade";

const STEP = "pi_agent_sessions.kind";

let dir: string;
let dbPath: string;
const handles: KernelDatabaseHandle[] = [];

function open(path = dbPath): KernelDatabaseHandle {
  const handle = openKernelDatabase({ path });
  handles.push(handle);
  return handle;
}

function kindColumn(path: string) {
  const sqlite = new Database(path, { readonly: true });
  try {
    return sqlite
      .query<{ name: string; notnull: number; dflt_value: string | null }, []>(
        "PRAGMA table_info(pi_agent_sessions)",
      )
      .all()
      .find((column) => column.name === "kind");
  } finally {
    sqlite.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-upgrade-test-"));
  dbPath = join(dir, "trace.db");
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("upgradeKernelObservabilitySchema", () => {
  test("adds kind to a pre-kind database and defaults rows to pi", async () => {
    createPreKindDatabase(dbPath);
    const { db } = open();
    expect(hasSessionKindColumn(db)).toBe(false);

    const report = await upgradeKernelObservabilitySchema(db);

    expect(report).toEqual({ applied: [STEP], skipped: [], readOnly: false });
    expect(kindColumn(dbPath)).toMatchObject({ notnull: 1, dflt_value: "'pi'" });
    expect(
      db.all<{ id: string; kind: string }>("SELECT id, kind FROM pi_agent_sessions"),
    ).toEqual([{ id: "s1", kind: "pi" }]);
    expect(hasSessionKindColumn(db)).toBe(true);
  });

  test("is idempotent", async () => {
    createPreKindDatabase(dbPath);
    const { db } = open();

    await upgradeKernelObservabilitySchema(db);
    const second = await upgradeKernelObservabilitySchema(db);
    // A second handle has no cached knowledge and probes the schema itself.
    const third = await upgradeKernelObservabilitySchema(open().db);

    expect(second).toEqual({ applied: [], skipped: [STEP], readOnly: false });
    expect(third).toEqual({ applied: [], skipped: [STEP], readOnly: false });
    // The bootstrap path (CREATE IF NOT EXISTS, then upgrade) is idempotent too.
    await ensureKernelObservabilitySchema(db);
    await ensureKernelObservabilitySchema(db);
    expect(tableColumnNames(dbPath, "pi_agent_sessions").filter((c) => c === "kind")).toEqual([
      "kind",
    ]);
  });

  test("treats a concurrent duplicate column as applied", async () => {
    createPreKindDatabase(dbPath);
    const racer = open();
    const { db } = open();

    // The race window: this handle probes the schema before another process
    // adds the column, then issues its own ALTER after it did.
    let probes = 0;
    const lateHandle = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "all") return Reflect.get(target, prop, receiver);
        return (query: Parameters<KernelDatabase["all"]>[0]) => {
          const rows = target.all<{ name: string }>(query);
          probes += 1;
          if (probes > 1) return rows;
          racer.db.run("ALTER TABLE pi_agent_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'pi'");
          return rows;
        };
      },
    }) as KernelDatabase;

    const report = await upgradeKernelObservabilitySchema(lateHandle);

    expect(probes).toBe(1);
    expect(report).toEqual({ applied: [STEP], skipped: [], readOnly: false });
    expect(kindColumn(dbPath)).toMatchObject({ notnull: 1, dflt_value: "'pi'" });
  });

  test("fresh bootstrap creates kind NOT NULL DEFAULT 'pi'", async () => {
    const { db } = open();
    await ensureKernelObservabilitySchema(db);

    expect(kindColumn(dbPath)).toMatchObject({ notnull: 1, dflt_value: "'pi'" });
    expect(await upgradeKernelObservabilitySchema(db)).toEqual({
      applied: [],
      skipped: [STEP],
      readOnly: false,
    });
  });

  test("reports a read-only handle instead of throwing and leaves the schema alone", async () => {
    createPreKindDatabase(dbPath);
    const readOnly = openKernelDatabaseReadOnly(dbPath);
    handles.push(readOnly);

    const report = await upgradeKernelObservabilitySchema(readOnly.db);

    expect(report).toEqual({ applied: [], skipped: [STEP], readOnly: true });
    expect(tableColumnNames(dbPath, "pi_agent_sessions")).not.toContain("kind");
  });

  test("retries SQLITE_BUSY until the other writer releases its lock", async () => {
    createPreKindDatabase(dbPath);
    const { db } = open();
    const locker = new Database(dbPath);
    locker.exec("BEGIN IMMEDIATE");
    const startedAt = Date.now();
    setTimeout(() => {
      locker.exec("COMMIT");
      locker.close();
    }, 150);

    const report = await upgradeKernelObservabilitySchema(db);

    expect(report.applied).toEqual([STEP]);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
    expect(kindColumn(dbPath)).toBeDefined();
  });

  test("gives up with SQLITE_BUSY after five retries", async () => {
    createPreKindDatabase(dbPath);
    const { db } = open();
    const locker = new Database(dbPath);
    locker.exec("BEGIN IMMEDIATE");
    try {
      const error = await upgradeKernelObservabilitySchema(db).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(isSqliteBusyError(error)).toBe(true);
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
    expect(tableColumnNames(dbPath, "pi_agent_sessions")).not.toContain("kind");
  });
});
