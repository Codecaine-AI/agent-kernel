/**
 * Answer validation (plan §4.3, A2-F3): runs on every `ok` engine result,
 * before thresholds. An answer that does not match its question abstains
 * `engine-error`; the outcome records `error.kind: "malformed-answer"` with
 * the offending question ids. Pure.
 */
import type { DecisionQuestion, EngineAnswer } from "../types";

export const DEFAULT_WIRE_PRECISION: Readonly<Record<string, number>> = { "typesafe-system-one": 0.01, "*": 0.01 };
const FALLBACK_PRECISION = 0.01;
const SUM_TOLERANCE = 1e-9;

/** Wire decimal step for a Pi api id: exact, then "*", then 0.01. */
export function precisionFor(api: string, wirePrecision: Readonly<Record<string, number>>): number {
	return wirePrecision[api] ?? wirePrecision["*"] ?? FALLBACK_PRECISION;
}

/**
 * Rounding feasibility (round 3 A2-F2): accepted iff some normalized
 * distribution rounds to the reported one. Each reported `p_i` (a declared
 * key missing from `reported` counts as 0) stands for a true value in
 * `[max(0, p_i − h), min(1, p_i + h)]` with `h = precision / 2`; feasible iff
 * `Σ lower ≤ 1` and `Σ upper ≥ 1` (± 1e-9).
 */
export function isRoundingFeasible(
	reported: Readonly<Record<string, number>>,
	declaredKeys: readonly string[],
	precision: number,
): boolean {
	const h = precision / 2;
	let lower = 0;
	let upper = 0;
	for (const key of declaredKeys) {
		const p = Object.hasOwn(reported, key) ? reported[key]! : 0;
		lower += Math.max(0, p - h);
		upper += Math.min(1, p + h);
	}
	return lower <= 1 + SUM_TOLERANCE && upper >= 1 - SUM_TOLERANCE;
}

/** Question ids whose answers are malformed, in question order. */
export function malformedAnswers(
	answers: Readonly<Record<string, EngineAnswer>>,
	questions: Readonly<Record<string, DecisionQuestion>>,
	precision: number,
): string[] {
	const malformed: string[] = [];
	for (const [id, question] of Object.entries(questions)) {
		const answer = Object.hasOwn(answers, id) ? answers[id] : undefined;
		if (!answer || !isAnswerValid(answer, question, precision)) malformed.push(id);
	}
	return malformed;
}

function isAnswerValid(answer: EngineAnswer, question: DecisionQuestion, precision: number): boolean {
	if (typeof answer !== "object" || answer === null || answer.type !== question.type) return false;
	for (const field of ["probability", "score", "confidence"] as const) {
		const value = answer[field];
		if (value !== undefined && !isFiniteNumber(value)) return false;
	}
	// A present distribution must be a record of finite numbers (null, arrays and strings are malformed).
	if (answer.distribution !== undefined && !isNumberRecord(answer.distribution)) return false;

	switch (question.type) {
		case "bool":
			return isUnit(answer.probability);
		case "choice": {
			const labels = Object.keys(question.criteria);
			const distribution = answer.distribution;
			if (typeof answer.choice !== "string" || !labels.includes(answer.choice)) return false;
			if (distribution === undefined) return false;
			if (!Object.entries(distribution).every(([key, p]) => labels.includes(key) && isUnit(p))) return false;
			if (answer.confidence !== undefined && !isUnit(answer.confidence)) return false;
			return isRoundingFeasible(distribution, labels, precision);
		}
		case "score": {
			const levels = question.criteria.length;
			if (!isFiniteNumber(answer.score) || answer.score < 0 || answer.score > levels - 1) return false;
			if (!isUnit(answer.confidence)) return false;
			const distribution = answer.distribution;
			if (distribution === undefined) return true;
			const keys = Array.from({ length: levels }, (_, i) => String(i));
			if (!Object.entries(distribution).every(([key, p]) => keys.includes(key) && isUnit(p))) return false;
			return isRoundingFeasible(distribution, keys, precision);
		}
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isUnit(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value).every(isFiniteNumber);
}
