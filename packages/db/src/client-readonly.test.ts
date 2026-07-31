import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openKernelDatabaseReadOnly,
  type KernelDatabaseHandle,
} from "./client";

let dir: string;
let dbPath: string;
let handle: KernelDatabaseHandle | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-readonly-db-test-"));
  dbPath = join(dir, "trace.db");

  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO observations (value) VALUES ('existing');
  `);
  sqlite.close();
});

afterEach(() => {
  handle?.close();
  handle = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("openKernelDatabaseReadOnly", () => {
  test("reads an existing database and rejects writes", () => {
    handle = openKernelDatabaseReadOnly(dbPath);

    expect(handle.path).toBe(dbPath);
    expect(
      handle.db.all<{ value: string }>(
        "SELECT value FROM observations ORDER BY id",
      ),
    ).toEqual([{ value: "existing" }]);

    expect(() =>
      handle!.db.run(
        "INSERT INTO observations (value) VALUES ('not-allowed')",
      ),
    ).toThrow();
  });

  test("does not create a directory for a missing database", () => {
    const missingDir = join(dir, "missing");

    expect(() =>
      openKernelDatabaseReadOnly(join(missingDir, "trace.db")),
    ).toThrow();
    expect(existsSync(missingDir)).toBe(false);
  });
});
