import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
	openKernelDatabaseReadOnly,
	upsertContainer,
	upsertPiAgentSession,
	type KernelDatabaseHandle,
} from "@codecaine-ai/agent-kernel-db";

import { createContainerReadService } from "./read-service";

const NOW = "2026-10-07T12:00:00.000Z";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kernel-read-service-"));
	handle = openKernelDatabase({ path: join(dir, "trace.db") });
	await ensureKernelObservabilitySchema(handle.db);
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("createContainerReadService", () => {
	test("toPiSession passes kind", async () => {
		const db = handle.db;
		await upsertContainer(db, {
			id: "container-1",
			kernelId: "demo",
			kind: "session",
			appKey: ["req-1"],
			createdAt: NOW,
		});
		// Written without a kind: the column default makes it a Pi session.
		await upsertPiAgentSession(db, {
			id: "session-pi",
			containerId: "container-1",
			agentName: "coordinator",
			status: "ended",
			createdAt: NOW,
		});
		await upsertPiAgentSession(db, {
			id: "session-call",
			containerId: "container-1",
			agentName: "ExtractCheckpointKnowledge",
			kind: "call",
			status: "ended",
			createdAt: "2026-10-07T12:00:01.000Z",
		});
		await upsertPiAgentSession(db, {
			id: "session-decision",
			containerId: "container-1",
			agentName: "lint-judge",
			kind: "decision",
			status: "ended",
			createdAt: "2026-10-07T12:00:02.000Z",
		});

		const detail = await createContainerReadService({ db }).getContainerTrace(
			"container-1",
		);

		expect(detail?.pi_sessions.map((s) => [s.id, s.kind])).toEqual([
			["session-pi", "pi"],
			["session-call", "call"],
			["session-decision", "decision"],
		]);
	});

	test("a container and a list summary carry the 6 trace tags", async () => {
		const db = handle.db;
		await upsertContainer(db, {
			id: "node-1",
			kernelId: "demo",
			kind: "archon-node",
			appKey: ["run-a", "plan"],
			createdAt: NOW,
			traceTags: {
				engine: "archon",
				run_id: "run-a",
				node_path: "plan",
				invocation_id: "inv-1",
				attempt_id: "att-1",
				loop_path: "loop/2",
			},
		});
		const service = createContainerReadService({ db });

		const detail = await service.getContainerTrace("node-1");
		const list = await service.listSessionContainers({ runId: "run-a" });

		const expected = {
			engine: "archon",
			runId: "run-a",
			nodePath: "plan",
			invocationId: "inv-1",
			attemptId: "att-1",
			loopPath: "loop/2",
		};
		expect(detail?.container).toMatchObject(expected);
		expect(list.trace_sessions).toHaveLength(1);
		expect(list.trace_sessions[0]).toMatchObject({ id: "node-1", ...expected });
	});

	test("listSessionContainers filters by kind, engine and runId", async () => {
		const db = handle.db;
		const rows = [
			{ id: "session-1", kind: "session", engine: undefined, run: undefined },
			{ id: "archon-run", kind: "archon-run", engine: "archon", run: "run-a" },
			{ id: "archon-node", kind: "archon-node", engine: "archon", run: "run-a" },
			{ id: "other-node", kind: "archon-node", engine: "archon", run: "run-b" },
			{ id: "pi-node", kind: "archon-node", engine: "pi", run: "run-a" },
		];
		for (const [i, row] of rows.entries()) {
			await upsertContainer(db, {
				id: row.id,
				kernelId: "demo",
				kind: row.kind,
				appKey: [row.id],
				createdAt: `2026-10-07T12:00:0${i}.000Z`,
				traceTags: { engine: row.engine, run_id: row.run },
			});
		}
		const service = createContainerReadService({ db });
		const ids = async (query: Parameters<typeof service.listSessionContainers>[0]) =>
			(await service.listSessionContainers(query)).trace_sessions
				.map((s) => s.id)
				.sort();

		expect(await ids({})).toEqual(["session-1"]);
		expect(await ids({ kind: "archon-node" })).toEqual([
			"archon-node",
			"other-node",
			"pi-node",
		]);
		expect(await ids({ runId: "run-a" })).toEqual(["archon-node", "archon-run", "pi-node"]);
		expect(await ids({ engine: "archon", runId: "run-a" })).toEqual([
			"archon-node",
			"archon-run",
		]);
		expect(await ids({ kind: "archon-run", runId: "run-a" })).toEqual(["archon-run"]);
	});

	test("trace tags read as null on a database without the tag columns", async () => {
		await upsertContainer(handle.db, {
			id: "c1",
			kernelId: "demo",
			kind: "session",
			appKey: ["req-1"],
			createdAt: NOW,
		});
		handle.close();
		// Turn it into a database from before the tag columns existed.
		const sqlite = new Database(join(dir, "trace.db"));
		for (const column of [
			"engine",
			"run_id",
			"node_path",
			"invocation_id",
			"attempt_id",
			"loop_path",
		]) {
			sqlite.exec(`ALTER TABLE containers DROP COLUMN ${column}`);
		}
		sqlite.close();
		handle = openKernelDatabaseReadOnly(join(dir, "trace.db"));
		const service = createContainerReadService({ db: handle.db });
		const nullTags = {
			engine: null,
			runId: null,
			nodePath: null,
			invocationId: null,
			attemptId: null,
			loopPath: null,
		};

		const detail = await service.getContainerTrace("c1");
		const list = await service.listSessionContainers();

		expect(detail?.container).toMatchObject(nullTags);
		expect(list.trace_sessions.map((s) => s.id)).toEqual(["c1"]);
		expect(list.trace_sessions[0]).toMatchObject(nullTags);
		expect(
			(await service.listSessionContainers({ runId: "run-a" })).trace_sessions,
		).toEqual([]);
	});
});
