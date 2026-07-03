import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackfill } from "./backfill";

const PI_SESSION_UUID = "11111111-2222-3333-4444-555555555555";
const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RUN_ID = "99999999-8888-7777-6666-555555555555";

const MAPPER_OPTIONS = {
  sessionBinding: { customType: "agent-kernel:session-binding" },
};

function jsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/**
 * A representative Pi session transcript: session line, kernel binding
 * marker, lifecycle markers, a user message, an assistant message with a
 * tool call + usage, and a tool result.
 */
function fixtureSessionLines(): unknown[] {
  const t = (s: number) => `2026-07-01T10:00:${String(s).padStart(2, "0")}.000Z`;
  return [
    { type: "session", version: 3, id: PI_SESSION_UUID, timestamp: t(0), cwd: "/tmp" },
    {
      type: "custom",
      customType: "agent-kernel:session-binding",
      data: {
        containerId: CONTAINER_ID,
        runId: RUN_ID,
        appSessionSlug: "fixture-session",
        appSessionDir: "/tmp/fixture-session",
      },
      id: "e-bind",
      parentId: null,
      timestamp: t(1),
    },
    {
      type: "custom",
      customType: "agent-kernel:pi-lifecycle",
      data: { phase: "agent_start" },
      id: "e-as",
      parentId: null,
      timestamp: t(2),
    },
    {
      type: "custom",
      customType: "agent-kernel:pi-lifecycle",
      data: { phase: "turn_start", turnIndex: 0 },
      id: "e-ts",
      parentId: null,
      timestamp: t(3),
    },
    {
      type: "message",
      id: "e-u1",
      parentId: null,
      timestamp: t(4),
      message: {
        role: "user",
        content: [{ type: "text", text: "What is in a.ts?" }],
        timestamp: 0,
      },
    },
    {
      type: "message",
      id: "e-a1",
      parentId: "e-u1",
      timestamp: t(5),
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the file." },
          { type: "toolCall", id: "tc-1", name: "read", arguments: '{"path":"a.ts"}' },
        ],
        timestamp: 0,
        model: "gpt-5",
        stopReason: "toolUse",
        usage: {
          input: 120,
          output: 40,
          cacheRead: 12,
          cacheWrite: 6,
          totalTokens: 178,
          cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
        },
      },
    },
    {
      type: "message",
      id: "e-tr1",
      parentId: "e-a1",
      timestamp: t(6),
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "export const a = 1;" }],
        timestamp: 0,
        toolCallId: "tc-1",
        toolName: "read",
      },
    },
    {
      type: "custom",
      customType: "agent-kernel:pi-lifecycle",
      data: { phase: "turn_end", turnIndex: 0, stopReason: "toolUse" },
      id: "e-te",
      parentId: null,
      timestamp: t(7),
    },
    {
      type: "custom",
      customType: "agent-kernel:pi-lifecycle",
      data: { phase: "agent_end", inputTokens: 120, outputTokens: 40 },
      id: "e-ae",
      parentId: null,
      timestamp: t(8),
    },
  ];
}

// agent_session_start, pi_agent_start, pi_turn_start, user_message,
// assistant_message, tool_call_start, tool_call_end, pi_turn_end, pi_agent_end
const EXPECTED_EVENT_COUNT = 9;

function countTraceEvents(dbPath: string): number {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const row = sqlite
      .query<{ n: number }, []>("SELECT count(*) AS n FROM trace_events")
      .get();
    return row?.n ?? 0;
  } finally {
    sqlite.close();
  }
}

describe("runBackfill", () => {
  let root: string;
  let jsonlDir: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-kernel-backfill-"));
    jsonlDir = join(root, "pi-sessions");
    dbPath = join(root, ".agent-kernel", "trace.db");
    await mkdir(jsonlDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("imports a fixture session and is idempotent on re-run", async () => {
    await writeFile(join(jsonlDir, "session-1.jsonl"), jsonl(fixtureSessionLines()));

    const first = await runBackfill({ jsonlDir, dbPath, mapper: MAPPER_OPTIONS });
    expect(first.filesProcessed).toBe(1);
    expect(first.eventsMapped).toBe(EXPECTED_EVENT_COUNT);
    expect(first.eventsInserted).toBe(EXPECTED_EVENT_COUNT);
    expect(first.eventsSkipped).toBe(0);
    expect(first.warnings).toEqual([]);
    expect(countTraceEvents(dbPath)).toBe(EXPECTED_EVENT_COUNT);

    const second = await runBackfill({ jsonlDir, dbPath, mapper: MAPPER_OPTIONS });
    expect(second.filesProcessed).toBe(1);
    expect(second.eventsMapped).toBe(EXPECTED_EVENT_COUNT);
    expect(second.eventsInserted).toBe(0);
    expect(second.eventsSkipped).toBe(EXPECTED_EVENT_COUNT);
    expect(countTraceEvents(dbPath)).toBe(EXPECTED_EVENT_COUNT);
  });

  test("stamps containerId, runId, and pi session uuid onto inserted rows", async () => {
    await writeFile(join(jsonlDir, "session-1.jsonl"), jsonl(fixtureSessionLines()));
    await runBackfill({ jsonlDir, dbPath, mapper: MAPPER_OPTIONS });

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const rows = sqlite
        .query<{ container_id: string; run_id: string; pi_session_id: string }, []>(
          "SELECT container_id, run_id, pi_session_id FROM trace_events",
        )
        .all();
      expect(rows).toHaveLength(EXPECTED_EVENT_COUNT);
      for (const row of rows) {
        expect(row.container_id).toBe(CONTAINER_ID);
        expect(row.run_id).toBe(RUN_ID);
        expect(row.pi_session_id).toBe(PI_SESSION_UUID);
      }

      const turnEnd = sqlite
        .query<{ event_data: string }, []>(
          "SELECT event_data FROM trace_events WHERE type = 'pi_turn_end'",
        )
        .get();
      expect(JSON.parse(turnEnd!.event_data).usage).toMatchObject({
        inputTokens: 120,
        outputTokens: 40,
        cacheReadTokens: 12,
        cacheWriteTokens: 6,
        model: "gpt-5",
        costEstimate: 0.3,
      });
    } finally {
      sqlite.close();
    }
  });

  test("respects small batch sizes without double-counting", async () => {
    await writeFile(join(jsonlDir, "session-1.jsonl"), jsonl(fixtureSessionLines()));
    const summary = await runBackfill({
      jsonlDir,
      dbPath,
      mapper: MAPPER_OPTIONS,
      batchSize: 2,
    });
    expect(summary.eventsInserted).toBe(EXPECTED_EVENT_COUNT);
    expect(countTraceEvents(dbPath)).toBe(EXPECTED_EVENT_COUNT);
  });

  test("warns and drops events for a transcript with no binding marker", async () => {
    const lines = fixtureSessionLines().filter(
      (l) => (l as { customType?: string }).customType !== "agent-kernel:session-binding",
    );
    await writeFile(join(jsonlDir, "unbound.jsonl"), jsonl(lines));

    const summary = await runBackfill({ jsonlDir, dbPath, mapper: MAPPER_OPTIONS });
    expect(summary.filesProcessed).toBe(1);
    expect(summary.eventsMapped).toBe(0);
    expect(summary.eventsInserted).toBe(0);
    expect(summary.warnings.some((w) => w.includes("never bound to a container"))).toBe(
      true,
    );
    expect(countTraceEvents(dbPath)).toBe(0);
  });

  test("accepts an explicit files[] list", async () => {
    const filePath = join(jsonlDir, "explicit.jsonl");
    await writeFile(filePath, jsonl(fixtureSessionLines()));
    // Decoy in the same dir that must not be read.
    await writeFile(join(jsonlDir, "other.jsonl"), jsonl(fixtureSessionLines()));

    const summary = await runBackfill({ files: [filePath], dbPath, mapper: MAPPER_OPTIONS });
    expect(summary.filesProcessed).toBe(1);
    expect(countTraceEvents(dbPath)).toBe(EXPECTED_EVENT_COUNT);
  });

  test("warns about malformed lines and partial trailing lines", async () => {
    const good = jsonl(fixtureSessionLines());
    const content = good + "{not json}\n" + '{"type":"session"'; // torn tail
    await writeFile(join(jsonlDir, "session-1.jsonl"), content);

    const summary = await runBackfill({ jsonlDir, dbPath, mapper: MAPPER_OPTIONS });
    expect(summary.eventsInserted).toBe(EXPECTED_EVENT_COUNT);
    expect(summary.warnings.some((w) => w.includes("malformed"))).toBe(true);
    expect(summary.warnings.some((w) => w.includes("partial"))).toBe(true);
  });

  test("throws without a source and without a db target", async () => {
    await expect(runBackfill({ dbPath })).rejects.toThrow(/files.*jsonlDir/);
    await expect(runBackfill({ jsonlDir })).rejects.toThrow(/db.*dbPath/);
  });
});
