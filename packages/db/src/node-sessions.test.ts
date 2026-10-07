import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import {
  createCallEndEvent,
  createCallStartEvent,
  createPiTurnEndEvent,
  createToolCallEndEvent,
  kernelNodeEventId,
  kernelRequestId,
  type CallEndData,
  type CallStartData,
  type TraceEvent,
} from "@agent-kernel/protocol";

import {
  abandonNodeRun,
  claimAndStartNode,
  createAgentRun,
  getAgentRun,
  getContainer,
  getPiAgentSession,
  getTraceEventsForRun,
  hashTraceBlobBytes,
  insertTraceEventsBatch,
  NODE_STALE_GRACE_MS,
  NodeRunNotRunningError,
  persistNodeCompletion,
  upsertContainer,
  upsertPiAgentSession,
  upsertPromotableTraceEvent,
  type NodeCompletion,
  type NodeStartInput,
} from "./actions";
import { ensureKernelObservabilitySchema } from "./bootstrap";
import { openKernelDatabase, type KernelDatabase, type KernelDatabaseHandle } from "./client";
import { RUN_STATUS, RUN_TRIGGER, SESSION_STATUS } from "./schema";
import type { TraceBlobInput } from "./types";

const T0 = Date.parse("2026-10-07T12:00:00.000Z");
const DEADLINE_MS = 12_000;
const STALE_AFTER_MS = 600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let dir: string;
let dbPath: string;
let handle: KernelDatabaseHandle;
let db: KernelDatabase;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-node-sessions-test-"));
  dbPath = join(dir, "trace.db");
  handle = openKernelDatabase({ path: dbPath });
  db = handle.db;
  await ensureKernelObservabilitySchema(db);
  await upsertContainer(db, { id: "c1", kernelId: "kern-1", kind: "session", appKey: ["req-1"] });
  await upsertPiAgentSession(db, {
    id: "worker-session",
    containerId: "c1",
    agentName: "worker",
    status: SESSION_STATUS.ACTIVE,
    createdAt: iso(T0 - 60_000),
  });
  await createAgentRun(db, {
    id: "parent-run",
    piSessionId: "worker-session",
    containerId: "c1",
    agentName: "worker",
    trigger: RUN_TRIGGER.OPERATOR,
    status: RUN_STATUS.RUNNING,
    startedAt: iso(T0 - 60_000),
  });
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

// ─── builders ───────────────────────────────────────────────────────────────

function blob(kind: string, text: string): TraceBlobInput {
  const data = Buffer.from(text);
  return {
    hash: hashTraceBlobBytes(data),
    kind,
    mimeType: "application/json",
    byteLength: data.byteLength,
    data,
    createdAt: iso(T0),
  };
}

function startInput(
  opts: { runId: string; requestId?: string; nowMs?: number; parentRunId?: string | null } & Partial<
    Pick<NodeStartInput, "staleAfterMs">
  >,
): NodeStartInput {
  const nowMs = opts.nowMs ?? T0;
  const sessionId =
    opts.requestId === undefined
      ? `session-${opts.runId}`
      : kernelRequestId("kern-1", "session", opts.requestId);
  const startedAt = iso(nowMs);
  const deadlineAt = iso(nowMs + DEADLINE_MS);
  const input = blob("call-input", JSON.stringify({ text: `input for ${opts.runId}` }));
  const parentRunId = opts.parentRunId === undefined ? "parent-run" : opts.parentRunId;
  return {
    kind: "call",
    sessionId,
    runId: opts.runId,
    requestId: opts.requestId,
    containerId: "c1",
    agentName: "ExtractThing",
    displayLabel: "extract thing",
    model: "codex-lb/gpt-5.6-sol",
    promptHash: "baml1-abc",
    parentRunId,
    trigger: RUN_TRIGGER.POST_RUN,
    startedAt,
    startEvent: createCallStartEvent(
      { containerId: "c1", runId: opts.runId, piSessionUuid: sessionId },
      {
        run_id: opts.runId,
        node_kind: "call",
        function_name: "ExtractThing",
        engine: "baml",
        transport: "baml-http",
        model: "codex-lb/gpt-5.6-sol",
        prompt_hash: "baml1-abc",
        input_blob_hash: input.hash,
        trigger: RUN_TRIGGER.POST_RUN,
        ...(parentRunId !== null && { parent_run_id: parentRunId }),
        ...(opts.requestId !== undefined && { request_id: opts.requestId }),
        deadline_at: deadlineAt,
      },
      { eventId: kernelNodeEventId(opts.runId, 0, "call_start"), timestamp: startedAt },
    ),
    startBlobs: [input],
    staleAfterMs: opts.staleAfterMs ?? STALE_AFTER_MS,
    nowMs,
    deadlineAt,
  };
}

function completion(
  start: NodeStartInput,
  overrides: Partial<NodeCompletion> = {},
): NodeCompletion {
  const runId = start.runId;
  const ids = { containerId: "c1", runId, piSessionUuid: start.sessionId };
  const callStartId = start.startEvent.eventId;
  const endedAt = iso(start.nowMs + 1_500);
  const output = blob("call-output", JSON.stringify({ ok: true, runId }));
  const turnEnd = createPiTurnEndEvent(ids, {
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      model: "codex-lb/gpt-5.6-sol",
      costEstimate: 0.25,
    },
    eventId: kernelNodeEventId(runId, 0, "pi_turn_end"),
    parentEventId: callStartId,
    timestamp: iso(start.nowMs + 1_400),
  });
  const callEnd = createCallEndEvent(
    ids,
    {
      run_id: runId,
      node_kind: "call",
      function_name: "ExtractThing",
      status: "ok",
      output_blob_hash: output.hash,
      attempts: 1,
      duration_ms: 1_500,
    },
    { eventId: kernelNodeEventId(runId, 0, "call_end"), parentEventId: callStartId, timestamp: endedAt },
  );
  return {
    runId,
    sessionId: start.sessionId,
    containerId: "c1",
    runStatus: "done",
    sessionStatus: "ended",
    endedAt,
    events: [turnEnd, callEnd],
    blobs: [output],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      costEstimate: 0.25,
    },
    ...overrides,
  };
}

// ─── row readers ────────────────────────────────────────────────────────────

function count(table: string, where = "1 = 1"): number {
  return db.all<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0]!.n;
}

function usageRow(table: string, id: string) {
  return db.all<{ input: number; output: number; cost: number | null }>(
    `SELECT usage_input_tokens AS input, usage_output_tokens AS output, ${
      table === "pi_agent_sessions" ? "NULL" : "usage_cost_estimate"
    } AS cost FROM ${table} WHERE id = '${id}'`,
  )[0];
}

function eventData(eventId: string): Record<string, unknown> | undefined {
  const row = db.all<{ event_data: string }>(
    `SELECT event_data FROM trace_events WHERE event_id = '${eventId}'`,
  )[0];
  return row ? (JSON.parse(row.event_data) as Record<string, unknown>) : undefined;
}

// ─── claim ──────────────────────────────────────────────────────────────────

describe("claimAndStartNode", () => {
  test("claimAndStartNode commits session, run and call_start together; inbound_event_id equals call_start id", async () => {
    const start = startInput({ runId: "run-a", requestId: "req-1" });

    const claim = await claimAndStartNode(db, start);

    expect(claim).toEqual({ kind: "claimed", runId: "run-a", attempt: 1, abandonedRunIds: [] });
    const session = await getPiAgentSession(db, start.sessionId);
    expect(session).toMatchObject({
      kind: "call",
      status: "active",
      agentName: "ExtractThing",
      model: "codex-lb/gpt-5.6-sol",
      promptHash: "baml1-abc",
      parentSessionId: null,
      endedAt: null,
    });
    const run = await getAgentRun(db, "run-a");
    expect(run).toMatchObject({
      piSessionId: start.sessionId,
      containerId: "c1",
      parentRunId: "parent-run",
      trigger: "post-run",
      status: "running",
      inboundEventId: kernelNodeEventId("run-a", 0, "call_start"),
      outboundEventId: null,
    });
    const [stored] = await getTraceEventsForRun(db, "run-a");
    expect(stored?.eventId).toBe(run?.inboundEventId!);
    expect(stored?.type).toBe("call_start");
    expect(stored?.piSessionUuid).toBe(start.sessionId);
    // The claim stamps the deadline and the attempt it allocated.
    expect(stored?.eventData).toMatchObject({ deadline_at: start.deadlineAt, attempt: 1 });
    expect(count("trace_blobs", `hash = '${start.startBlobs[0]!.hash}'`)).toBe(1);
  });

  test("claimAndStartNode writes nothing when a write fails", async () => {
    // The last write of the claim (the call_start insert) fails after the
    // session, run and blob rows were written inside the transaction.
    db.run(`CREATE TRIGGER fail_call_start BEFORE INSERT ON trace_events
      WHEN NEW.type = 'call_start'
        AND (SELECT count(*) FROM agent_runs WHERE id = 'run-a') = 1
        AND (SELECT count(*) FROM pi_agent_sessions WHERE kind = 'call') = 1
      BEGIN SELECT RAISE(ABORT, 'injected start write failure'); END`);
    const start = startInput({ runId: "run-a", requestId: "req-1" });

    await expect(claimAndStartNode(db, start)).rejects.toThrow("injected start write failure");

    expect(count("pi_agent_sessions", "kind = 'call'")).toBe(0);
    expect(count("agent_runs", "id = 'run-a'")).toBe(0);
    expect(count("trace_blobs")).toBe(0);
    expect(count("trace_events")).toBe(0);
  });

  test("rejects an unknown parent run before any row", async () => {
    const start = startInput({ runId: "run-a", requestId: "req-1" });
    start.parentRunId = "no-such-run";

    await expect(claimAndStartNode(db, start)).rejects.toThrow(/FOREIGN KEY/);

    expect(count("pi_agent_sessions")).toBe(1); // only the worker session
    expect(count("agent_runs")).toBe(1); // only the parent run
    expect(count("trace_blobs")).toBe(0);
    expect(count("trace_events")).toBe(0);
  });

  test("claim returns replay for a done run, in-flight for a fresh running run, and abandons a stale one in the same transaction", async () => {
    const first = startInput({ runId: "run-a", requestId: "req-1" });
    expect((await claimAndStartNode(db, first)).kind).toBe("claimed");
    const staleAt = T0 + DEADLINE_MS + NODE_STALE_GRACE_MS;

    // Fresh up to and including deadline + grace: nothing written.
    for (const nowMs of [T0 + 1_000, staleAt]) {
      const claim = await claimAndStartNode(
        db,
        startInput({ runId: `run-early-${nowMs}`, requestId: "req-1", nowMs }),
      );
      expect(claim).toEqual({ kind: "in-flight", runId: "run-a" });
    }
    expect(count("agent_runs", `pi_session_id = '${first.sessionId}'`)).toBe(1);
    expect(count("trace_events")).toBe(1);

    // Past deadline + grace: abandon run-a and claim attempt 2, atomically.
    const second = startInput({ runId: "run-b", requestId: "req-1", nowMs: staleAt + 1 });
    expect(await claimAndStartNode(db, second)).toEqual({
      kind: "claimed",
      runId: "run-b",
      attempt: 2,
      abandonedRunIds: ["run-a"],
    });

    const abandoned = await getAgentRun(db, "run-a");
    const synthesizedId = kernelNodeEventId("run-a", 0, "call_end");
    expect(abandoned).toMatchObject({
      status: "aborted",
      outboundEventId: synthesizedId,
      endedAt: iso(staleAt + 1),
    });
    const [callEnd] = await getTraceEventsForRun(db, "run-a", ["call_end"]);
    expect(callEnd).toMatchObject({
      eventId: synthesizedId,
      parentEventId: first.startEvent.eventId,
      piSessionUuid: first.sessionId,
      timestamp: iso(staleAt + 1),
    });
    expect(callEnd?.eventData).toEqual({
      run_id: "run-a",
      node_kind: "call",
      function_name: "ExtractThing",
      status: "aborted",
      error: {
        kind: "abandoned",
        message: "run was still running past its operation deadline; recovered",
      },
      attempts: 0,
      duration_ms: staleAt + 1 - T0,
    } satisfies CallEndData);
    expect(await getAgentRun(db, "run-b")).toMatchObject({ status: "running" });
    expect(await getPiAgentSession(db, first.sessionId)).toMatchObject({
      status: "active",
      endedAt: null,
    });
    expect(eventData(second.startEvent.eventId)).toMatchObject({ attempt: 2 });

    // Once an attempt is done, every later claim replays it and writes nothing.
    await persistNodeCompletion(db, completion(second));
    const eventsBefore = count("trace_events");
    const replay = await claimAndStartNode(
      db,
      startInput({ runId: "run-c", requestId: "req-1", nowMs: staleAt + 10_000 }),
    );
    expect(replay).toEqual({ kind: "replay", runId: "run-b" });
    expect(count("trace_events")).toBe(eventsBefore);
    expect(count("agent_runs", "id = 'run-c'")).toBe(0);
  });

  test("a running run without deadline_at goes stale after staleAfterMs", async () => {
    const sessionId = kernelRequestId("kern-1", "session", "req-legacy");
    await upsertPiAgentSession(db, {
      id: sessionId,
      containerId: "c1",
      agentName: "ExtractThing",
      status: SESSION_STATUS.ACTIVE,
      kind: "call",
      createdAt: iso(T0),
    });
    await createAgentRun(db, {
      id: "run-legacy",
      piSessionId: sessionId,
      containerId: "c1",
      agentName: "ExtractThing",
      trigger: RUN_TRIGGER.SYSTEM,
      inboundEventId: "legacy-start",
      status: RUN_STATUS.RUNNING,
      startedAt: iso(T0),
    });
    // A start event written before call_start carried deadline_at.
    const legacyStart = createCallStartEvent(
      { containerId: "c1", runId: "run-legacy", piSessionUuid: sessionId },
      {
        run_id: "run-legacy",
        node_kind: "call",
        function_name: "ExtractThing",
        engine: "baml",
        model: "codex-lb/gpt-5.6-sol",
        prompt_hash: "baml1-abc",
        input_blob_hash: "b1-x",
        trigger: "system",
        deadline_at: "",
      },
      { eventId: "legacy-start", timestamp: iso(T0) },
    );
    const { deadline_at: _deadline, ...legacyData } = legacyStart.eventData as CallStartData;
    await insertTraceEventsBatch(db, [{ ...legacyStart, eventData: legacyData }]);
    const staleAfterMs = 5_000;

    const early = await claimAndStartNode(
      db,
      startInput({ runId: "run-x", requestId: "req-legacy", nowMs: T0 + staleAfterMs, staleAfterMs }),
    );
    const late = await claimAndStartNode(
      db,
      startInput({ runId: "run-y", requestId: "req-legacy", nowMs: T0 + staleAfterMs + 1, staleAfterMs }),
    );

    expect(early).toEqual({ kind: "in-flight", runId: "run-legacy" });
    expect(late).toMatchObject({ kind: "claimed", attempt: 2, abandonedRunIds: ["run-legacy"] });
  });

  test("retries BEGIN IMMEDIATE while another writer holds the lock", async () => {
    const locker = new Database(dbPath);
    locker.exec("BEGIN IMMEDIATE");
    setTimeout(() => {
      locker.exec("COMMIT");
      locker.close();
    }, 120);
    const startedAt = Date.now();

    const claim = await claimAndStartNode(db, startInput({ runId: "run-a", requestId: "req-1" }));

    expect(claim.kind).toBe("claimed");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
  });
});

// ─── completion ─────────────────────────────────────────────────────────────

describe("persistNodeCompletion", () => {
  test("completion rolls back after partial mutations", async () => {
    const start = startInput({ runId: "run-a", requestId: "req-1" });
    await claimAndStartNode(db, start);
    const done = completion(start);
    // Fires on the last write (session status) and only once the blobs,
    // events, usage and run status of this completion are visible in the
    // transaction, so the rollback below undoes real partial mutations.
    db.run(`CREATE TRIGGER fail_after_partial BEFORE UPDATE OF status ON pi_agent_sessions
      WHEN NEW.id = '${start.sessionId}'
        AND (SELECT count(*) FROM trace_blobs WHERE hash = '${done.blobs[0]!.hash}') = 1
        AND (SELECT count(*) FROM trace_events WHERE run_id = 'run-a' AND type = 'call_end') = 1
        AND (SELECT usage_input_tokens FROM containers WHERE id = 'c1') = 100
        AND (SELECT status FROM agent_runs WHERE id = 'run-a') = 'done'
      BEGIN SELECT RAISE(ABORT, 'injected after partial mutations'); END`);

    await expect(persistNodeCompletion(db, done)).rejects.toThrow(
      "injected after partial mutations",
    );

    expect((await getTraceEventsForRun(db, "run-a")).map((e) => e.type)).toEqual(["call_start"]);
    expect(count("trace_blobs", `hash = '${done.blobs[0]!.hash}'`)).toBe(0);
    expect(await getAgentRun(db, "run-a")).toMatchObject({
      status: "running",
      outboundEventId: null,
      endedAt: null,
      usageInputTokens: 0,
      usageCostEstimate: null,
    });
    expect(usageRow("pi_agent_sessions", start.sessionId)).toMatchObject({ input: 0, output: 0 });
    expect(usageRow("containers", "c1")).toEqual({ input: 0, output: 0, cost: null });
    expect((await getPiAgentSession(db, start.sessionId))?.status).toBe("active");
  });

  test("persistNodeCompletion marks done only with its events; a failing event rolls back status", async () => {
    const start = startInput({ runId: "run-a", requestId: "req-1" });
    await claimAndStartNode(db, start);
    const done = completion(start);
    db.run(`CREATE TRIGGER fail_call_end BEFORE INSERT ON trace_events
      WHEN NEW.type = 'call_end' BEGIN SELECT RAISE(ABORT, 'injected event failure'); END`);

    await expect(persistNodeCompletion(db, done)).rejects.toThrow("injected event failure");
    expect(await getAgentRun(db, "run-a")).toMatchObject({ status: "running", usageInputTokens: 0 });
    expect(count("trace_events", "run_id = 'run-a'")).toBe(1);
    expect(count("trace_blobs", `hash = '${done.blobs[0]!.hash}'`)).toBe(0);

    db.run("DROP TRIGGER fail_call_end");
    await persistNodeCompletion(db, done);

    const callEndId = kernelNodeEventId("run-a", 0, "call_end");
    expect(await getAgentRun(db, "run-a")).toMatchObject({
      status: "done",
      outboundEventId: callEndId,
      endedAt: done.endedAt,
      usageInputTokens: 100,
      usageOutputTokens: 20,
      usageCacheRead: 5,
      usageCacheWrite: 1,
      usageCostEstimate: 0.25,
    });
    expect((await getTraceEventsForRun(db, "run-a")).map((e) => e.type)).toEqual([
      "call_start",
      "pi_turn_end",
      "call_end",
    ]);
    expect(await getPiAgentSession(db, start.sessionId)).toMatchObject({
      status: "ended",
      endedAt: done.endedAt,
      usageInputTokens: 100,
      usageOutputTokens: 20,
    });
    expect(usageRow("containers", "c1")).toEqual({ input: 100, output: 20, cost: 0.25 });
    expect((await getContainer(db, "c1"))?.usageCacheRead).toBe(5);
  });

  test("a late completion after the run was abandoned changes nothing", async () => {
    const start = startInput({ runId: "run-a", requestId: "req-1" });
    await claimAndStartNode(db, start);
    await abandonNodeRun(db, {
      runId: "run-a",
      sessionId: start.sessionId,
      containerId: "c1",
      at: iso(T0 + 100_000),
    });
    const eventsBefore = count("trace_events");

    await expect(persistNodeCompletion(db, completion(start))).rejects.toBeInstanceOf(
      NodeRunNotRunningError,
    );

    expect(await getAgentRun(db, "run-a")).toMatchObject({ status: "aborted", usageInputTokens: 0 });
    expect(count("trace_events")).toBe(eventsBefore);
    expect(
      (await getTraceEventsForRun(db, "run-a", ["call_end"]))[0]?.eventData,
    ).toMatchObject({ status: "aborted" });
    expect(usageRow("containers", "c1")).toEqual({ input: 0, output: 0, cost: null });
  });
});

// ─── abandon ────────────────────────────────────────────────────────────────

describe("abandonNodeRun", () => {
  test("abandonNodeRun writes an aborted call_end, sets run aborted and session error, and keeps an existing real call_end", async () => {
    const crashed = startInput({ runId: "run-a" });
    await claimAndStartNode(db, crashed);
    const at = iso(T0 + 30_000);

    await abandonNodeRun(db, { runId: "run-a", sessionId: crashed.sessionId, containerId: "c1", at });

    const synthesizedId = kernelNodeEventId("run-a", 0, "call_end");
    expect(await getAgentRun(db, "run-a")).toMatchObject({
      status: "aborted",
      outboundEventId: synthesizedId,
      endedAt: at,
    });
    expect(await getPiAgentSession(db, crashed.sessionId)).toMatchObject({
      status: "error",
      endedAt: at,
    });
    expect(eventData(synthesizedId)).toMatchObject({
      run_id: "run-a",
      status: "aborted",
      error: { kind: "abandoned" },
      duration_ms: 30_000,
    });

    // A run that already has its real call_end keeps it.
    const ended = startInput({ runId: "run-b" });
    await claimAndStartNode(db, ended);
    const realEnd = completion(ended).events.at(-1)!;
    await insertTraceEventsBatch(db, [realEnd]);
    await abandonNodeRun(db, { runId: "run-b", sessionId: ended.sessionId, containerId: "c1", at });

    expect(eventData(realEnd.eventId)).toMatchObject({ status: "ok", attempts: 1 });
    expect(count("trace_events", "run_id = 'run-b' AND type = 'call_end'")).toBe(1);
    expect(await getAgentRun(db, "run-b")).toMatchObject({
      status: "aborted",
      outboundEventId: realEnd.eventId,
    });

    // A run that is no longer running is left untouched.
    const finished = startInput({ runId: "run-c" });
    await claimAndStartNode(db, finished);
    await persistNodeCompletion(db, completion(finished));
    const eventsBefore = count("trace_events");
    await abandonNodeRun(db, { runId: "run-c", sessionId: finished.sessionId, containerId: "c1", at });
    expect(await getAgentRun(db, "run-c")).toMatchObject({ status: "done" });
    expect((await getPiAgentSession(db, finished.sessionId))?.status).toBe("ended");
    expect(count("trace_events")).toBe(eventsBefore);
  });
});

// ─── trace events ───────────────────────────────────────────────────────────

describe("trace event reads and promotable upserts", () => {
  function nestedEnd(timing: "live" | "approximate", timestamp: string): TraceEvent {
    return createToolCallEndEvent(
      { containerId: "c1", runId: "parent-run", piSessionUuid: "worker-session" },
      "read",
      "codemode/1",
      {
        toolOutput: timing,
        spanId: "codemode/1",
        parentToolUseId: "codemode",
        nested: true,
        timing,
        eventId: "nested-end-1",
        timestamp,
      },
    );
  }

  test("upsertPromotableTraceEvent: approximate → live promotes; live → approximate keeps", async () => {
    const approximate = nestedEnd("approximate", iso(T0));
    const live = nestedEnd("live", iso(T0 + 250));

    expect(await upsertPromotableTraceEvent(db, approximate)).toBe("inserted");
    expect(await upsertPromotableTraceEvent(db, live)).toBe("promoted");
    expect(eventData("nested-end-1")).toMatchObject({ timing: "live" });
    expect((await getTraceEventsForRun(db, "parent-run"))[0]?.timestamp).toBe(iso(T0 + 250));

    expect(await upsertPromotableTraceEvent(db, approximate)).toBe("kept");
    expect(await upsertPromotableTraceEvent(db, live)).toBe("kept");
    expect(eventData("nested-end-1")).toMatchObject({ timing: "live" });
    expect(count("trace_events", "event_id = 'nested-end-1'")).toBe(1);

    // Live first: a later approximate row never replaces it.
    await db.run("DELETE FROM trace_events");
    expect(await upsertPromotableTraceEvent(db, live)).toBe("inserted");
    expect(await upsertPromotableTraceEvent(db, approximate)).toBe("kept");
    expect(eventData("nested-end-1")).toMatchObject({ timing: "live" });
  });

  test("getTraceEventsForRun returns the run's envelopes oldest first, optionally by type", async () => {
    const start = startInput({ runId: "run-a" });
    await claimAndStartNode(db, start);
    const done = completion(start);
    await persistNodeCompletion(db, done);

    const all = await getTraceEventsForRun(db, "run-a");
    expect(all.map((e) => e.type)).toEqual(["call_start", "pi_turn_end", "call_end"]);
    expect(all[2]).toEqual(JSON.parse(JSON.stringify(done.events[1])));
    expect((await getTraceEventsForRun(db, "run-a", ["call_end", "pi_turn_end"])).map((e) => e.type)).toEqual([
      "pi_turn_end",
      "call_end",
    ]);
    expect(await getTraceEventsForRun(db, "no-such-run")).toEqual([]);
  });
});

// ─── synchronous transaction callbacks (source scan) ────────────────────────

interface FunctionInfo {
  name: string;
  file: string;
  isAsync: boolean;
  node: ts.FunctionDeclaration;
}

const actionsDir = join(import.meta.dir, "actions");

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function isAsyncNode(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

/** Top-level function declarations of every non-test file in actions/ plus ./upgrade.ts. */
function functionIndex(): Map<string, FunctionInfo[]> {
  const files = [
    ...readdirSync(actionsDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(actionsDir, name)),
    join(import.meta.dir, "upgrade.ts"),
  ];
  const index = new Map<string, FunctionInfo[]>();
  for (const file of files) {
    for (const statement of sourceFile(file).statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      const info = {
        name: statement.name.text,
        file,
        isAsync: isAsyncNode(statement),
        node: statement,
      };
      index.set(info.name, [...(index.get(info.name) ?? []), info]);
    }
  }
  return index;
}

/**
 * Violations for every transaction callback in `file`: callbacks passed to
 * `.transaction(` or to `runImmediateTransaction(`. A callback (and every
 * local function it reaches) must not be async, must not await, and must not
 * call an async function.
 */
function transactionViolations(
  file: string,
  index: Map<string, FunctionInfo[]>,
): { callbacks: number; directTransactionCalls: string[]; violations: string[] } {
  const sf = sourceFile(file);
  const violations: string[] = [];
  const directTransactionCalls: string[] = [];
  let callbacks = 0;
  const visited = new Set<ts.Node>();

  const enclosingFunctionName = (node: ts.Node): string | undefined => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    }
    return undefined;
  };

  const checkBody = (fn: ts.Node, label: string) => {
    if (visited.has(fn)) return;
    visited.add(fn);
    if (isAsyncNode(fn)) violations.push(`${label}: async callback`);
    const walk = (node: ts.Node) => {
      if (ts.isAwaitExpression(node)) violations.push(`${label}: await inside a transaction`);
      if (ts.isForOfStatement(node) && node.awaitModifier) {
        violations.push(`${label}: for await inside a transaction`);
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (isAsyncNode(node)) violations.push(`${label}: async closure inside a transaction`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const callee of index.get(node.expression.text) ?? []) {
          if (callee.isAsync) {
            violations.push(`${label}: calls async ${callee.name} inside a transaction`);
          } else {
            checkBody(callee.node, `${label} → ${callee.name}`);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(fn, walk);
  };

  const checkCallback = (arg: ts.Expression | undefined, label: string) => {
    if (!arg) return;
    callbacks += 1;
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      checkBody(arg, label);
    } else if (ts.isIdentifier(arg)) {
      const local = index.get(arg.text);
      if (local) for (const fn of local) checkBody(fn.node, `${label} → ${fn.name}`);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const where = `${file.split("/").pop()}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "transaction") {
        directTransactionCalls.push(enclosingFunctionName(node) ?? where);
        const fn = enclosingFunctionName(node);
        // The one choke point passes its (type-guarded) parameter straight through.
        if (fn !== "runImmediateTransaction") checkCallback(node.arguments[0], where);
      }
      if (ts.isIdentifier(callee) && callee.text === "runImmediateTransaction") {
        checkCallback(node.arguments[1], where);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { callbacks, directTransactionCalls, violations };
}

describe("synchronous transactions", () => {
  test("transaction callbacks are synchronous", () => {
    const index = functionIndex();
    const scanned = ["tx-local.ts", "node-sessions.ts", "trace-events.ts"].map((name) =>
      transactionViolations(join(actionsDir, name), index),
    );

    expect(scanned.flatMap((s) => s.violations)).toEqual([]);
    // Non-vacuous: claim, completion, abandon and the promotable upsert.
    expect(scanned.reduce((n, s) => n + s.callbacks, 0)).toBeGreaterThanOrEqual(4);
    // Every transaction goes through the one BEGIN IMMEDIATE choke point.
    expect(scanned.flatMap((s) => s.directTransactionCalls)).toEqual(["runImmediateTransaction"]);
    // The transaction-local helpers themselves are synchronous.
    const txHelpers = [...index.values()]
      .flat()
      .filter((fn) => fn.file.endsWith("tx-local.ts") && fn.name.endsWith("Tx"));
    expect(txHelpers.length).toBeGreaterThanOrEqual(8);
    expect(txHelpers.filter((fn) => fn.isAsync).map((fn) => fn.name)).toEqual([]);
  });

  test("the scan flags an async transaction callback (read-api.ts, a recorded follow-up)", () => {
    const { violations } = transactionViolations(join(actionsDir, "read-api.ts"), functionIndex());
    expect(violations.some((v) => v.includes("async callback"))).toBe(true);
    expect(violations.some((v) => v.includes("await inside a transaction"))).toBe(true);
  });
});
