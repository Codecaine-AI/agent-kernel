import { describe, expect, test } from "bun:test";

import type { AgentRun, KernelContainerSummary } from "@agent-kernel/viewer-core";

import {
	aggregateUsageForScope,
	computeTotals,
	durationMs,
	formatCost,
	formatDuration,
	formatTokens,
	rollupByAgent,
	summarizeUsage,
	toRunRow,
	usageScopeForSpanId,
} from "./usage-summary";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
	return {
		id: overrides.id ?? "run-1",
		piSessionId: "pi-1",
		containerId: "c-1",
		agentName: "source-scout",
		trigger: "parent-tool",
		status: "done",
		startedAt: "2026-07-02T21:28:44.000Z",
		endedAt: "2026-07-02T21:28:49.000Z",
		usageInputTokens: 100,
		usageOutputTokens: 40,
		usageCacheRead: 10,
		usageCacheWrite: 0,
		usageCostEstimate: 0,
		...overrides,
	};
}

function container(
	overrides: Partial<KernelContainerSummary> = {},
): KernelContainerSummary {
	return {
		id: "c-1",
		kind: "session",
		label: "trace",
		status: "done",
		createdAt: "2026-07-02T21:28:44.000Z",
		startedAt: "2026-07-02T21:28:44.000Z",
		endedAt: "2026-07-02T21:31:35.000Z",
		...overrides,
	};
}

describe("durationMs", () => {
	test("computes a positive span", () => {
		expect(durationMs("2026-07-02T21:28:44.000Z", "2026-07-02T21:28:49.000Z")).toBe(
			5000,
		);
	});
	test("returns null for missing or reversed bounds", () => {
		expect(durationMs(null, "2026-07-02T21:28:49.000Z")).toBeNull();
		expect(durationMs("2026-07-02T21:28:49.000Z", null)).toBeNull();
		expect(durationMs("2026-07-02T21:28:49.000Z", "2026-07-02T21:28:44.000Z")).toBeNull();
	});
});

describe("toRunRow", () => {
	test("treats a zero/absent cost as no-price (null)", () => {
		expect(toRunRow(run({ usageCostEstimate: 0 })).cost).toBeNull();
		expect(toRunRow(run({ usageCostEstimate: undefined })).cost).toBeNull();
		expect(toRunRow(run({ usageCostEstimate: null })).cost).toBeNull();
	});
	test("preserves a positive cost", () => {
		expect(toRunRow(run({ usageCostEstimate: 0.42 })).cost).toBe(0.42);
	});
	test("coerces missing token fields to 0", () => {
		const row = toRunRow(run({ usageInputTokens: undefined, usageCacheRead: undefined }));
		expect(row.inputTokens).toBe(0);
		expect(row.cacheRead).toBe(0);
	});
});

describe("rollupByAgent", () => {
	test("aggregates multiple runs of the same agent", () => {
		const rows = [
			run({ id: "a", agentName: "source-scout", usageInputTokens: 100, usageOutputTokens: 40 }),
			run({ id: "b", agentName: "source-scout", usageInputTokens: 60, usageOutputTokens: 20 }),
			run({ id: "c", agentName: "report-writer", usageInputTokens: 200, usageOutputTokens: 80 }),
		].map(toRunRow);
		const byAgent = rollupByAgent(rows);
		const scout = byAgent.find((a) => a.agentName === "source-scout");
		expect(scout).toBeDefined();
		expect(scout!.runCount).toBe(2);
		expect(scout!.inputTokens).toBe(160);
		expect(scout!.outputTokens).toBe(60);
	});

	test("sorts by total tokens descending", () => {
		const rows = [
			run({ id: "a", agentName: "small", usageInputTokens: 10, usageOutputTokens: 5 }),
			run({ id: "b", agentName: "big", usageInputTokens: 500, usageOutputTokens: 200 }),
		].map(toRunRow);
		expect(rollupByAgent(rows).map((a) => a.agentName)).toEqual(["big", "small"]);
	});

	test("rolls cost to null when no run has a price, and sums positive costs", () => {
		const noPrice = rollupByAgent([toRunRow(run({ usageCostEstimate: 0 }))]);
		expect(noPrice[0]!.cost).toBeNull();
		const priced = rollupByAgent([
			toRunRow(run({ id: "a", usageCostEstimate: 0.1 })),
			toRunRow(run({ id: "b", usageCostEstimate: 0.2 })),
		]);
		expect(priced[0]!.cost).toBeCloseTo(0.3, 6);
	});
});

describe("computeTotals", () => {
	test("sums token fields across runs and reads duration from container", () => {
		const rows = [
			run({ id: "a", usageInputTokens: 100, usageOutputTokens: 40, usageCacheRead: 10 }),
			run({ id: "b", usageInputTokens: 60, usageOutputTokens: 20, usageCacheRead: 5 }),
		].map(toRunRow);
		const totals = computeTotals(rows, container());
		expect(totals.inputTokens).toBe(160);
		expect(totals.outputTokens).toBe(60);
		expect(totals.cacheRead).toBe(15);
		expect(totals.runCount).toBe(2);
		expect(totals.durationMs).toBe((2 * 60 + 51) * 1000);
	});

	test("cost stays null when every run is zero-cost", () => {
		const totals = computeTotals([toRunRow(run({ usageCostEstimate: 0 }))], container());
		expect(totals.cost).toBeNull();
	});

	test("null container yields null duration", () => {
		expect(computeTotals([toRunRow(run())], null).durationMs).toBeNull();
	});
});

describe("summarizeUsage", () => {
	test("wires runs → totals + rows + byAgent", () => {
		const summary = summarizeUsage({
			container: container(),
			runs: [run({ id: "a" }), run({ id: "b", agentName: "report-writer" })],
		});
		expect(summary.runs).toHaveLength(2);
		expect(summary.byAgent).toHaveLength(2);
		expect(summary.totals.runCount).toBe(2);
	});
});

describe("usageScopeForSpanId", () => {
	test("parses each container/phase/session/run span id", () => {
		expect(usageScopeForSpanId("container:c-1")).toEqual({
			kind: "container",
			containerId: "c-1",
		});
		expect(usageScopeForSpanId("phase:research")).toEqual({
			kind: "phase",
			phase: "research",
		});
		expect(usageScopeForSpanId("pi:sess-9")).toEqual({
			kind: "session",
			piSessionId: "sess-9",
		});
		expect(usageScopeForSpanId("run:run-7")).toEqual({
			kind: "run",
			runId: "run-7",
		});
	});
	test("returns null for a leaf event span id", () => {
		expect(usageScopeForSpanId("evt-abc123")).toBeNull();
	});
});

describe("aggregateUsageForScope", () => {
	const runs: AgentRun[] = [
		run({ id: "a", containerId: "c-1", piSessionId: "pi-1", phase: "research", usageInputTokens: 100, usageOutputTokens: 40 }),
		run({ id: "b", containerId: "c-1", piSessionId: "pi-2", phase: "report", usageInputTokens: 60, usageOutputTokens: 20 }),
		run({ id: "c", containerId: "c-2", piSessionId: "pi-3", phase: "research", usageInputTokens: 5, usageOutputTokens: 5 }),
	];

	test("container scope folds every run under the container and reads container duration", () => {
		const agg = aggregateUsageForScope({
			scope: { kind: "container", containerId: "c-1" },
			runs,
			container: container(),
		});
		expect(agg).not.toBeNull();
		expect(agg!.totals.runCount).toBe(2);
		expect(agg!.totals.inputTokens).toBe(160);
		expect(agg!.totals.durationMs).toBe((2 * 60 + 51) * 1000);
	});

	test("session scope folds only that session's runs", () => {
		const agg = aggregateUsageForScope({
			scope: { kind: "session", piSessionId: "pi-2" },
			runs,
		});
		expect(agg!.runs.map((r) => r.id)).toEqual(["b"]);
		expect(agg!.totals.durationMs).toBeNull();
	});

	test("phase scope folds runs stamped with that phase across containers", () => {
		const agg = aggregateUsageForScope({
			scope: { kind: "phase", phase: "research" },
			runs,
		});
		expect(agg!.totals.runCount).toBe(2);
		expect(agg!.runs.map((r) => r.id).sort()).toEqual(["a", "c"]);
	});

	test("run scope folds the single run", () => {
		const agg = aggregateUsageForScope({ scope: { kind: "run", runId: "c" }, runs });
		expect(agg!.runs).toHaveLength(1);
		expect(agg!.runs[0]!.id).toBe("c");
	});

	test("returns null when the scope catches no runs", () => {
		expect(
			aggregateUsageForScope({ scope: { kind: "container", containerId: "nope" }, runs }),
		).toBeNull();
	});
});

describe("formatting", () => {
	test("formatTokens uses thousands separators", () => {
		expect(formatTokens(1234567)).toBe("1,234,567");
		expect(formatTokens(0)).toBe("0");
	});
	test("formatCost renders em dash for null and USD for a price", () => {
		expect(formatCost(null)).toBe("—");
		expect(formatCost(1.5)).toBe("$1.50");
		expect(formatCost(0.0042)).toBe("$0.0042");
	});
	test("formatDuration renders ms/s/m and em dash for null", () => {
		expect(formatDuration(null)).toBe("—");
		expect(formatDuration(820)).toBe("820ms");
		expect(formatDuration(5000)).toBe("5s");
		expect(formatDuration((1 * 60 + 24) * 1000)).toBe("1m 24s");
	});
});
