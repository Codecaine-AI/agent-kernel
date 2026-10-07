/**
 * The shared call/decision lifecycle (plan §4.6) against a real temp
 * database: acknowledged start before the engine, acknowledged completion,
 * in-process coalescing, and the BEGIN IMMEDIATE claim as the arbiter across
 * kernel instances and processes. The "engine" is fakeNodeSpec's invoke hook.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
	agentRuns,
	getAgentRun,
	getPiAgentSession,
	getTraceEventsForRun,
	type KernelDatabase,
} from "@agent-kernel/db";
import { kernelNodeEventId, type CallEndData, type CallStartData } from "@agent-kernel/protocol";

import { runTraceDoctor } from "../doctor";
import { fakeNodeSpec, type FakeNodeOutcome } from "./__fixtures__/fake-node";
import { createTempKernelDb, disableNetwork, type TempKernelDb } from "./__fixtures__/temp-kernel";
import { createModelNodeContext, type ModelNodeLogger } from "./context";
import { createCallKit } from "./call/__fixtures__/call-kit";
import { fakeOk } from "./call/__fixtures__/fake-call-engine";
import { REQUEST_MISMATCH_MESSAGE, runModelNode, type NodeRunResult } from "./node-run";
import { KernelNodeError, type NodeIds } from "./types";

let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
});
afterAll(() => {
	restoreFetch();
});

let temp: TempKernelDb;
beforeEach(async () => {
	temp = await createTempKernelDb();
});
afterEach(() => {
	temp.cleanup();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function contextFor(db: KernelDatabase, opts: { now?: () => number; logger?: ModelNodeLogger } = {}) {
	return createModelNodeContext({ kernelId: temp.kernelId, db, ...opts });
}

function scope() {
	return { containerId: temp.containerId, trigger: "system" as const };
}

async function expectNodeError(promise: Promise<unknown>, code: KernelNodeError["code"]): Promise<KernelNodeError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(KernelNodeError);
		expect((error as KernelNodeError).code).toBe(code);
		return error as KernelNodeError;
	}
	throw new Error(`expected KernelNodeError(${code})`);
}

function countRows(db: KernelDatabase, table: string): number {
	const [row] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`);
	if (typeof row?.n !== "number") throw new Error(`count(${table}) returned no number`);
	return row.n;
}

/**
 * A scheduling barrier at a handle's claim transaction: until `open()`, its
 * `transaction()` (BEGIN IMMEDIATE) throws SQLITE_BUSY, which the claim
 * retries (50–800 ms backoff); `reached` resolves at the first attempt, after
 * every read the lifecycle makes before claiming. Reads pass through.
 */
function holdClaimTransactions(db: KernelDatabase): { db: KernelDatabase; reached: Promise<void>; open(): void } {
	let opened = false;
	let markReached!: () => void;
	const reached = new Promise<void>((resolve) => {
		markReached = resolve;
	});
	const gated = new Proxy(db, {
		get(target, prop) {
			const value: unknown = Reflect.get(target, prop, target);
			if (prop === "transaction") {
				return (...args: unknown[]) => {
					if (!opened) {
						markReached();
						throw Object.assign(new Error("database is locked (held by the test)"), { code: "SQLITE_BUSY" });
					}
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return {
		db: gated,
		reached,
		open() {
			opened = true;
		},
	};
}

async function expectDoctorOk(db: KernelDatabase): Promise<void> {
	const report = await runTraceDoctor(db);
	expect(report.violations).toEqual([]);
	expect(report.ok).toBe(true);
}

describe("runModelNode", () => {
	test("start failure never invokes the engine", async () => {
		let invocations = 0;
		const before = {
			sessions: countRows(temp.db, "pi_agent_sessions"),
			runs: countRows(temp.db, "agent_runs"),
			events: countRows(temp.db, "trace_events"),
			blobs: countRows(temp.db, "trace_blobs"),
		};
		const err = await expectNodeError(
			runModelNode(
				contextFor(temp.db),
				fakeNodeSpec({
					// No such container: the claim's session insert violates its FK.
					scope: { containerId: "no-such-container", trigger: "system" },
					invoke: () => {
						invocations++;
					},
				}),
			),
			"row-write-failed",
		);
		expect(err.cause).toBeDefined();
		expect(invocations).toBe(0);
		expect({
			sessions: countRows(temp.db, "pi_agent_sessions"),
			runs: countRows(temp.db, "agent_runs"),
			events: countRows(temp.db, "trace_events"),
			blobs: countRows(temp.db, "trace_blobs"),
		}).toEqual(before);
	});

	test("ids are allocated before the start write; the engine runs only after the claim committed", async () => {
		let started: NodeIds | undefined;
		let seenInsideEngine: { runStatus?: string; sessionKind?: string; inbound?: string | null; startType?: string } = {};
		const parent = await temp.seedParentRun();
		const result = await runModelNode(
			contextFor(temp.db),
			fakeNodeSpec({
				kind: "call",
				scope: { containerId: temp.containerId, parentRunId: parent.runId, trigger: "post-run" },
				onNodeStarted: (ids) => {
					started = ids;
				},
				async invoke(run) {
					expect(started).toEqual(run.ids);
					const row = await getAgentRun(temp.db, run.ids.runId);
					const session = await getPiAgentSession(temp.db, run.ids.sessionId);
					const [start] = await getTraceEventsForRun(temp.db, run.ids.runId, ["call_start"]);
					seenInsideEngine = {
						runStatus: row?.status,
						sessionKind: session?.kind,
						inbound: row?.inboundEventId,
						startType: start?.type,
					};
				},
			}),
		);
		const startId = kernelNodeEventId(result.ids.runId, 0, "call_start");
		expect(seenInsideEngine).toEqual({ runStatus: "running", sessionKind: "call", inbound: startId, startType: "call_start" });
		expect(result.ids).toEqual({
			containerId: temp.containerId,
			sessionId: result.ids.sessionId,
			runId: result.ids.runId,
			parentRunId: parent.runId,
		});

		const run = await getAgentRun(temp.db, result.ids.runId);
		expect(run).toMatchObject({ status: "done", trigger: "post-run", parentRunId: parent.runId, inboundEventId: startId });
		expect(run?.outboundEventId).toBe(kernelNodeEventId(result.ids.runId, 0, "call_end"));
		const events = await getTraceEventsForRun(temp.db, result.ids.runId);
		expect(events.map((e) => e.type)).toEqual(["call_start", "pi_turn_start", "pi_turn_end", "call_end"]);
		const startData = events[0]!.eventData as CallStartData;
		expect(Date.parse(startData.deadline_at) - Date.parse(events[0]!.timestamp)).toBe(60_000);
		expect(startData.parent_run_id).toBe(parent.runId);
		for (const child of events.slice(1)) expect(child.parentEventId).toBe(startId);
		const timestamps = events.map((e) => Date.parse(e.timestamp));
		for (let i = 1; i < timestamps.length; i++) expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]!);
		expect((await getPiAgentSession(temp.db, result.ids.sessionId))?.status).toBe("ended");
		await expectDoctorOk(temp.db);
	});

	test("completion failure leaves the run running and surfaces row-write-failed", async () => {
		let invocations = 0;
		const requestId = "req-completion-failure";
		const deadlineMs = 1_000;
		const first = await expectNodeError(
			runModelNode(
				contextFor(temp.db),
				fakeNodeSpec({
					scope: scope(),
					requestId,
					deadlineMs,
					invoke: () => {
						invocations++;
						// The process "crashes" between the engine and the completion write.
						temp.handle.close();
					},
				}),
			),
			"row-write-failed",
		);
		expect(first.value).toMatchObject({ answer: "yes" });
		expect(invocations).toBe(1);

		// Reopen the database: the first attempt is still running.
		const reopened = temp.openHandle();
		const [stuck] = reopened.db.select().from(agentRuns).where(eq(agentRuns.status, "running")).all();
		expect(stuck).toBeDefined();
		const stuckStart = (await getTraceEventsForRun(reopened.db, stuck!.id, ["call_start"]))[0]!;
		const deadlineAtMs = Date.parse((stuckStart.eventData as CallStartData).deadline_at);

		// A new kernel instance before deadline + grace: the attempt is still owned.
		const early = contextFor(reopened.db, { now: () => deadlineAtMs + 59_000 });
		await expectNodeError(runModelNode(early, fakeNodeSpec({ scope: scope(), requestId })), "in-flight-elsewhere");

		// Past deadline_at + 60 s grace: recovery abandons the stuck attempt and claims a new one.
		const later = contextFor(reopened.db, { now: () => deadlineAtMs + 60_001 });
		const retried = await runModelNode(
			later,
			fakeNodeSpec({
				scope: scope(),
				requestId,
				invoke: () => {
					invocations++;
				},
			}),
		);
		expect(invocations).toBe(2);
		expect(retried.attempt).toBe(2);
		expect(retried.replayed).toBe(false);
		expect(retried.ids.sessionId).toBe(stuck!.piSessionId);

		const abandoned = await getAgentRun(reopened.db, stuck!.id);
		expect(abandoned?.status).toBe("aborted");
		const abandonedEnd = (await getTraceEventsForRun(reopened.db, stuck!.id, ["call_end"]))[0]!;
		expect(abandonedEnd.eventId).toBe(kernelNodeEventId(stuck!.id, 0, "call_end"));
		expect((abandonedEnd.eventData as CallEndData).status).toBe("aborted");
		expect((await getAgentRun(reopened.db, retried.ids.runId))?.status).toBe("done");
		expect((await getPiAgentSession(reopened.db, retried.ids.sessionId))?.status).toBe("ended");

		// A third request replays the done attempt without invoking the engine.
		const replay = await runModelNode(later, fakeNodeSpec({ scope: scope(), requestId, answer: "ignored" }));
		expect(replay).toMatchObject({ replayed: true, coalesced: false, outcome: { answer: "yes", runId: retried.ids.runId } });
		expect(invocations).toBe(2);
		await expectDoctorOk(reopened.db);
	});

	test("overlapping calls with one requestId coalesce to one engine invocation", async () => {
		const ctx = contextFor(temp.db);
		const release = deferred();
		let invocations = 0;
		const spec = () =>
			fakeNodeSpec({
				scope: scope(),
				requestId: "req-coalesce",
				async invoke() {
					invocations++;
					await release.promise;
				},
			});
		const both = Promise.all([runModelNode(ctx, spec()), runModelNode(ctx, spec())]);
		await Bun.sleep(20);
		release.resolve();
		const [first, second] = await both;
		expect(invocations).toBe(1);
		expect(first.coalesced).toBe(false);
		expect(second.coalesced).toBe(true);
		expect(second.outcome).toEqual(first.outcome);
		expect(second.ids).toEqual(first.ids);
		expect(ctx.inFlight.size).toBe(0);
		expect(countRows(temp.db, "agent_runs")).toBe(1);
		await expectDoctorOk(temp.db);
	});

	test("a requestId in flight as another node kind is rejected, not coalesced", async () => {
		const ctx = contextFor(temp.db);
		const release = deferred();
		const decision = runModelNode(
			ctx,
			fakeNodeSpec({ scope: scope(), requestId: "req-kind", invoke: () => release.promise }),
		);
		await expectNodeError(
			runModelNode(ctx, fakeNodeSpec({ kind: "call", scope: scope(), requestId: "req-kind" })),
			"invalid-request",
		);
		release.resolve();
		await decision;
	});

	test("cross-instance race on one requestId: exactly one engine invocation", async () => {
		// Two kernel instances (own coalescing maps) on two separate handles to one file.
		const a = contextFor(temp.db);
		const b = contextFor(temp.openHandle().db);
		const release = deferred();
		let invocations = 0;
		const spec = (answer: string) =>
			fakeNodeSpec({
				scope: scope(),
				requestId: "req-race",
				answer,
				async invoke() {
					invocations++;
					await release.promise;
				},
			});
		const pa = runModelNode(a, spec("from-a"));
		const pb = runModelNode(b, spec("from-b"));
		// The claimer blocks in its engine, so the first to settle is the loser.
		const loser = await Promise.race([pa.then(() => null, (e: unknown) => e), pb.then(() => null, (e: unknown) => e)]);
		expect(loser).toBeInstanceOf(KernelNodeError);
		expect((loser as KernelNodeError).code).toBe("in-flight-elsewhere");
		release.resolve();
		const settled = await Promise.allSettled([pa, pb]);
		expect(invocations).toBe(1);
		const winners = settled.filter((s): s is PromiseFulfilledResult<NodeRunResult<FakeNodeOutcome>> => s.status === "fulfilled");
		expect(winners).toHaveLength(1);
		expect(winners[0]!.value.replayed).toBe(false);

		// After completion either instance replays the stored outcome.
		const again = await runModelNode(b, spec("unused"));
		expect(again.replayed).toBe(true);
		expect(again.outcome).toEqual(winners[0]!.value.outcome);
		expect(invocations).toBe(1);
		await expectDoctorOk(temp.db);
	});

	test("cross-process race on one requestId", async () => {
		const markerDir = mkdtempSync(join(tmpdir(), "mn-race-"));
		const release = () => writeFileSync(join(markerDir, "release"), "1");
		const requestId = "req-cross-process";
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "__fixtures__", "node-run-child.ts"),
				temp.path,
				temp.kernelId,
				temp.containerId,
				requestId,
				markerDir,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		let ownResult: Promise<{ value: NodeRunResult<FakeNodeOutcome> } | { error: unknown }> | undefined;
		let timedOut = false;
		try {
			let parentInvoked = 0;
			const own = runModelNode(
				contextFor(temp.db),
				fakeNodeSpec({
					scope: scope(),
					requestId,
					answer: "from-parent",
					async invoke() {
						parentInvoked++;
						writeFileSync(join(markerDir, "invoked-parent"), "1");
						while (!existsSync(join(markerDir, "release"))) await Bun.sleep(10);
					},
				}),
			);
			let ownSettled = false;
			ownResult = own.then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			void ownResult.then(() => {
				ownSettled = true;
			});

			// Release the winner only once the loser has settled.
			const waitUntil = Date.now() + 30_000;
			while (!ownSettled && child.exitCode === null) {
				if (Date.now() > waitUntil) {
					// Throw at once: the live child holds stderr open until it is released and reaped (finally).
					timedOut = true;
					throw new Error("race did not settle within 30 s");
				}
				await Bun.sleep(10);
			}
			release();
			const [childExit, childOut, childErr, parent] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				ownResult,
			]);
			if (childExit !== 0) throw new Error(`child exited ${childExit}: ${childErr}`);
			const childResult = JSON.parse(childOut.trim().split("\n").at(-1)!) as
				| { outcome: FakeNodeOutcome; replayed: boolean }
				| { error: string };

			const invoked = readdirSync(markerDir).filter((f) => f.startsWith("invoked-"));
			expect(invoked).toHaveLength(1);
			if (invoked[0] === "invoked-parent") {
				expect(parentInvoked).toBe(1);
				expect("value" in parent && parent.value.outcome.answer).toBe("from-parent");
				expect(childResult).toEqual({ error: "in-flight-elsewhere" });
			} else {
				expect(parentInvoked).toBe(0);
				expect("error" in parent && (parent.error as KernelNodeError).code).toBe("in-flight-elsewhere");
				expect(childResult).toMatchObject({ outcome: { answer: "from-child" }, replayed: false });
			}
			expect(countRows(temp.db, "agent_runs")).toBe(1);
			await expectDoctorOk(temp.db);
		} finally {
			// Whatever failed: release both waiters, stop and reap the child, then remove the markers.
			release();
			if (child.exitCode === null) child.kill();
			await child.exited;
			await ownResult;
			if (timedOut) console.error(`cross-process race child stderr: ${await new Response(child.stderr).text()}`);
			rmSync(markerDir, { recursive: true, force: true });
		}
	});

	test("a requestId names one request: a different fingerprint is rejected sequentially, coalescing and across instances", async () => {
		const withPrint = (fingerprint: string, opts: Parameters<typeof fakeNodeSpec>[0]) => ({
			...fakeNodeSpec(opts),
			fingerprint,
		});
		let invocations = 0;
		const count = () => {
			invocations++;
		};
		const ctx = contextFor(temp.db);
		const done = await runModelNode(ctx, withPrint("rf1-a", { scope: scope(), requestId: "req-print", invoke: count }));

		// Sequential: a done run of another request is never replayed for this one.
		const sequential = await expectNodeError(
			runModelNode(ctx, withPrint("rf1-b", { scope: scope(), requestId: "req-print", invoke: count })),
			"invalid-request",
		);
		expect(sequential.message).toBe(REQUEST_MISMATCH_MESSAGE);
		// The same request replays.
		const replay = await runModelNode(ctx, withPrint("rf1-a", { scope: scope(), requestId: "req-print", invoke: count }));
		expect(replay).toMatchObject({ replayed: true, ids: { runId: done.ids.runId } });

		// Coalescing: an identical in-flight requestId with another request is not awaited.
		const gate = deferred();
		const held = runModelNode(
			ctx,
			withPrint("rf1-c", { scope: scope(), requestId: "req-print-2", invoke: async () => {
				count();
				await gate.promise;
			} }),
		);
		while (invocations < 2) await Bun.sleep(1);
		await expectNodeError(
			runModelNode(ctx, withPrint("rf1-d", { scope: scope(), requestId: "req-print-2", invoke: count })),
			"invalid-request",
		);
		// Another instance: the claim's running attempt belongs to another request.
		await expectNodeError(
			runModelNode(
				contextFor(temp.openHandle().db),
				withPrint("rf1-d", { scope: scope(), requestId: "req-print-2", invoke: count }),
			),
			"invalid-request",
		);
		gate.resolve();
		await held;
		expect(invocations).toBe(2);
		expect(countRows(temp.db, "agent_runs")).toBe(2);
		await expectDoctorOk(temp.db);
	});

	test("a different request that read an empty session and claims after the original ended aborted writes nothing; the original retries", async () => {
		const withPrint = (fingerprint: string, opts: Parameters<typeof fakeNodeSpec>[0]) => ({
			...fakeNodeSpec(opts),
			fingerprint,
		});
		// The loser runs on its own handle, held at its claim transaction: every read it makes before the
		// claim has happened (the session is still empty), and its BEGIN IMMEDIATE reports SQLITE_BUSY
		// (the claim's own retry path) until the test opens the gate.
		const gate = holdClaimTransactions(temp.openHandle().db);
		let loserInvoked = 0;
		const loser = runModelNode(
			contextFor(gate.db),
			withPrint("rf1-loser", { scope: scope(), requestId: "req-interleave", invoke: () => void loserInvoked++ }),
		).then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		await gate.reached;
		expect(countRows(temp.db, "agent_runs")).toBe(0);

		// Meanwhile the original request claims, runs and ends aborted.
		const original = await runModelNode(
			contextFor(temp.db),
			withPrint("rf1-original", { scope: scope(), requestId: "req-interleave", signal: AbortSignal.abort() }),
		);
		expect((await getAgentRun(temp.db, original.ids.runId))?.status).toBe("aborted");
		const before = {
			runs: countRows(temp.db, "agent_runs"),
			events: countRows(temp.db, "trace_events"),
			blobs: countRows(temp.db, "trace_blobs"),
		};

		// The loser's claim now runs: it sees the original's attempt and writes nothing.
		gate.open();
		const settled = await loser;
		expect("error" in settled && (settled.error as KernelNodeError).code).toBe("invalid-request");
		expect(loserInvoked).toBe(0);
		expect({
			runs: countRows(temp.db, "agent_runs"),
			events: countRows(temp.db, "trace_events"),
			blobs: countRows(temp.db, "trace_blobs"),
		}).toEqual(before);

		// The original request can still retry.
		const retry = await runModelNode(
			contextFor(temp.db),
			withPrint("rf1-original", { scope: scope(), requestId: "req-interleave" }),
		);
		expect(retry).toMatchObject({ replayed: false, attempt: 2 });
		expect((await getAgentRun(temp.db, retry.ids.runId))?.status).toBe("done");
		expect((await getPiAgentSession(temp.db, retry.ids.sessionId))?.status).toBe("ended");
		await expectDoctorOk(temp.db);
	});

	test("kernel.call wires its request fingerprint: changed arguments under one requestId are rejected", async () => {
		const k = await createCallKit({ respond: (_req, index) => fakeOk({ kept: [`answer-${index}`], reason: "r" }) });
		try {
			await k.call("Extract", ["note"], { requestId: "extract-print" });
			await expectNodeError(k.call("Extract", ["other note"], { requestId: "extract-print" }), "invalid-request");
			await expectNodeError(k.call("Summarize", ["note", 3], { requestId: "extract-print" }), "invalid-request");
			await expect(k.call("Extract", ["note"], { requestId: "extract-print" })).resolves.toEqual({
				kept: ["answer-0"],
				reason: "r",
			});
			expect(k.engine.invocations).toHaveLength(1);
		} finally {
			k.cleanup();
		}
	});

	test("the operation deadline aborts the engine signal and the run ends aborted", async () => {
		const started = Date.now();
		const result = await runModelNode(
			contextFor(temp.db),
			fakeNodeSpec({
				scope: scope(),
				deadlineMs: 50,
				async invoke(run) {
					await new Promise<void>((resolve) => run.signal.addEventListener("abort", () => resolve(), { once: true }));
					expect(run.deadlineExceeded()).toBe(true);
				},
			}),
		);
		expect(Date.now() - started).toBeLessThan(5_000);
		const run = await getAgentRun(temp.db, result.ids.runId);
		expect(run?.status).toBe("aborted");
		const [start, end] = await getTraceEventsForRun(temp.db, result.ids.runId, ["call_start", "call_end"]);
		expect(Date.parse((start!.eventData as CallStartData).deadline_at) - Date.parse(start!.timestamp)).toBe(50);
		expect((end!.eventData as CallEndData).error?.kind).toBe("timeout");
		expect((await getPiAgentSession(temp.db, result.ids.sessionId))?.status).toBe("error");
		await expectDoctorOk(temp.db);
	});

	test("an engine step that throws closes the run as error and rethrows", async () => {
		const boom = new Error("programmer error with prompt text inside");
		const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];
		const logger: ModelNodeLogger = {
			debug: () => {},
			info: () => {},
			warn: (message, data) => logs.push({ message, ...(data && { data }) }),
			error: (message, data) => logs.push({ message, ...(data && { data }) }),
		};
		let runId = "";
		await expect(
			runModelNode(
				contextFor(temp.db, { logger }),
				fakeNodeSpec({
					scope: scope(),
					invoke(run) {
						runId = run.ids.runId;
						throw boom;
					},
				}),
			),
		).rejects.toBe(boom);
		expect((await getAgentRun(temp.db, runId))?.status).toBe("error");
		const [end] = await getTraceEventsForRun(temp.db, runId, ["call_end"]);
		expect((end!.eventData as CallEndData).status).toBe("error");
		// Logs carry ids and error names only, never messages.
		expect(JSON.stringify(logs)).not.toContain("prompt text");
		await expectDoctorOk(temp.db);
	});

	test("an engine step that throws and then fails its completion write surfaces row-write-failed", async () => {
		// The database rejects every call_end, so closing the failed run cannot commit.
		temp.db.run(
			sql.raw(
				"CREATE TRIGGER reject_call_end BEFORE INSERT ON trace_events WHEN NEW.type = 'call_end' BEGIN SELECT RAISE(ABORT, 'call_end rejected'); END",
			),
		);
		const boom = new Error("engine step failed");
		let runId = "";
		let sessionId = "";
		const err = await expectNodeError(
			runModelNode(
				contextFor(temp.db),
				fakeNodeSpec({
					scope: scope(),
					invoke(run) {
						runId = run.ids.runId;
						sessionId = run.ids.sessionId;
						throw boom;
					},
				}),
			),
			"row-write-failed",
		);
		expect(err.cause).toBeInstanceOf(Error);
		expect((err.cause as Error).message).toContain("call_end rejected");
		expect(err.executionError).toBe(boom);
		// Nothing of the error completion committed: the run is still running, its session active.
		expect((await getAgentRun(temp.db, runId))?.status).toBe("running");
		expect((await getPiAgentSession(temp.db, sessionId))?.status).toBe("active");
		expect(await getTraceEventsForRun(temp.db, runId, ["call_end"])).toEqual([]);
	});

	test("a kernel without a database rejects with no-db before any work", async () => {
		const ctx = createModelNodeContext({ kernelId: "no-db-kernel" });
		let invocations = 0;
		await expectNodeError(
			runModelNode(ctx, fakeNodeSpec({ scope: scope(), invoke: () => void invocations++ })),
			"no-db",
		);
		expect(invocations).toBe(0);
	});
});
