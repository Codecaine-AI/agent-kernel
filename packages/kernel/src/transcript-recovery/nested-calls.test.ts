import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureKernelObservabilitySchema,
  getTraceEventsForRun,
  openKernelDatabase,
  type KernelDatabaseHandle,
} from "@agent-kernel/db";
import { nestedToolEventId, type TraceEvent } from "@agent-kernel/protocol";
import { runBackfill } from "./backfill";

const PI_SESSION_UUID = "11111111-2222-3333-4444-555555555555";
const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RUN_ID = "99999999-8888-7777-6666-555555555555";
const MAPPER_OPTIONS = { sessionBinding: { customType: "agent-kernel:session-binding" } };

const t = (s: number) => `2026-07-01T10:00:${String(s).padStart(2, "0")}.000Z`;

/**
 * A codemode session as Pi persists it: the script ran `wrapper`, which ran
 * `read`, and left `ls` running. Nested calls exist only on the codemode
 * tool result (`nestedCalls`, flat, every depth); there are no live rows.
 */
function codemodeTranscript(): unknown[] {
  return [
    { type: "session", version: 3, id: PI_SESSION_UUID, timestamp: t(0), cwd: "/tmp" },
    {
      type: "custom",
      customType: "agent-kernel:session-binding",
      data: { containerId: CONTAINER_ID, runId: RUN_ID },
      id: "e-bind",
      parentId: null,
      timestamp: t(1),
    },
    {
      type: "message",
      id: "e-a1",
      parentId: null,
      timestamp: t(2),
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "c", name: "codemode", arguments: '{"code":"…"}' }],
        timestamp: 0,
        stopReason: "toolUse",
      },
    },
    {
      type: "message",
      id: "e-tr1",
      parentId: "e-a1",
      timestamp: t(9),
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "script done" }],
        timestamp: 0,
        toolCallId: "c",
        toolName: "codemode",
        nestedCalls: {
          calls: [
            { id: "c/1", name: "wrapper", arguments: { path: "a.ts" }, status: "ok", durationMs: 3000 },
            { id: "c/1/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 1000 },
            { id: "c/2", name: "ls", arguments: { path: "." }, status: "unfinished" },
          ],
          complete: false,
        },
      },
    },
  ];
}

function data(evt: TraceEvent): Record<string, unknown> {
  return evt.eventData as Record<string, unknown>;
}

describe("runBackfill (nested tool calls)", () => {
  let root: string;
  let handle: KernelDatabaseHandle;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-kernel-nested-backfill-"));
    handle = openKernelDatabase({ path: join(root, "trace.db") });
    await ensureKernelObservabilitySchema(handle.db);
    file = join(root, "session.jsonl");
    await writeFile(file, codemodeTranscript().map((l) => JSON.stringify(l)).join("\n") + "\n");
  });

  afterEach(async () => {
    handle.close();
    await rm(root, { recursive: true, force: true });
  });

  test("backfill alone rebuilds nested spans from nestedCalls", async () => {
    const first = await runBackfill({ files: [file], db: handle.db, mapper: MAPPER_OPTIONS });
    // Session start, codemode start + end, and a start/end pair per nested record.
    expect(first.eventsInserted).toBe(3 + 3 * 2);
    expect(first.warnings).toEqual([]);

    const rows = await getTraceEventsForRun(handle.db, RUN_ID);
    const nested = rows.filter((e) => data(e).nested === true);
    expect(nested).toHaveLength(6);
    for (const evt of nested) {
      const id = data(evt).tool_use_id as string;
      expect(evt.eventId).toBe(nestedToolEventId(PI_SESSION_UUID, id, String(evt.type)));
      expect(evt.spanId).toBe(id);
      expect(evt.piSessionUuid).toBe(PI_SESSION_UUID);
      expect(evt.containerId).toBe(CONTAINER_ID);
      expect(data(evt).timing).toBe("approximate");
    }

    const start = (id: string) =>
      nested.find((e) => e.type === "tool_call_start" && data(e).tool_use_id === id)!;
    const end = (id: string) =>
      nested.find((e) => e.type === "tool_call_end" && data(e).tool_use_id === id)!;

    // read under wrapper under codemode; ls directly under codemode.
    expect(data(start("c/1/1")).parent_tool_use_id).toBe("c/1");
    expect(data(start("c/1")).parent_tool_use_id).toBe("c");
    expect(data(start("c/2")).parent_tool_use_id).toBe("c");
    expect(
      rows.some((e) => e.type === "tool_call_start" && data(e).tool_use_id === "c"),
    ).toBe(true);

    // End at the tool result entry, start durationMs earlier; persisted rows drop undefined fields.
    expect(end("c/1").timestamp).toBe(t(9));
    expect(start("c/1").timestamp).toBe(t(6));
    expect(data(end("c/1"))).toMatchObject({ nested_status: "ok", duration_ms: 3000 });
    expect(data(end("c/2"))).toMatchObject({ nested_status: "unfinished", is_error: true });
    expect(data(end("c/2"))).not.toHaveProperty("duration_ms");

    // Idempotent: a second pass inserts nothing.
    const second = await runBackfill({ files: [file], db: handle.db, mapper: MAPPER_OPTIONS });
    expect(second.eventsInserted).toBe(0);
    expect(second.eventsSkipped).toBe(first.eventsMapped);
  });
});
