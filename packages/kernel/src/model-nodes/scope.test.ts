import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runWithContext, type RunContext } from "../run-context";
import { createTempKernelDb, type TempKernelDb } from "./__fixtures__/temp-kernel";
import { createNodeClock, defaultNodeTrigger, resolveNodeScope } from "./scope";
import { KernelNodeError } from "./types";

let temp: TempKernelDb;

beforeEach(async () => {
	temp = await createTempKernelDb();
});

afterEach(() => {
	temp.cleanup();
});

function ambient(runId: string, containerId: string): RunContext {
	return {
		containerId,
		runId,
		trigger: "operator",
		agentName: "parent-agent",
		traceWriter: { submit() {} },
	};
}

async function rejection(promise: Promise<unknown>): Promise<KernelNodeError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(KernelNodeError);
		return error as KernelNodeError;
	}
	throw new Error("expected a rejection");
}

describe("resolveNodeScope", () => {
	test("derives containerId from parentRunId", async () => {
		const parent = await temp.seedParentRun();
		const scope = await resolveNodeScope({ parentRunId: parent.runId }, { db: temp.db });
		expect(scope.containerId).toBe(temp.containerId);
		expect(scope.parentRunId).toBe(parent.runId);
	});

	test("uses the ambient run context for parent run and container", async () => {
		const parent = await temp.seedParentRun();
		const scope = await runWithContext(ambient(parent.runId, temp.containerId), () =>
			resolveNodeScope({}, { db: temp.db }),
		);
		expect(scope).toEqual({ containerId: temp.containerId, parentRunId: parent.runId, trigger: "post-run" });
	});

	test("rejects a missing container", async () => {
		const none = await rejection(resolveNodeScope({}, { db: temp.db }));
		expect(none.code).toBe("no-container");

		const unknown = await rejection(resolveNodeScope({ containerId: "no-such-container" }, { db: temp.db }));
		expect(unknown.code).toBe("no-container");
	});

	test("rejects a parent run that is not in this kernel's database", async () => {
		const explicit = await rejection(resolveNodeScope({ parentRunId: "no-such-run" }, { db: temp.db }));
		expect(explicit.code).toBe("unknown-parent-run");

		const fromAmbient = await rejection(
			runWithContext(ambient("other-kernels-run", temp.containerId), () => resolveNodeScope({}, { db: temp.db })),
		);
		expect(fromAmbient.code).toBe("unknown-parent-run");
	});

	test("trigger defaults: parent-tool only with an explicit parentToolUseId; post-run with a parent run; else system", async () => {
		const parent = await temp.seedParentRun();
		const run = ambient(parent.runId, temp.containerId);

		// Inside an ambient run without parentToolUseId: post-run, never parent-tool.
		const inRun = await runWithContext(run, () => resolveNodeScope({}, { db: temp.db }));
		expect(inRun.trigger).toBe("post-run");

		const withTool = await runWithContext(run, () =>
			resolveNodeScope({ parentToolUseId: "toolu_1" }, { db: temp.db }),
		);
		expect(withTool.trigger).toBe("parent-tool");
		expect(withTool.parentToolUseId).toBe("toolu_1");

		const standalone = await resolveNodeScope({ containerId: temp.containerId }, { db: temp.db });
		expect(standalone.trigger).toBe("system");
		expect(standalone.parentRunId).toBeUndefined();

		const explicit = await resolveNodeScope({ containerId: temp.containerId, trigger: "operator" }, { db: temp.db });
		expect(explicit.trigger).toBe("operator");

		const decision = await runWithContext(run, () =>
			resolveNodeScope({ parentToolUseId: "toolu_1" }, { db: temp.db, defaultTrigger: "judge" }),
		);
		expect(decision.trigger).toBe("judge");

		expect(defaultNodeTrigger({})).toBe("system");
	});
});

describe("createNodeClock", () => {
	test("node clock never repeats a millisecond", () => {
		let wall = 1_000;
		const clock = createNodeClock(() => wall);
		const readings = Array.from({ length: 50 }, () => clock.nextMs());
		expect(new Set(readings).size).toBe(50);
		for (let i = 1; i < readings.length; i++) expect(readings[i]).toBeGreaterThan(readings[i - 1]!);

		wall = 500; // the wall clock steps back: readings still increase
		expect(clock.nextMs()).toBeGreaterThan(readings.at(-1)!);

		clock.observe(10_000);
		expect(clock.nextMs()).toBe(10_001);
		expect(clock.nextMs(20_000)).toBe(20_000);
		expect(clock.nextIso()).toBe(new Date(20_001).toISOString());
	});
});
