/**
 * D6 default-off: a kernel built without `calls` / `decide` behaves as
 * before (it still spawns), and the M1 node stubs reject with "no-engine".
 * Spawning uses Pi's in-memory faux provider; fetch throws.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getPiAgentSession, hasSessionKindColumn } from "@agent-kernel/db";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { createKernel, type KernelInstance } from "../index";
import { createTempKernelDb, disableNetwork, type TempKernelDb } from "./__fixtures__/temp-kernel";
import { KernelNodeError } from "./types";

// Pi's auth storage can still touch <piAgentDir>/auth.json just after a
// spawn settles, so agent dirs live in one suite-level root removed last.
let restoreFetch: () => void;
let piRoot: string;
beforeAll(() => {
	restoreFetch = disableNetwork();
	piRoot = mkdtempSync(join(tmpdir(), "mn-pi-agent-"));
});
afterAll(async () => {
	restoreFetch();
	await Bun.sleep(200);
	rmSync(piRoot, { recursive: true, force: true });
});

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

let temp: TempKernelDb;
beforeEach(async () => {
	temp = await createTempKernelDb();
});
afterEach(() => {
	temp.cleanup();
});

function writeWorker(catalogRoot: string, model: string): void {
	const agentDir = join(catalogRoot, "worker");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "agent.json"), JSON.stringify({ name: "worker", description: "stub test worker", model }));
	writeFileSync(
		join(agentDir, "prompt.json"),
		JSON.stringify({
			kind: "prompt",
			schemaVersion: "prompt-kit/v1",
			id: "modelNodeStubsTestPrompt",
			nodes: [{ type: "section", tag: "task", children: [{ type: "paragraph", content: ["Answer briefly."] }] }],
		}),
	);
}

async function spawnOnce(kernel: KernelInstance, faux: ReturnType<typeof fauxProvider>, containerId: string) {
	const ctx = { model: faux.getModel() } as Partial<ExtensionContext> as ExtensionContext;
	return kernel.spawnAgent("worker", "Say done.", ctx, { workingDir: temp.dir, containerId });
}

function fauxKernel(db = temp.db) {
	const faux = fauxProvider({ provider: "stub-test", models: [{ id: "stub-model" }] });
	faux.setResponses([fauxAssistantMessage("all done")]);
	const registerFaux: ExtensionFactory = (pi) => {
		pi.registerProvider(faux.provider);
	};
	const catalogRoot = join(temp.dir, "catalog");
	writeWorker(catalogRoot, "stub-test/stub-model");
	const kernel = createKernel({
		id: temp.kernelId,
		db,
		catalog: { roots: [catalogRoot] },
		sharedTools: () => [registerFaux],
		piSessionsDir: join(temp.dir, "pi-sessions"),
		piAgentDir: join(piRoot, randomUUID()),
		logger: quietLogger,
	});
	return { kernel, faux };
}

async function expectNoEngine(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(KernelNodeError);
		expect((error as KernelNodeError).code).toBe("no-engine");
		return;
	}
	throw new Error("expected KernelNodeError(no-engine)");
}

describe("model-node stubs (default-off)", () => {
	test("createKernel without calls/decide still spawns; call throws no-engine", async () => {
		const { kernel, faux } = fauxKernel();
		try {
			const result = await spawnOnce(kernel, faux, temp.containerId);
			expect(result.responseText).toBe("all done");

			const call = kernel.call as unknown as (name: string, args: unknown[]) => Promise<unknown>;
			await expectNoEngine(call("Anything", []));
			await expectNoEngine(
				kernel.decide("judge", { text: "x" }, {
					containerId: temp.containerId,
					questions: { ok: { type: "bool", instructions: "ok?", criteria: { true: "yes", false: "no" } } },
				}),
			);
			let stepRan = false;
			await expectNoEngine(
				kernel.step("s", { containerId: temp.containerId }, () => {
					stepRan = true;
				}),
			);
			expect(stepRan).toBe(false);
			await expectNoEngine(kernel.gate("g", { containerId: temp.containerId }, []));

			// The stubs wrote nothing: the only session is the spawned agent's.
			const kinds = temp.db.all<{ kind: string }>(sql`SELECT kind FROM pi_agent_sessions`);
			expect(kinds).toEqual([{ kind: "pi" }]);
		} finally {
			await kernel.traceWriter.flush();
			kernel.dispose();
		}
	});

	test("spawnAgent upgrades a pre-kind database before its first write", async () => {
		// Simulate a database created before the kind column existed.
		temp.db.run(sql`ALTER TABLE pi_agent_sessions DROP COLUMN kind`);
		const legacy = temp.openHandle();
		expect(hasSessionKindColumn(legacy.db)).toBe(false);

		const { kernel, faux } = fauxKernel(legacy.db);
		try {
			const result = await spawnOnce(kernel, faux, temp.containerId);
			expect(hasSessionKindColumn(legacy.db)).toBe(true);
			expect((await getPiAgentSession(legacy.db, result.session.sessionId))?.kind).toBe("pi");
		} finally {
			await kernel.traceWriter.flush();
			kernel.dispose();
		}
	});
});
