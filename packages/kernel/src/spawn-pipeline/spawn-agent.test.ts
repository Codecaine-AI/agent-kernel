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
} from "@codecaine-ai/agent-kernel-db";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { createKernel, type KernelInstance } from "../index";
import {
	realFetch,
	responsesStream,
	startTraceHeaderStub,
	textItem,
	toolCallItem,
	TRACE_HEADERS,
	TRACE_TAGS_FIXTURE,
	type TraceHeaderStub,
} from "../model-nodes/__fixtures__/trace-header-stub";

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

function writeWorker(catalogRoot: string, model: string, name = "worker"): void {
	const agentDir = join(catalogRoot, name);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		JSON.stringify({ name, description: "spawn test worker", model }),
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

	describe("trace headers", () => {
		let stub: TraceHeaderStub;
		let kernel: KernelInstance;
		afterEach(async () => {
			await kernel.traceWriter.flush();
			kernel.dispose();
			stub.stop();
			globalThis.fetch = (() => {
				throw new Error("network access is disabled in kernel tests");
			}) as unknown as typeof fetch;
		});

		/**
		 * A kernel whose agents send through the stub. `parent` has a spawn_child
		 * tool that spawns `worker`, and a spawn_background tool that queues
		 * `worker` on the agent manager as "Child of <label>."
		 */
		async function stubKernel(
			respond: (index: number, body: string) => Response | Promise<Response>,
			maxBackgroundAgents?: number,
		) {
			stub = startTraceHeaderStub(respond);
			globalThis.fetch = realFetch;
			const piAgentDir = join(root, "pi-agent");
			mkdirSync(piAgentDir, { recursive: true });
			writeFileSync(
				join(piAgentDir, "models.json"),
				JSON.stringify({
					providers: {
						stub: {
							baseUrl: stub.url,
							api: "openai-responses",
							apiKey: "sk-stub-key-0123456789",
							models: [{ id: "stub-model", name: "Stub", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
						},
					},
				}),
			);
			const catalogRoot = join(root, "catalog");
			writeWorker(catalogRoot, "stub/stub-model");
			writeWorker(catalogRoot, "stub/stub-model", "parent");
			const spawnChild: ExtensionFactory = (pi) => {
				pi.registerTool({
					name: "spawn_child",
					label: "spawn_child",
					description: "Spawn the worker subagent.",
					parameters: Type.Object({}),
					async execute() {
						const child = await kernel.spawnAgent("worker", "Say done.", null, { workingDir: root });
						return { content: [{ type: "text", text: child.responseText }], details: {} };
					},
				});
				pi.registerTool({
					name: "spawn_background",
					label: "spawn_background",
					description: "Start the worker subagent in the background.",
					parameters: Type.Object({ label: Type.String() }),
					async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
						kernel.agentManager.spawn(
							pi as unknown as Parameters<KernelInstance["agentManager"]["spawn"]>[0],
							ctx as unknown as Parameters<KernelInstance["agentManager"]["spawn"]>[1],
							"worker",
							`Child of ${params.label}.`,
							{ description: `child of ${params.label}`, isBackground: true, workingDir: root },
						);
						return { content: [{ type: "text", text: "started" }], details: {} };
					},
				});
			};
			kernel = createKernel({
				id: "spawn-agent-trace-headers",
				db: handle.db,
				catalog: { roots: [catalogRoot] },
				sharedTools: () => [spawnChild],
				piSessionsDir: join(root, "pi-sessions"),
				piAgentDir,
				logger: quietLogger,
				...(maxBackgroundAgents !== undefined && { concurrency: { maxBackgroundAgents } }),
			});
			return (await kernel.container({ kind: "session", key: ["trace-headers"] })).id;
		}

		test("a tagged spawn and its subagent send all 6 X-Trace-* headers on each request", async () => {
			const containerId = await stubKernel((index) =>
				responsesStream([index === 0 ? toolCallItem("spawn_child") : textItem("done")]),
			);
			const result = await kernel.spawnAgent("parent", "Spawn the child.", null, {
				workingDir: root,
				containerId,
				traceTags: TRACE_TAGS_FIXTURE,
			});
			expect(result.responseText).toBe("done");
			// Parent turn 1 (tool call), the subagent's turn, parent turn 2.
			expect(stub.received).toEqual([TRACE_HEADERS, TRACE_HEADERS, TRACE_HEADERS]);
		});

		test("an untagged run sends no X-Trace-* header, and a run outside a loop sends 5", async () => {
			const containerId = await stubKernel(() => responsesStream([textItem("done")]));
			await kernel.spawnAgent("worker", "Say done.", null, { workingDir: root, containerId });
			const { loop_path: _loopPath, ...outsideLoop } = TRACE_TAGS_FIXTURE;
			await kernel.spawnAgent("worker", "Say done.", null, { workingDir: root, containerId, traceTags: outsideLoop });
			const { "x-trace-loop-path": _loopHeader, ...fiveHeaders } = TRACE_HEADERS;
			expect(stub.received).toEqual([{}, fiveHeaders]);
		});

		test("a queued background child sends its own parent's tags, not the tags of the run that drains the queue", async () => {
			// One background slot. Parent A's child takes it and is held open, so
			// the children of B (tagged) and C (untagged) queue. Each queued child
			// then starts from the completion of the child before it.
			let release!: () => void;
			const firstChildHeld = new Promise<void>((resolve) => {
				release = resolve;
			});
			const childHeaders: Record<string, Record<string, string>> = {};
			const containerId = await stubKernel(async (index, body) => {
				const child = /Child of (\w)\./.exec(body)?.[1];
				if (child) {
					childHeaders[child] = stub.received[index]!;
					if (child === "A") await firstChildHeld;
					return responsesStream([textItem("done")]);
				}
				if (body.includes("function_call_output")) return responsesStream([textItem("done")]);
				const parent = /Parent (\w)\./.exec(body)![1]!;
				return responsesStream([toolCallItem("spawn_background", { label: parent })]);
			}, 1);
			const runParent = (label: string, traceTags?: { engine: string }) =>
				kernel.spawnAgent("parent", `Parent ${label}.`, null, {
					workingDir: root,
					containerId,
					...(traceTags && { traceTags }),
				});
			await runParent("A", { engine: "engine-A" });
			await runParent("B", { engine: "engine-B" });
			await runParent("C");
			release();
			await kernel.agentManager.waitForAll();
			expect(childHeaders).toEqual({
				A: { "x-trace-engine": "engine-A" },
				B: { "x-trace-engine": "engine-B" },
				C: {},
			});
		});
	});
});
