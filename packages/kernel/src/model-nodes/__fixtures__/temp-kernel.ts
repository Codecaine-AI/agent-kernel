/**
 * Temp kernel database and kernel for model-node tests (plan §7.2):
 * mkdtemp → openKernelDatabase → ensureKernelObservabilitySchema → one
 * container; parent runs on demand through setupPiSessionAndRun. `cleanup()`
 * closes every handle it opened and removes the directory.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
	upsertContainer,
	type KernelDatabase,
	type KernelDatabaseHandle,
	type RunTrigger,
} from "@agent-kernel/db";

import { createKernel, type CreateKernelConfig, type KernelInstance } from "../../index";
import { setupPiSessionAndRun } from "../../spawn-pipeline/session/pi-session-db-init";

export const TEMP_KERNEL_ID = "mn-test-kernel";

export interface TempKernelDb {
	dir: string;
	path: string;
	handle: KernelDatabaseHandle;
	db: KernelDatabase;
	kernelId: string;
	/** The seeded container. */
	containerId: string;
	/** Opens another, independent handle to the same file (cross-instance tests); closed by cleanup(). */
	openHandle(): KernelDatabaseHandle;
	/** Inserts a Pi session and a running run under the seeded container. */
	seedParentRun(opts?: { agentName?: string; trigger?: RunTrigger }): Promise<{ runId: string; sessionId: string }>;
	cleanup(): void;
}

export async function createTempKernelDb(opts: { kernelId?: string } = {}): Promise<TempKernelDb> {
	const dir = mkdtempSync(join(tmpdir(), "mn-"));
	const path = join(dir, "trace.db");
	const handles: KernelDatabaseHandle[] = [];
	const openHandle = () => {
		const opened = openKernelDatabase({ path });
		handles.push(opened);
		return opened;
	};
	const handle = openHandle();
	await ensureKernelObservabilitySchema(handle.db);
	const kernelId = opts.kernelId ?? TEMP_KERNEL_ID;
	const container = await upsertContainer(handle.db, {
		id: randomUUID(),
		kernelId,
		kind: "test",
		appKey: [randomUUID()],
		createdAt: new Date().toISOString(),
	});
	return {
		dir,
		path,
		handle,
		db: handle.db,
		kernelId,
		containerId: container.id,
		openHandle,
		async seedParentRun(seed = {}) {
			const sessionId = randomUUID();
			const runId = randomUUID();
			await setupPiSessionAndRun(handle.db, {
				piSessionUuid: sessionId,
				containerId: container.id,
				runId,
				agentName: seed.agentName ?? "parent-agent",
				trigger: seed.trigger ?? "operator",
			});
			return { runId, sessionId };
		},
		cleanup() {
			for (const opened of handles.splice(0)) {
				try {
					opened.close();
				} catch {
					// already closed by the test
				}
			}
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export interface TempKernel<TCalls = unknown> {
	kernel: KernelInstance<unknown, TCalls>;
	tempDb: TempKernelDb;
	cleanup(): void;
}

/** A kernel over a fresh temp database; pass `calls` / `decide` fakes through `config`. */
export async function createTempKernel<TCalls = unknown>(
	config: Omit<CreateKernelConfig<unknown, TCalls>, "db" | "id"> = {},
	opts: { tempDb?: TempKernelDb } = {},
): Promise<TempKernel<TCalls>> {
	const tempDb = opts.tempDb ?? (await createTempKernelDb());
	const kernel = createKernel<unknown, TCalls>({ ...config, id: tempDb.kernelId, db: tempDb.db });
	return {
		kernel,
		tempDb,
		cleanup() {
			kernel.dispose();
			if (!opts.tempDb) tempDb.cleanup();
		},
	};
}

/**
 * Replaces `globalThis.fetch` with one that throws, so no test reaches the
 * network by accident (plan §7.1). Returns the restore function.
 */
export function disableNetwork(): () => void {
	const realFetch = globalThis.fetch;
	globalThis.fetch = Object.assign(
		async () => {
			throw new Error("network disabled in model-node tests");
		},
		{ preconnect: () => {} },
	) as unknown as typeof fetch;
	return () => {
		globalThis.fetch = realFetch;
	};
}
