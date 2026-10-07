import { describe, expect, test } from "bun:test";

import { clampPct, gateQuestionBars, questionBars } from "./utils";

describe("ProbabilityBars utils", () => {
	test("widths are the probability as a percentage, clamped to [0, 100]", () => {
		expect(clampPct(0.91)).toBe(91);
		expect(clampPct(0.575)).toBe(57.5);
		expect(clampPct(0)).toBe(0);
		expect(clampPct(1)).toBe(100);
		expect(clampPct(1.4)).toBe(100);
		expect(clampPct(-0.2)).toBe(0);
		expect(clampPct(Number.NaN)).toBe(0);
		expect(clampPct(undefined)).toBe(0);
	});

	test("bool: one p(true) bar with the pass and fail markers at their positions", () => {
		const bars = questionBars(
			"ok",
			{ kind: "bool", probability: 0.91, verdict: "pass", abstained: false },
			{ passAt: 0.85, failAt: 0.15 },
		);
		expect(bars).toMatchObject({ id: "ok", kind: "bool", outcome: "pass", abstained: false, empty: false });
		expect(bars.rows).toEqual([
			{
				label: "true",
				value: 0.91,
				widthPct: 91,
				chosen: true,
				markers: [
					{ kind: "pass", label: "pass ≥ 0.85", positionPct: 85 },
					{ kind: "fail", label: "fail ≤ 0.15", positionPct: 15 },
				],
			},
		]);
	});

	test("marker positions are clamped too, so a bad threshold never leaves the track", () => {
		const bars = questionBars("ok", { kind: "bool", probability: 0.5 }, { passAt: 1.3, failAt: -1 });
		expect(bars.rows[0]?.markers.map((marker) => marker.positionPct)).toEqual([100, 0]);
	});

	test("choice: a bar per option, the argmax chosen, the floor marker on every bar", () => {
		const bars = questionBars(
			"next",
			{
				kind: "choice",
				choice: "continue",
				distribution: { stop: 0.21, continue: 0.71, escalate: 0.08 },
				confidence: 0.64,
				abstained: false,
			},
			{ minTop: 0.5 },
		);
		expect(bars.outcome).toBe("continue");
		expect(bars.rows.map((row) => [row.label, row.widthPct, row.chosen])).toEqual([
			["stop", 21, false],
			["continue", 71, true],
			["escalate", 8, false],
		]);
		for (const row of bars.rows) {
			expect(row.markers).toEqual([{ kind: "floor", label: "floor 0.50", positionPct: 50 }]);
		}
	});

	test("score: level bars, then the confidence bar against abstainBelow", () => {
		const bars = questionBars(
			"quality",
			{ kind: "score", score: 2, distribution: { "0": 0.1, "1": 0.2, "2": 0.7 }, confidence: 0.7 },
			{ abstainBelow: 0.4 },
		);
		expect(bars.outcome).toBe("score 2");
		expect(bars.rows.map((row) => row.label)).toEqual(["0", "1", "2", "confidence"]);
		expect(bars.rows[3]?.markers).toEqual([{ kind: "floor", label: "abstain below 0.40", positionPct: 40 }]);
		expect(bars.rows.slice(0, 3).every((row) => row.markers.length === 0)).toBe(true);
	});

	test("abstain state: a low-confidence abstain keeps its bar, an engine error has none", () => {
		const low = questionBars(
			"ok",
			{ kind: "bool", probability: 0.52, abstained: true, abstainReason: "low-confidence" },
			{ passAt: 0.85, failAt: 0.15 },
		);
		expect(low).toMatchObject({ abstained: true, empty: false, outcome: "abstain · low-confidence" });

		const error = questionBars("ok", { kind: "bool", abstained: true, abstainReason: "engine-error" }, {});
		expect(error).toMatchObject({ abstained: true, empty: true, rows: [], outcome: "abstain · engine-error" });
	});

	test("a gate's decide question becomes a bool bar against its pass_at and fail_at", () => {
		const bars = gateQuestionBars({
			question_id: "ok",
			result: "pass",
			run_id: "RD1",
			probability: 0.91,
			pass_at: 0.85,
			fail_at: 0.15,
		});
		expect(bars.outcome).toBe("pass");
		expect(bars.rows[0]?.widthPct).toBe(91);
		expect(bars.rows[0]?.markers.map((marker) => marker.kind)).toEqual(["pass", "fail"]);
	});
});
