/**
 * Child process for node-run.test.ts "cross-process race on one requestId":
 * a second kernel instance in its own process, on its own handle to the same
 * database file. Its engine writes `<markerDir>/invoked-child`, then waits for
 * `<markerDir>/release`. Prints one JSON line: `{ outcome }` or `{ error }`.
 *
 * argv: <dbPath> <kernelId> <containerId> <requestId> <markerDir>
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { openKernelDatabase } from "@agent-kernel/db";

import { createModelNodeContext } from "../context";
import { runModelNode } from "../node-run";
import { KernelNodeError } from "../types";
import { fakeNodeSpec } from "./fake-node";

const [dbPath, kernelId, containerId, requestId, markerDir] = process.argv.slice(2);
if (!dbPath || !kernelId || !containerId || !requestId || !markerDir) {
	throw new Error("usage: node-run-child <dbPath> <kernelId> <containerId> <requestId> <markerDir>");
}

globalThis.fetch = (async () => {
	throw new Error("network disabled in model-node tests");
}) as unknown as typeof fetch;
const handle = openKernelDatabase({ path: dbPath });
const ctx = createModelNodeContext({ kernelId, db: handle.db });

async function waitForRelease(): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (!existsSync(join(markerDir!, "release"))) {
		if (Date.now() > deadline) throw new Error("child: release never came");
		await Bun.sleep(10);
	}
}

try {
	const result = await runModelNode(
		ctx,
		fakeNodeSpec({
			scope: { containerId, trigger: "system" },
			requestId,
			answer: "from-child",
			async invoke() {
				writeFileSync(join(markerDir, "invoked-child"), "1");
				await waitForRelease();
			},
		}),
	);
	console.log(JSON.stringify({ outcome: result.outcome, replayed: result.replayed }));
} catch (error) {
	console.log(JSON.stringify({ error: error instanceof KernelNodeError ? error.code : String(error) }));
} finally {
	handle.close();
}
