import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPreKindDatabase, tableColumnNames } from "./__fixtures__/pre-kind-schema";
import {
  getKernelTraceReadRows,
  getPiAgentSession,
  listPiAgentSessionsForContainer,
  upsertPiAgentSession,
} from "./actions";
import {
  openKernelDatabase,
  openKernelDatabaseReadOnly,
  type KernelDatabaseHandle,
} from "./client";
import { piAgentSessionSelection } from "./read-compat";
import { piAgentSessions, SESSION_KIND, SESSION_STATUS } from "./schema/pi-agent-sessions";
import type { PiAgentSession } from "./types";
import { hasSessionKindColumn, upgradeKernelObservabilitySchema } from "./upgrade";

let dir: string;
let dbPath: string;
const handles: KernelDatabaseHandle[] = [];

function track(handle: KernelDatabaseHandle): KernelDatabaseHandle {
  handles.push(handle);
  return handle;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-read-compat-test-"));
  dbPath = join(dir, "trace.db");
  createPreKindDatabase(dbPath);
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("piAgentSessionSelection", () => {
  test("read-only open of a pre-kind database reads sessions as kind pi", async () => {
    const { db } = track(openKernelDatabaseReadOnly(dbPath));

    const rows = await getKernelTraceReadRows(db, "c1");
    expect(rows?.piSessions.map((s) => [s.id, s.kind, s.eventCount])).toEqual([
      ["s1", "pi", 0],
    ]);
    expect((await getPiAgentSession(db, "s1"))?.kind).toBe("pi");
    expect((await listPiAgentSessionsForContainer(db, "c1")).map((s) => s.kind)).toEqual([
      "pi",
    ]);
    expect(tableColumnNames(dbPath, "pi_agent_sessions")).not.toContain("kind");
  });

  test("a long-lived read-only handle sees kind after another handle upgrades", async () => {
    const reader = track(openKernelDatabaseReadOnly(dbPath)).db;
    expect((await listPiAgentSessionsForContainer(reader, "c1")).map((s) => s.kind)).toEqual([
      "pi",
    ]);
    expect(hasSessionKindColumn(reader)).toBe(false);

    const writer = track(openKernelDatabase({ path: dbPath })).db;
    await upgradeKernelObservabilitySchema(writer);
    await upsertPiAgentSession(writer, {
      id: "s2",
      containerId: "c1",
      agentName: "ExtractThing",
      status: SESSION_STATUS.ACTIVE,
      kind: SESSION_KIND.CALL,
      createdAt: "2026-10-01T00:00:02.000Z",
    });

    // Same handle, no reopen: the negative probe is not cached.
    const rows = await getKernelTraceReadRows(reader, "c1");
    expect(rows?.piSessions.map((s) => [s.id, s.kind])).toEqual([
      ["s1", "pi"],
      ["s2", "call"],
    ]);
    expect(hasSessionKindColumn(reader)).toBe(true);
  });

  test("selection rows keep the PiAgentSession shape", async () => {
    const writer = track(openKernelDatabase({ path: dbPath })).db;
    await upgradeKernelObservabilitySchema(writer);
    const reader = track(openKernelDatabaseReadOnly(dbPath)).db;

    for (const db of [reader, writer]) {
      const [row] = await db.select(piAgentSessionSelection(db)).from(piAgentSessions);
      // Type level: the selected row and PiAgentSession assign both ways.
      const asSession: PiAgentSession = row!;
      const asSelected: typeof row = asSession;
      expect(asSelected).toBe(row);
      expect(Object.keys(row!).sort()).toEqual(
        Object.keys(getTableColumns(piAgentSessions)).sort(),
      );
      expect(row?.kind).toBe("pi");
    }

    // The declared return types of the switched readers are unchanged.
    const single: Promise<PiAgentSession | undefined> = getPiAgentSession(reader, "s1");
    const many: Promise<PiAgentSession[]> = listPiAgentSessionsForContainer(reader, "c1");
    expect((await single)?.id).toBe("s1");
    expect(await many).toHaveLength(1);
  });
});
