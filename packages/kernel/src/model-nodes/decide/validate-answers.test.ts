/**
 * Answer validation before thresholds (plan §4.3, A2-F3; rounding
 * feasibility round 3 A2-F2): a malformed answer abstains `engine-error`
 * and never passes; the other answers are unaffected.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { getAgentRun } from "@agent-kernel/db";

import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import type { DecisionQuestion, EngineAnswer } from "../types";
import { answeringEngine, boolQ, choiceQ, expectDoctorOk, FAKE_REF, scoreQ } from "./__fixtures__/decide-harness";
import { isRoundingFeasible, malformedAnswers } from "./validate-answers";

let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
});
afterAll(() => {
	restoreFetch();
});

let temp: TempKernel | undefined;
afterEach(() => {
	temp?.cleanup();
	temp = undefined;
});

function labels(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `l${i}`);
}

describe("malformed answers", () => {
	test("malformed answers abstain engine-error (injectable engine)", async () => {
		const questions: Record<string, DecisionQuestion> = {
			p_high: boolQ(),
			p_nan: boolQ(),
			wrong_type: boolQ(),
			undeclared: choiceQ(["a", "b", "c"]),
			sum_high: choiceQ(["a", "b", "c"]),
			score_high: scoreQ(4),
			conf_negative: scoreQ(4),
			fine_bool: boolQ(),
			fine_choice: choiceQ(["a", "b", "c"]),
		};
		const answers: Record<string, EngineAnswer> = {
			p_high: { type: "bool", probability: 1.5 },
			p_nan: { type: "bool", probability: Number.NaN },
			wrong_type: { type: "score", score: 1, confidence: 0.9 },
			undeclared: { type: "choice", choice: "zzz", distribution: { a: 0.9, zzz: 0.1 }, confidence: 0.9 },
			sum_high: { type: "choice", choice: "a", distribution: { a: 0.5, b: 0.5, c: 0.4 }, confidence: 0.9 },
			score_high: { type: "score", score: 7, confidence: 0.9 },
			conf_negative: { type: "score", score: 1, confidence: -0.2 },
			fine_bool: { type: "bool", probability: 0.97 },
			fine_choice: { type: "choice", choice: "b", distribution: { a: 0.05, b: 0.9, c: 0.05 }, confidence: 0.8 },
		};
		temp = await createTempKernel({
			decide: { engine: answeringEngine(answers) },
			models: { defaults: { decide: FAKE_REF } },
		});
		const outcome = await temp.kernel.decide("malformed", { a: 1 }, { containerId: temp.tempDb.containerId, questions });
		const bad = ["p_high", "p_nan", "wrong_type", "undeclared", "sum_high", "score_high", "conf_negative"];
		for (const id of bad) {
			expect(outcome.answers[id], id).toMatchObject({ abstained: true, abstainReason: "engine-error", confidenceSource: "none" });
			expect(outcome.answers[id]!.verdict, id).toBeUndefined();
		}
		expect(outcome.answers.fine_bool).toMatchObject({ verdict: "pass", abstained: false });
		expect(outcome.answers.fine_choice).toMatchObject({ choice: "b", abstained: false });
		expect(outcome.error).toEqual({ kind: "malformed-answer", message: `malformed answers: ${bad.join(", ")}` });
		expect(outcome.abstainReason).toBe("engine-error");
		expect((await getAgentRun(temp.tempDb.db, outcome.ids.runId))?.status).toBe("error");
		await expectDoctorOk(temp.tempDb.db);
	});

	test("a missing answer and a choice without a distribution are malformed", () => {
		expect(malformedAnswers({}, { q: boolQ() }, 0.01)).toEqual(["q"]);
		expect(malformedAnswers({ q: { type: "choice", choice: "a" } }, { q: choiceQ(["a", "b"]) }, 0.01)).toEqual(["q"]);
		expect(
			malformedAnswers({ q: { type: "choice", choice: "a", distribution: { a: 1 }, confidence: 1.2 } }, { q: choiceQ(["a", "b"]) }, 0.01),
		).toEqual(["q"]);
		expect(malformedAnswers({ q: { type: "score", score: 1, confidence: 0.5, distribution: { "4": 1 } } }, { q: scoreQ(4) }, 0.01)).toEqual([
			"q",
		]);
	});
});

describe("rounding feasibility", () => {
	test("valid rounded distributions pass", () => {
		const ten = labels(10);
		const tenDist = Object.fromEntries(ten.map((l, i) => [l, i < 9 ? 0.11 : 0.05]));
		expect(isRoundingFeasible(tenDist, ten, 0.01)).toBe(true);
		const many = labels(255);
		expect(isRoundingFeasible({ l7: 1 }, many, 0.01)).toBe(true);
		const scoreKeys = ["0", "1", "2"];
		expect(isRoundingFeasible({ "0": 0.33, "1": 0.33, "2": 0.33 }, scoreKeys, 0.01)).toBe(true);

		const answers: Record<string, EngineAnswer> = {
			ten: { type: "choice", choice: "l0", distribution: tenDist, confidence: 0.1 },
			many: { type: "choice", choice: "l7", distribution: { l7: 1 }, confidence: 1 },
			score: { type: "score", score: 1, confidence: 0.4, distribution: { "0": 0.33, "1": 0.33, "2": 0.33 } },
		};
		const questions = { ten: choiceQ(ten), many: choiceQ(many), score: scoreQ(3) };
		expect(malformedAnswers(answers, questions, 0.01)).toEqual([]);
	});

	test("impossible rounded distributions are malformed", () => {
		const many = labels(255);
		// lower sum 1 − 0.005 + 0.75 − 0.005 = 1.74 > 1
		expect(isRoundingFeasible({ l0: 1, l1: 0.75 }, many, 0.01)).toBe(false);
		// upper sum 3 × 0.205 = 0.615 < 1
		expect(isRoundingFeasible({ a: 0.2, b: 0.2, c: 0.2 }, ["a", "b", "c"], 0.01)).toBe(false);
		const answers: Record<string, EngineAnswer> = {
			heavy: { type: "choice", choice: "l0", distribution: { l0: 1, l1: 0.75 }, confidence: 1 },
			light: { type: "choice", choice: "a", distribution: { a: 0.2, b: 0.2, c: 0.2 }, confidence: 0.2 },
		};
		expect(malformedAnswers(answers, { heavy: choiceQ(many), light: choiceQ(["a", "b", "c"]) }, 0.01)).toEqual([
			"heavy",
			"light",
		]);
		// A coarser wire precision widens the intervals: 3 × 0.2 rounds from a valid distribution at step 0.5.
		expect(isRoundingFeasible({ a: 0.2, b: 0.2, c: 0.2 }, ["a", "b", "c"], 0.5)).toBe(true);
	});
});
