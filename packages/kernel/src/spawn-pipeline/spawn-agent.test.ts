/**
 * A real spawn through createKernel's pipeline, driven by Pi's in-memory faux
 * provider (registered into the session through a shared tool factory, the
 * way an app registers a custom provider). No network: fetch throws.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	getAgentRun,
	openKernelDatabase,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { createKernel } from "../index";

const originalFetch = globalThis.fetch;
beforeAll(() => {
	globalThis.fetch = (() => {
		throw new Error("network access is disabled in kernel tests");
	}) as unknown as typeof fetch;
});
afterAll(() => {
	globalThis.fetch = originalFetch;
});

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

let root: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "kernel-spawn-agent-"));
	handle = openKernelDatabase({ path: join(root, "trace.db") });
	await ensureKernelObservabilitySchema(handle.db);
});

afterEach(() => {
	handle.close();
	rmSync(root, { recursive: true, force: true });
});

function writeWorker(catalogRoot: string, model: string): void {
	const agentDir = join(catalogRoot, "worker");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		JSON.stringify({ name: "worker", description: "spawn test worker", model }),
	);
	writeFileSync(
		join(agentDir, "prompt.json"),
		JSON.stringify({
			kind: "prompt",
			schemaVersion: "prompt-kit/v1",
			id: "spawnAgentTestPrompt",
			nodes: [
				{
					type: "section",
					tag: "task",
					children: [{ type: "paragraph", content: ["Answer briefly."] }],
				},
			],
		}),
	);
}

describe("spawnAgent", () => {
	test("spawnAgent result carries runId, containerId, piSessionId", async () => {
		const faux = fauxProvider({
			provider: "spawn-test",
			models: [{ id: "spawn-model" }],
		});
		faux.setResponses([fauxAssistantMessage("all done")]);
		const registerFaux: ExtensionFactory = (pi) => {
			pi.registerProvider(faux.provider);
		};
		const catalogRoot = join(root, "catalog");
		writeWorker(catalogRoot, "spawn-test/spawn-model");

		const kernel = createKernel({
			id: "spawn-agent-test",
			db: handle.db,
			catalog: { roots: [catalogRoot] },
			sharedTools: () => [registerFaux],
			piSessionsDir: join(root, "pi-sessions"),
			piAgentDir: join(root, "pi-agent"),
			logger: quietLogger,
		});
		try {
			const container = await kernel.container({ kind: "session", key: ["spawn-ids"] });
			let started: { runId: string; containerId: string } | undefined;
			// Model resolution runs before extensions load, so the session is
			// handed the faux model directly, as an extension host would.
			const ctx = { model: faux.getModel() } as Partial<ExtensionContext> as ExtensionContext;

			const result = await kernel.spawnAgent("worker", "Say done.", ctx, {
				workingDir: root,
				containerId: container.id,
				onRunStarted: (info) => {
					started = info;
				},
			});

			expect(result.responseText).toBe("all done");
			expect(started).toBeDefined();
			expect(result.runId).toBe(started!.runId);
			expect(result.containerId).toBe(started!.containerId);
			expect(result.containerId).toBe(container.id);
			expect(result.piSessionId).toBe(result.session.sessionId);

			const run = await getAgentRun(handle.db, started!.runId);
			expect(run?.piSessionId).toBe(result.piSessionId);
			expect(run?.containerId).toBe(result.containerId);
			expect(run?.status).toBe("done");
		} finally {
			await kernel.traceWriter.flush();
			kernel.dispose();
		}
	});
});
