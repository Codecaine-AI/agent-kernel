import { describe, expect, test } from "bun:test";

import type { TraceEvent } from "@agent-kernel/protocol";

import { AgentManager, type AgentSpawnOptions, type AgentSpawnResult } from "./manager";
import type { KernelExtensionContext } from "./types";

const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RUN_ID = "99999999-8888-7777-6666-555555555555";

const ctx: KernelExtensionContext = {
	cwd: "/tmp",
	sessionManager: { getSessionId: () => "parent-uuid" },
};

describe("AgentManager.steer", () => {
	test("emits exactly one run_steered event per steering message, store or flush", async () => {
		const submitted: TraceEvent[] = [];
		const steered: string[] = [];
		let captured: AgentSpawnOptions | undefined;
		let finishRun!: () => void;
		const runGate = new Promise<void>((r) => {
			finishRun = r;
		});
		const session: AgentSpawnResult["session"] = {
			messages: [],
			sessionId: "child-uuid",
			steer: async (message: string) => {
				steered.push(message);
			},
		};

		const manager = new AgentManager(undefined, 4, undefined, {
			spawnAgent: async (_name, _prompt, _ctx, options) => {
				captured = options;
				await runGate;
				return { responseText: "done", session, aborted: false };
			},
			traceWriter: { submit: (e) => submitted.push(e) },
		});

		const id = manager.spawn({ appendEntry: () => {} }, ctx, "researcher", "go", {
			description: "steer test",
			containerId: CONTAINER_ID,
		});

		// Steer before the run identity exists: stored, emission deferred.
		expect(manager.steer(id, "focus on auth")).toBe(true);
		expect(submitted).toHaveLength(0);
		expect(manager.getRecord(id)?.pendingSteers).toEqual(["focus on auth"]);

		// The pipeline reports the run identity; the deferred event flushes.
		captured!.onRunStarted!({ runId: RUN_ID, containerId: CONTAINER_ID });
		expect(submitted).toHaveLength(1);
		expect(submitted[0].type).toBe("run_steered");
		expect(submitted[0].containerId).toBe(CONTAINER_ID);
		expect(submitted[0].runId).toBe(RUN_ID);
		expect(submitted[0].eventData).toMatchObject({
			run_id: RUN_ID,
			agent_name: "researcher",
			message: "focus on auth",
			delivery: "queued",
		});

		// Session appears: pending steers are delivered without re-emitting.
		captured!.onSessionCreated!(session);
		await Promise.resolve();
		expect(steered).toEqual(["focus on auth"]);
		expect(submitted).toHaveLength(1);

		// Live steer: delivered immediately, one event with pi session identity.
		expect(manager.steer(id, "also check tests")).toBe(true);
		expect(steered).toEqual(["focus on auth", "also check tests"]);
		expect(submitted).toHaveLength(2);
		expect(submitted[1].eventData).toMatchObject({
			message: "also check tests",
			delivery: "delivered",
		});
		expect(submitted[1].piSessionUuid).toBe("child-uuid");

		expect(manager.steer("nope", "x")).toBe(false);

		finishRun();
		await manager.getRecord(id)?.promise;
		// Completed agents no longer accept steers.
		expect(manager.steer(id, "too late")).toBe(false);
		manager.dispose();
	});

	test("without a traceWriter steering still works, silently", async () => {
		const steered: string[] = [];
		const session: AgentSpawnResult["session"] = {
			messages: [],
			sessionId: "child-uuid",
			steer: async (message: string) => {
				steered.push(message);
			},
		};
		let captured: AgentSpawnOptions | undefined;
		const manager = new AgentManager(undefined, 4, undefined, {
			spawnAgent: async (_name, _prompt, _ctx, options) => {
				captured = options;
				await new Promise(() => {}); // never resolves
				return { responseText: "", session, aborted: false };
			},
		});
		const id = manager.spawn({ appendEntry: () => {} }, ctx, "researcher", "go", {
			description: "no writer",
			containerId: CONTAINER_ID,
		});
		captured!.onRunStarted!({ runId: RUN_ID, containerId: CONTAINER_ID });
		captured!.onSessionCreated!(session);
		expect(manager.steer(id, "hello")).toBe(true);
		expect(steered).toEqual(["hello"]);
		manager.dispose();
	});
});
