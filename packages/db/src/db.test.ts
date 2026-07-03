import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUserMessageEvent } from "@agent-kernel/protocol";

import {
  createAgentRun,
  getAgentRun,
  getContainer,
  getKernelTraceReadRows,
  insertTraceEventsBatch,
  listContainerTree,
  listTraceEventsForContainer,
  upsertContainer,
  upsertPiAgentSession,
} from "./actions";
import { ensureKernelObservabilitySchema } from "./bootstrap";
import {
  kernelDatabasePath,
  openKernelDatabase,
  type KernelDatabaseHandle,
} from "./client";
import {
  kernelManifestPath,
  readKernelManifest,
  writeKernelManifest,
} from "./manifest";
import { RUN_STATUS, RUN_TRIGGER, SESSION_STATUS } from "./schema";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-db-test-"));
  handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
  await ensureKernelObservabilitySchema(handle.db);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openKernelDatabase", () => {
  test("creates the .agent-kernel directory and enables WAL", () => {
    expect(handle.path).toBe(join(dir, ".agent-kernel", "trace.db"));
    const rows = handle.db.all<{ journal_mode: string }>("PRAGMA journal_mode;");
    expect(rows[0]?.journal_mode).toBe("wal");
  });
});

describe("container upsert determinism", () => {
  test("same (kernelId, kind, appKey) resolves to the same row", async () => {
    const first = await upsertContainer(handle.db, {
      id: "candidate-id-1",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-42"],
      label: "Request 42",
    });
    const second = await upsertContainer(handle.db, {
      id: "candidate-id-2", // different candidate id, same identity
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-42"],
      label: "Request 42 (updated)",
      phase: "build",
    });

    expect(second.id).toBe(first.id);
    expect(second.label).toBe("Request 42 (updated)");
    expect(second.phase).toBe("build");
    expect(second.createdAt).toBe(first.createdAt);

    const tree = await listContainerTree(handle.db, first.id);
    expect(tree).toHaveLength(1);
  });

  test("different kind or key creates distinct rows", async () => {
    const a = await upsertContainer(handle.db, {
      id: "id-a",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-1"],
    });
    const b = await upsertContainer(handle.db, {
      id: "id-b",
      kernelId: "kern-1",
      kind: "worker",
      appKey: ["req-1"],
    });
    const c = await upsertContainer(handle.db, {
      id: "id-c",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-2"],
    });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  test("child containers link into a tree", async () => {
    const root = await upsertContainer(handle.db, {
      id: "root",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-1"],
    });
    await upsertContainer(handle.db, {
      id: "child",
      kernelId: "kern-1",
      kind: "worker",
      appKey: ["req-1", "worker-1"],
      parentContainerId: root.id,
    });

    const tree = await listContainerTree(handle.db, root.id);
    expect(tree.map((c) => c.id)).toEqual(["root", "child"]);
  });
});

describe("idempotent event insert", () => {
  test("replaying a batch never duplicates rows", async () => {
    await upsertContainer(handle.db, {
      id: "c1",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-1"],
    });

    const events = [
      createUserMessageEvent({ containerId: "c1", runId: "r1" }, "hello", "build"),
      createUserMessageEvent({ containerId: "c1", runId: "r1" }, "again", "build"),
    ];

    const firstInsert = await insertTraceEventsBatch(handle.db, events);
    expect(firstInsert).toBe(2);

    const secondInsert = await insertTraceEventsBatch(handle.db, events);
    expect(secondInsert).toBe(0);

    const rows = await listTraceEventsForContainer(handle.db, "c1");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.runId).toBe("r1");
    expect(rows[0]?.userId).toBeNull();
  });
});

describe("manifest read/write", () => {
  test("round-trips through .agent-kernel/kernel.json", async () => {
    const written = await writeKernelManifest(dir, {
      kernelId: "kern-1",
      displayName: "Test Kernel",
      piSessionsDir: join(dir, "pi-sessions"),
      viewerBaseUrl: "http://localhost:4000",
    });
    expect(written).toBe(kernelManifestPath(dir));

    const manifest = await readKernelManifest(dir);
    expect(manifest?.kernelId).toBe("kern-1");
    expect(manifest?.displayName).toBe("Test Kernel");
    expect(manifest?.viewerBaseUrl).toBe("http://localhost:4000");
  });

  test("returns undefined when no manifest exists", async () => {
    const missing = mkdtempSync(join(tmpdir(), "agent-kernel-empty-"));
    try {
      expect(await readKernelManifest(missing)).toBeUndefined();
    } finally {
      rmSync(missing, { recursive: true, force: true });
    }
  });
});

describe("container-first read api", () => {
  test("collects sessions, runs, and events for a container subtree", async () => {
    await upsertContainer(handle.db, {
      id: "c1",
      kernelId: "kern-1",
      kind: "session",
      appKey: ["req-1"],
    });
    await upsertPiAgentSession(handle.db, {
      id: "s1",
      containerId: "c1",
      agentName: "coordinator",
      status: SESSION_STATUS.ACTIVE,
      createdAt: new Date().toISOString(),
    });
    await createAgentRun(handle.db, {
      id: "r1",
      piSessionId: "s1",
      containerId: "c1",
      agentName: "coordinator",
      trigger: RUN_TRIGGER.OPERATOR,
      inboundEventId: "e-in",
      status: RUN_STATUS.RUNNING,
      startedAt: new Date().toISOString(),
    });
    await insertTraceEventsBatch(handle.db, [
      createUserMessageEvent(
        { containerId: "c1", runId: "r1", piSessionUuid: "s1" },
        "hello",
        "build",
      ),
    ]);

    const rows = await getKernelTraceReadRows(handle.db, "c1");
    expect(rows?.rootContainer.id).toBe("c1");
    expect(rows?.piSessions).toHaveLength(1);
    expect(rows?.piSessions[0]?.eventCount).toBe(1);
    expect(rows?.agentRuns).toHaveLength(1);
    expect(rows?.agentRuns[0]?.trigger).toBe("operator");
    expect(rows?.agentRuns[0]?.inboundEventId).toBe("e-in");
    expect(rows?.events).toHaveLength(1);
    expect(rows?.events[0]?.runId).toBe("r1");

    const run = await getAgentRun(handle.db, "r1");
    expect(run?.status).toBe("running");
    const container = await getContainer(handle.db, "c1");
    expect(container?.status).toBe("active");
  });
});
