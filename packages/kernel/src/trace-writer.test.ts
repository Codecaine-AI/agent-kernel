import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	listTraceEventsForContainer,
	openKernelDatabase,
	upsertContainer,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import { createToolCallEndEvent } from "@agent-kernel/protocol";

import { createDbTraceWriter } from "./trace-writer";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kernel-trace-writer-"));
	handle = openKernelDatabase({ path: join(dir, "trace.db") });
	await ensureKernelObservabilitySchema(handle.db);
	await upsertContainer(handle.db, {
		id: "container-1",
		kernelId: "demo",
		kind: "session",
		appKey: ["req-1"],
	});
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

/** A nested `read` end inside codemode, as the live emitter or the backfill writes it. */
function nestedEnd(timing: "live" | "approximate", durationMs?: number) {
	return createToolCallEndEvent({ containerId: "container-1" }, "read", "codemode/1", {
		eventId: "nested-end-1",
		parentToolUseId: "codemode",
		nested: true,
		timing,
		...(durationMs !== undefined && { durationMs }),
	});
}

async function storedTiming(): Promise<unknown[]> {
	const rows = await listTraceEventsForContainer(handle.db, "container-1");
	return rows.map((row) => (row.eventData as { timing?: unknown }).timing);
}

describe("createDbTraceWriter", () => {
	test("submitPromotable replaces an approximate nested end with the live one, never the reverse", async () => {
		const writer = createDbTraceWriter(handle.db);

		writer.submitPromotable?.(nestedEnd("approximate"));
		await writer.flush();
		expect(await storedTiming()).toEqual(["approximate"]);

		// Plain submit is insert-or-ignore: it cannot promote.
		writer.submit(nestedEnd("live", 42));
		await writer.flush();
		expect(await storedTiming()).toEqual(["approximate"]);

		writer.submitPromotable?.(nestedEnd("live", 42));
		await writer.flush();
		expect(await storedTiming()).toEqual(["live"]);
		const [row] = await listTraceEventsForContainer(handle.db, "container-1");
		expect((row?.eventData as { duration_ms?: number }).duration_ms).toBe(42);

		writer.submitPromotable?.(nestedEnd("approximate"));
		await writer.flush();
		expect(await storedTiming()).toEqual(["live"]);
	});
});
