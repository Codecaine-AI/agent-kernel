/**
 * Threshold semantics (plan §4.3): boundaries are inclusive, ties always
 * abstain, engine failures abstain every answer, and the applied thresholds
 * are always recorded.
 */
import { describe, expect, test } from "bun:test";

import type { DecisionQuestion, EngineAnswer, EngineResult } from "../types";
import { boolQ, choiceQ, scoreQ } from "./__fixtures__/decide-harness";
import { applyThresholds, chosenLabel, DEFAULT_THRESHOLDS, mostSevereReason } from "./thresholds";

const defaults = { ...DEFAULT_THRESHOLDS };

function ok(answers: Record<string, EngineAnswer>): Pick<EngineResult, "ok" | "answers" | "error"> {
	return { ok: true, answers };
}

function decideOne(question: DecisionQuestion, answer: EngineAnswer) {
	return applyThresholds(ok({ q: answer }), { q: question }, defaults).q!;
}

describe("applyThresholds", () => {
	test("bool thresholds at the boundaries", () => {
		const q = boolQ({ passAt: 0.8, failAt: 0.2 });
		expect(decideOne(q, { type: "bool", probability: 0.8 })).toEqual({
			kind: "bool",
			choice: "true",
			probability: 0.8,
			confidence: 0.8,
			confidenceSource: "native",
			verdict: "pass",
			abstained: false,
			thresholdApplied: { passAt: 0.8, failAt: 0.2 },
		});
		expect(decideOne(q, { type: "bool", probability: 0.2 })).toMatchObject({
			choice: "false",
			verdict: "fail",
			abstained: false,
			confidence: 0.8,
		});
		const between = decideOne(q, { type: "bool", probability: 0.79 });
		expect(between).toMatchObject({ abstained: true, abstainReason: "low-confidence", choice: "true", confidence: 0.79 });
		expect(between.verdict).toBeUndefined();
		expect(decideOne(q, { type: "bool", probability: 0.3 })).toMatchObject({ confidence: 0.7, choice: "false" });
		// Defaults apply and are recorded when the question sets none.
		expect(decideOne(boolQ(), { type: "bool", probability: 0.85 })).toMatchObject({
			verdict: "pass",
			thresholdApplied: { passAt: 0.85, failAt: 0.15 },
		});
	});

	test("choice recomputes argmax and applies minTop and minMargin; a tie abstains", () => {
		const q = choiceQ(["accept", "revise", "escalate"]);
		// The reported choice disagrees with the distribution: argmax wins; missing labels count as 0.
		const recomputed = decideOne(q, {
			type: "choice",
			choice: "revise",
			distribution: { accept: 0.8, revise: 0.2 },
			confidence: 0.7,
		});
		expect(recomputed).toEqual({
			kind: "choice",
			choice: "accept",
			distribution: { accept: 0.8, revise: 0.2, escalate: 0 },
			confidence: 0.7,
			confidenceSource: "native",
			abstained: false,
			thresholdApplied: { minTop: 0.6, minMargin: 0.2 },
		});
		// top exactly minTop with margin exactly minMargin passes (0.6 − 0.4 in floats is 0.19999…).
		expect(decideOne(q, { type: "choice", choice: "accept", distribution: { accept: 0.6, revise: 0.4 } })).toMatchObject({
			abstained: false,
		});
		expect(decideOne(q, { type: "choice", choice: "accept", distribution: { accept: 0.59, revise: 0.41 } })).toMatchObject({
			abstained: true,
			abstainReason: "low-confidence",
		});
		expect(
			decideOne(q, { type: "choice", choice: "accept", distribution: { accept: 0.65, revise: 0.35, escalate: 0 } }),
		).toMatchObject({ abstained: false });
		expect(
			decideOne(q, { type: "choice", choice: "accept", distribution: { accept: 0.62, revise: 0.38 } }),
		).toMatchObject({ abstained: false });
		expect(decideOne(q, { type: "choice", choice: "accept", distribution: { accept: 0.7, revise: 0.51 } })).toMatchObject({
			abstained: true,
			abstainReason: "low-confidence",
		});
		const tie = decideOne(choiceQ(["a", "b", "c"], { minTop: 0.3, minMargin: 0 }), {
			type: "choice",
			choice: "b",
			distribution: { a: 0.4, b: 0.4, c: 0.2 },
		});
		expect(tie).toMatchObject({ abstained: true, abstainReason: "low-confidence", choice: "b" });
	});

	test("a tie abstains even with minMargin 0", () => {
		const decision = decideOne(choiceQ(["a", "b"], { minTop: 0.5, minMargin: 0 }), {
			type: "choice",
			choice: "a",
			distribution: { a: 0.5, b: 0.5 },
		});
		expect(decision).toMatchObject({
			abstained: true,
			abstainReason: "low-confidence",
			thresholdApplied: { minTop: 0.5, minMargin: 0 },
		});
	});

	test("score abstains below abstainBelow", () => {
		const q = scoreQ(4, { abstainBelow: 0.6 });
		expect(decideOne(q, { type: "score", score: 2.4, confidence: 0.6 })).toEqual({
			kind: "score",
			score: 2.4,
			confidence: 0.6,
			confidenceSource: "native",
			abstained: false,
			thresholdApplied: { abstainBelow: 0.6 },
		});
		expect(decideOne(q, { type: "score", score: 3, confidence: 0.59, distribution: { "3": 0.6, "2": 0.4 } })).toMatchObject({
			abstained: true,
			abstainReason: "low-confidence",
			distribution: { "3": 0.6, "2": 0.4 },
		});
	});

	test("engine error abstains every answer as engine-error; refusal as refusal", () => {
		const questions = { a: boolQ(), b: choiceQ(), c: scoreQ() };
		const failed = applyThresholds(
			{ ok: false, answers: {}, error: { kind: "rate-limit", message: "busy" } },
			questions,
			defaults,
		);
		for (const decision of Object.values(failed)) {
			expect(decision).toMatchObject({
				abstained: true,
				abstainReason: "engine-error",
				confidenceSource: "none",
				thresholdApplied: {},
			});
			expect(decision.choice).toBeUndefined();
		}
		expect(failed.b!.kind).toBe("choice");
		const refused = applyThresholds({ ok: false, answers: {}, error: { kind: "refusal", message: "no" } }, questions, defaults);
		expect(Object.values(refused).map((d) => d.abstainReason)).toEqual(["refusal", "refusal", "refusal"]);
		// A missing answer on an ok result abstains engine-error; the others are unaffected.
		const partial = applyThresholds(ok({ a: { type: "bool", probability: 0.95 } }), { a: boolQ(), b: boolQ() }, defaults);
		expect(partial.a).toMatchObject({ verdict: "pass" });
		expect(partial.b).toMatchObject({ abstained: true, abstainReason: "engine-error" });
	});
});

describe("outcome summaries", () => {
	test("chosen labels and the most severe abstain reason", () => {
		const decisions = applyThresholds(
			ok({
				z: { type: "bool", probability: 0.1 },
				a: { type: "score", score: 2, confidence: 0.9 },
				m: { type: "choice", choice: "x", distribution: { x: 0.5, y: 0.5 } },
			}),
			{ z: boolQ(), a: scoreQ(), m: choiceQ(["x", "y"]) },
			defaults,
		);
		expect(chosenLabel(decisions)).toBe("a=2,m=abstain,z=false");
		expect(chosenLabel({ only: decisions.z! })).toBe("false");
		expect(chosenLabel({ only: decisions.m! })).toBe("abstain");
		expect(mostSevereReason(Object.values(decisions))).toBe("low-confidence");
		expect(
			mostSevereReason([
				{ kind: "bool", confidenceSource: "none", abstained: true, abstainReason: "refusal", thresholdApplied: {} },
				{ kind: "bool", confidenceSource: "none", abstained: true, abstainReason: "engine-error", thresholdApplied: {} },
				{ kind: "bool", confidenceSource: "native", abstained: true, abstainReason: "low-confidence", thresholdApplied: {} },
			]),
		).toBe("engine-error");
	});
});
