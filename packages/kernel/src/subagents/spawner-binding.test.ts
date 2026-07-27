import { describe, expect, test } from "bun:test";

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	defineSpawnerTool,
	getSpawnerToolMeta,
	type SpawnerBackgroundHandle,
} from "../agent-definition/spawner-tool";
import { runWithContext, type RunContext } from "../run-context";
import { AgentManager, type AgentSpawnOptions } from "./manager";
import { bindSpawnerTools } from "./spawner-binding";
import type { KernelExtensionContext } from "./types";

const ctx = {
	cwd: "/tmp",
	sessionManager: { getSessionId: () => "parent-uuid" },
} as KernelExtensionContext as unknown as ExtensionContext;

interface CapturedSpawn {
	agentName: string;
	prompt: string;
	options: AgentSpawnOptions;
}

function makeHarness(opts?: {
	neverResolve?: boolean;
	maxConcurrent?: number;
	/** When true, each spawn blocks until its gate (FIFO) is released. */
	gated?: boolean;
	hasAgent?: (agentName: string) => boolean;
}) {
	const spawned: CapturedSpawn[] = [];
	const gates: Array<() => void> = [];
	const manager = new AgentManager(undefined, opts?.maxConcurrent ?? 4, undefined, {
		spawnAgent: async (agentName, prompt, _ctx, options) => {
			spawned.push({ agentName, prompt, options });
			if (opts?.neverResolve) await new Promise(() => {});
			if (opts?.gated) await new Promise<void>((release) => gates.push(release));
			return {
				responseText: `${agentName} done`,
				session: { messages: [], sessionId: "child-uuid", steer: async () => {} },
				aborted: false,
			};
		},
	});

	const registered: Array<Parameters<ExtensionAPI["registerTool"]>[0]> = [];
	const pi = {
		registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
			registered.push(tool);
		},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	const bound = bindSpawnerTools(pi, {
		agentManager: manager,
		toolRuntime: { marker: "app-runtime" },
		...(opts?.hasAgent !== undefined && { hasAgent: opts.hasAgent }),
	});
	return { manager, pi, bound, registered, spawned, gates };
}

function parentRunContext(label: string): RunContext {
	return {
		containerId: `container-${label}`,
		runId: `run-${label}`,
		trigger: "operator",
		agentName: `parent-${label}`,
		traceWriter: { submit() {} },
		sessionDir: `/sessions/${label}`,
		piSessionsDir: `/pi-sessions/${label}`,
		phase: `phase-${label}`,
		piSessionUuid: `pi-uuid-${label}`,
	};
}

const scoutSpawner = () =>
	defineSpawnerTool({
		name: "spawn_scouts",
		label: "Spawn scouts",
		description: "Dispatch scouts.",
		parameters: Type.Object({ focus: Type.String() }),
		spawns: ["source-scout"],
		execute: async (_toolCallId, params, { dispatch }) => {
			const record = await dispatch("source-scout", params.focus);
			return { content: [{ type: "text", text: record.result ?? "" }], details: {} };
		},
	});

describe("defineSpawnerTool", () => {
	test("compiles into a Pi-registerable tool carrying spawner metadata", () => {
		const tool = scoutSpawner();
		expect(tool.name).toBe("spawn_scouts");
		expect(tool.executionMode).toBe("sequential");
		expect(getSpawnerToolMeta(tool)?.spawns).toEqual(["source-scout"]);
		// Ordinary tools carry no spawner metadata.
		expect(getSpawnerToolMeta({ name: "read" })).toBeNull();
	});

	test("rejects an empty or invalid spawns declaration", () => {
		const decl = {
			name: "bad",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: undefined }),
		};
		expect(() => defineSpawnerTool({ ...decl, spawns: [] })).toThrow(
			/`spawns` must be a non-empty array/,
		);
		expect(() =>
			defineSpawnerTool({ ...decl, spawns: ["*", "source-scout"] }),
		).toThrow(/cannot be mixed with named agents/);
	});

	test("unbound execute throws (spawner tools only run inside kernel sessions)", async () => {
		const tool = scoutSpawner();
		await expect(
			tool.execute("t1", { focus: "x" }, undefined, undefined, ctx),
		).rejects.toThrow(/was not bound by the kernel/);
	});
});

describe("bindSpawnerTools", () => {
	test("dispatch auto-forwards parentToolUseId, trigger, and the tool-call signal", async () => {
		const { bound, registered, spawned, manager } = makeHarness();
		bound.registerTool(scoutSpawner());
		expect(registered).toHaveLength(1);

		const abort = new AbortController();
		const result = await registered[0].execute(
			"toolu_42",
			{ focus: "auth flows" },
			abort.signal,
			undefined,
			ctx,
		);

		expect(spawned).toHaveLength(1);
		expect(spawned[0].agentName).toBe("source-scout");
		expect(spawned[0].prompt).toBe("auth flows");
		// The manager adapter receives the identity the author cannot set:
		expect(spawned[0].options.parentToolUseId).toBe("toolu_42");
		expect(spawned[0].options.trigger).toBe("parent-tool");
		expect(spawned[0].options.parentPiSessionUuid).toBe("parent-uuid");
		expect((result as { content: Array<{ text: string }> }).content[0].text).toBe(
			"source-scout done",
		);
		manager.dispose();
	});

	test("rejects dispatch of an agent outside the declared allowlist", async () => {
		const { bound, registered, spawned, manager } = makeHarness();
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_scouts",
				parameters: Type.Object({}),
				spawns: ["source-scout"],
				execute: async (_id, _params, { dispatch }) => {
					await dispatch("report-writer", "nope");
					return { content: [], details: undefined };
				},
			}),
		);

		await expect(
			registered[0].execute("toolu_1", {}, undefined, undefined, ctx),
		).rejects.toThrow(
			'Spawner tool "spawn_scouts" is not allowed to dispatch agent "report-writer" — declared spawns: ["source-scout"]',
		);
		expect(spawned).toHaveLength(0);
		manager.dispose();
	});

	test('spawns: ["*"] permits any agent (loud general opt-in)', async () => {
		const { bound, registered, spawned, manager } = makeHarness();
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_anything",
				parameters: Type.Object({}),
				spawns: ["*"],
				execute: async (_id, _params, { dispatch }) => {
					await dispatch("report-writer", "go");
					await dispatch("source-scout", "go");
					return { content: [], details: undefined };
				},
			}),
		);

		await registered[0].execute("toolu_1", {}, undefined, undefined, ctx);
		expect(spawned.map((s) => s.agentName)).toEqual([
			"report-writer",
			"source-scout",
		]);
		manager.dispose();
	});

	test("background dispatch returns a handle whose done resolves with the final record", async () => {
		const { bound, registered, manager } = makeHarness();
		bound.registerTool(
			defineSpawnerTool({
				name: "queue_writer",
				parameters: Type.Object({}),
				spawns: ["report-writer"],
				execute: async (_id, _params, { dispatch }) => {
					const handle = await dispatch("report-writer", "write it", {
						background: true,
						description: "bg writer",
					});
					// The handle is immediate; `done` always exists and resolves
					// with the final record once the child actually completes.
					const record = await handle.done;
					return {
						content: [
							{
								type: "text",
								text: `${handle.agentName}/${handle.status}→${record.status}:${record.result}`,
							},
						],
						details: undefined,
					};
				},
			}),
		);

		const result = (await registered[0].execute(
			"toolu_bg",
			{},
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };
		expect(result.content[0].text).toBe(
			"report-writer/running→completed:report-writer done",
		);
		manager.dispose();
	});

	test("queued background dispatch keeps its own parent's identity across queue drain", async () => {
		// Regression (QA): queue-drain runs in the DRAINER's async context —
		// parent A's .then continuation — so a queued dispatch from parent B
		// used to inherit A's containerId/parentRunId/sessionDir. Dispatch now
		// captures the live run context at dispatch time and passes it
		// explicitly, making drain timing and drain-caller context irrelevant.
		const { bound, registered, spawned, manager, gates } = makeHarness({
			maxConcurrent: 1,
			gated: true,
		});
		const handles: SpawnerBackgroundHandle[] = [];
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_bg",
				parameters: Type.Object({ label: Type.String() }),
				spawns: ["source-scout"],
				execute: async (_id, params, { dispatch }) => {
					handles.push(
						await dispatch("source-scout", params.label, { background: true }),
					);
					return { content: [], details: undefined };
				},
			}),
		);

		const ctxA = parentRunContext("A");
		const ctxB = parentRunContext("B");

		// Parent A's dispatch starts immediately (fills the single slot).
		await runWithContext(ctxA, async () => {
			await registered[0].execute("toolu_a", { label: "child-of-A" }, undefined, undefined, ctx);
		});
		// Parent B's dispatch queues behind it.
		await runWithContext(ctxB, async () => {
			await registered[0].execute("toolu_b", { label: "child-of-B" }, undefined, undefined, ctx);
		});
		expect(spawned).toHaveLength(1);
		expect(handles[0].status).toBe("running");
		expect(handles[1].status).toBe("queued");

		// Release A: its completion continuation (inside ctxA) drains B.
		gates[0]();
		await handles[0].done;
		expect(spawned).toHaveLength(2);

		// B's child must carry B's identity, not drainer A's.
		expect(spawned[1].prompt).toBe("child-of-B");
		expect(spawned[1].options.containerId).toBe("container-B");
		expect(spawned[1].options.parentRunId).toBe("run-B");
		expect(spawned[1].options.sessionDir).toBe("/sessions/B");
		expect(spawned[1].options.piSessionsDir).toBe("/pi-sessions/B");
		expect(spawned[1].options.phase).toBe("phase-B");
		expect(spawned[1].options.parentPiSessionUuid).toBe("pi-uuid-B");
		expect(spawned[1].options.parentToolUseId).toBe("toolu_b");

		// The queued child's done handle resolves once it completes.
		gates[1]();
		const recordB = await handles[1].done;
		expect(recordB.status).toBe("completed");
		manager.dispose();
	});

	test("done resolves for a queued child aborted before it ever starts", async () => {
		const { bound, registered, manager } = makeHarness({
			maxConcurrent: 1,
			gated: true,
		});
		const handles: SpawnerBackgroundHandle[] = [];
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_bg",
				parameters: Type.Object({ label: Type.String() }),
				spawns: ["source-scout"],
				execute: async (_id, params, { dispatch }) => {
					handles.push(
						await dispatch("source-scout", params.label, { background: true }),
					);
					return { content: [], details: undefined };
				},
			}),
		);
		await registered[0].execute("toolu_1", { label: "first" }, undefined, undefined, ctx);
		await registered[0].execute("toolu_2", { label: "second" }, undefined, undefined, ctx);
		expect(handles[1].status).toBe("queued");

		// Abort the queued child: it never starts, but done still settles.
		expect(manager.abort(handles[1].id)).toBe(true);
		const record = await handles[1].done;
		expect(record.status).toBe("stopped");
		manager.dispose();
	});

	test("dispatch of a nonexistent agent throws even under the wildcard", async () => {
		const { bound, registered, spawned, manager } = makeHarness({
			hasAgent: (agentName) => agentName === "source-scout",
		});
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_anything",
				parameters: Type.Object({}),
				spawns: ["*"],
				execute: async (_id, _params, { dispatch }) => {
					await dispatch("sorce-scout", "typo");
					return { content: [], details: undefined };
				},
			}),
		);

		await expect(
			registered[0].execute("toolu_1", {}, undefined, undefined, ctx),
		).rejects.toThrow(
			'Spawner tool "spawn_anything" cannot dispatch unknown agent "sorce-scout" — no such agent in the catalog',
		);
		expect(spawned).toHaveLength(0);
		manager.dispose();
	});

	test("removes the abort listener from the tool-call signal on completion", async () => {
		const { bound, registered, manager } = makeHarness();
		bound.registerTool(scoutSpawner());

		const controller = new AbortController();
		const signal = controller.signal;
		let added = 0;
		let removed = 0;
		const originalAdd = signal.addEventListener.bind(signal);
		const originalRemove = signal.removeEventListener.bind(signal);
		Object.defineProperty(signal, "addEventListener", {
			value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
				added++;
				return originalAdd(...args);
			},
		});
		Object.defineProperty(signal, "removeEventListener", {
			value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
				removed++;
				return originalRemove(...args);
			},
		});

		await registered[0].execute("toolu_sig", { focus: "x" }, signal, undefined, ctx);
		await registered[0].execute("toolu_sig2", { focus: "y" }, signal, undefined, ctx);
		// One listener added per dispatch, and each removed on completion —
		// a long-lived coordinator signal does not accrue listeners.
		expect(added).toBe(2);
		expect(removed).toBe(2);
		manager.dispose();
	});

	test("forwards the app toolRuntime and leaves ordinary tools untouched", async () => {
		const { bound, registered, manager } = makeHarness();
		let seenRuntime: unknown;
		bound.registerTool(
			defineSpawnerTool({
				name: "spawn_scouts",
				parameters: Type.Object({}),
				spawns: ["source-scout"],
				execute: async (_id, _params, spawnerCtx) => {
					seenRuntime = spawnerCtx.toolRuntime;
					return { content: [], details: undefined };
				},
			}),
		);
		const plainTool = {
			name: "read_context",
			label: "Read",
			description: "Plain tool.",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: undefined }),
		};
		bound.registerTool(plainTool as Parameters<ExtensionAPI["registerTool"]>[0]);

		await registered[0].execute("toolu_1", {}, undefined, undefined, ctx);
		expect(seenRuntime).toEqual({ marker: "app-runtime" });
		// The non-spawner tool is registered as-is (same execute reference).
		expect(registered[1].execute).toBe(plainTool.execute as never);
		manager.dispose();
	});
});
