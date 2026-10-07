import { describe, expect, test } from "bun:test";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import { stepAttributeRows, stepEventRows, stepSummaryRows } from "./utils";

function values(rows: Array<{ key: string; label: string; value: string }>): Array<[string, string]> {
	return rows.map((row) => [row.label, row.value]);
}

describe("StepBody utils", () => {
	test("summary: name, status, timing and the run it ran on", () => {
		expect(values(stepSummaryRows(fixtureSpan("step")))).toEqual([
			["Step", "validate"],
			["Status", "ok"],
			["Duration", "420 ms"],
			["Run", "R1"],
		]);
	});

	test("a gate's step check adds its result and recorded value", () => {
		const rows = Object.fromEntries(values(stepSummaryRows(fixtureSpan("gateStep"))));
		expect(rows.Check).toBe("pass");
		expect(rows.Value).toBe("true");
	});

	test("attributes from step start and end merge into one table", () => {
		expect(values(stepAttributeRows(fixtureSpan("step")))).toEqual([
			["target", "fn_8003A1C4"],
			["unit", "d_a_player"],
		]);
	});

	test("events list their offset from the step's start and their attributes", () => {
		expect(values(stepEventRows(fixtureSpan("step")))).toEqual([["objdiff", '+400 ms {"match":100}']]);
	});

	test("a step without attributes or events has empty tables", () => {
		const bare = { ...fixtureSpan("step"), attributes: [] };
		expect(stepAttributeRows(bare)).toEqual([]);
		expect(stepEventRows(bare)).toEqual([]);
	});
});
