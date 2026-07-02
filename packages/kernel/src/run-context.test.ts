import { describe, expect, test } from "bun:test";

import {
	currentTraceIds,
	runWithContext,
	traceIdsOf,
	type RunContext,
} from "./run-context";

const baseCtx: RunContext = {
	containerId: "container-1",
	runId: "run-1",
	trigger: "operator",
	agentName: "demo",
	traceWriter: { submit() {} },
	piSessionUuid: "pi-1",
	userId: "user-1",
};

describe("currentTraceIds", () => {
	test("builds envelope identity from the async-local run context", async () => {
		const ids = await runWithContext(baseCtx, async () => currentTraceIds());
		expect(ids).toEqual({
			containerId: "container-1",
			runId: "run-1",
			userId: "user-1",
			piSessionUuid: "pi-1",
		});
	});

	test("throws outside a run scope", () => {
		expect(() => currentTraceIds()).toThrow("no run context");
	});

	test("omits unset optional correlation fields", () => {
		const ids = traceIdsOf({
			containerId: "c",
			runId: "r",
			trigger: "system",
			agentName: "a",
			traceWriter: { submit() {} },
		});
		expect(ids).toEqual({ containerId: "c", runId: "r" });
		expect("userId" in ids).toBe(false);
		expect("piSessionUuid" in ids).toBe(false);
	});
});
