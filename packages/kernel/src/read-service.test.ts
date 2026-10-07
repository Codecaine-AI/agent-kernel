import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
	upsertContainer,
	upsertPiAgentSession,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";

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
});
