/**
 * Thresholds (plan §4.3): engine answers → `Decision`s. Pure. Comparisons
 * use the wire values as reported (Jev rounds to two decimals); only the
 * choice margin, a difference of two wire values, gets a 1e-9 allowance so
 * float subtraction cannot turn an exact boundary into an abstain.
 */
import type { AbstainReason, ConfidenceSource, Decision, DecisionQuestion, EngineResult, ThresholdApplied } from "../types";
import { effectiveThresholds } from "./validate";

export const DEFAULT_THRESHOLDS: Readonly<Required<ThresholdApplied>> = {
	passAt: 0.85,
	failAt: 0.15,
	minTop: 0.6,
	minMargin: 0.2,
	abstainBelow: 0.5,
};

const MARGIN_EPSILON = 1e-9;

/**
 * One Decision per question. `!ok` → every answer abstains (`refusal` when
 * the engine error is a refusal, else `engine-error`); a missing or
 * malformed answer abstains `engine-error`; otherwise the question's
 * effective thresholds decide.
 */
export function applyThresholds(
	result: Pick<EngineResult, "ok" | "answers" | "error">,
	questions: Readonly<Record<string, DecisionQuestion>>,
	defaults: Required<ThresholdApplied>,
	malformed: ReadonlySet<string> = new Set(),
): Record<string, Decision> {
	const out: Record<string, Decision> = {};
	for (const [id, question] of Object.entries(questions)) {
		const answer = Object.hasOwn(result.answers, id) ? result.answers[id] : undefined;
		if (!result.ok) {
			out[id] = abstainedFor(question, result.error?.kind === "refusal" ? "refusal" : "engine-error");
		} else if (!answer || malformed.has(id)) {
			out[id] = abstainedFor(question, "engine-error");
		} else {
			const thresholds = effectiveThresholds(question, defaults);
			if (question.type === "bool") out[id] = boolDecision(answer.probability!, thresholds);
			else if (question.type === "choice") out[id] = choiceDecision(question, answer, thresholds);
			else out[id] = scoreDecision(answer, thresholds);
		}
	}
	return out;
}

function abstainedFor(question: DecisionQuestion, reason: AbstainReason): Decision {
	return { kind: question.type, confidenceSource: "none", abstained: true, abstainReason: reason, thresholdApplied: {} };
}

/**
 * The label follows the verdict (pass → "true", fail → "false"), so it can
 * never contradict it when a threshold sits on the far side of 0.5; an
 * abstained answer keeps the informational `p ≥ 0.5` label.
 */
function boolDecision(p: number, t: ThresholdApplied): Decision {
	const verdict = p >= t.passAt! ? "pass" : p <= t.failAt! ? "fail" : undefined;
	return {
		kind: "bool",
		choice: verdict ? (verdict === "pass" ? "true" : "false") : p >= 0.5 ? "true" : "false",
		probability: p,
		confidence: Math.max(p, 1 - p),
		confidenceSource: "native",
		...(verdict ? { verdict, abstained: false } : { abstained: true, abstainReason: "low-confidence" as const }),
		thresholdApplied: t,
	};
}

/**
 * Argmax recomputed from the distribution (declared labels missing from it
 * count as 0). Abstains `low-confidence` when the top probability is shared
 * (for every minMargin, 0 included), below minTop, or less than minMargin
 * above the runner-up.
 */
function choiceDecision(
	question: Extract<DecisionQuestion, { type: "choice" }>,
	answer: EngineResult["answers"][string],
	t: ThresholdApplied,
): Decision {
	const labels = Object.keys(question.criteria);
	const distribution: Record<string, number> = {};
	// defineProperty: a label named "__proto__" stays a label (assignment would set the prototype).
	for (const label of labels) {
		Object.defineProperty(distribution, label, {
			value: ownNumber(answer.distribution, label) ?? 0,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	const top = Math.max(...labels.map((label) => distribution[label]!));
	const leaders = labels.filter((label) => distribution[label] === top);
	const second = Math.max(0, ...labels.filter((label) => distribution[label] !== top).map((label) => distribution[label]!));
	const tie = leaders.length > 1;
	const runnerUp = tie ? top : second;
	const ok = !tie && top >= t.minTop! && top - runnerUp >= t.minMargin! - MARGIN_EPSILON;
	const choice = answer.choice !== undefined && leaders.includes(answer.choice) ? answer.choice : leaders[0]!;
	return {
		kind: "choice",
		choice,
		distribution,
		...(answer.confidence !== undefined && { confidence: answer.confidence }),
		confidenceSource: "native",
		...(ok ? { abstained: false } : { abstained: true, abstainReason: "low-confidence" as const }),
		thresholdApplied: t,
	};
}

function scoreDecision(answer: EngineResult["answers"][string], t: ThresholdApplied): Decision {
	const ok = answer.confidence! >= t.abstainBelow!;
	return {
		kind: "score",
		score: answer.score!,
		...(answer.distribution !== undefined && { distribution: answer.distribution }),
		confidence: answer.confidence!,
		confidenceSource: "native",
		...(ok ? { abstained: false } : { abstained: true, abstainReason: "low-confidence" as const }),
		thresholdApplied: t,
	};
}

/** An own numeric entry: a label named like an Object.prototype member never reads the prototype. */
export function ownNumber(record: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
	return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

const SEVERITY: Record<AbstainReason, number> = { "low-confidence": 1, refusal: 2, "engine-error": 3 };

/** Most severe reason across answers: engine-error > refusal > low-confidence. */
export function mostSevereReason(decisions: Iterable<Decision>): AbstainReason | undefined {
	let worst: AbstainReason | undefined;
	for (const d of decisions) {
		if (d.abstainReason && (!worst || SEVERITY[d.abstainReason] > SEVERITY[worst])) worst = d.abstainReason;
	}
	return worst;
}

/** "native" when any answer carries a native confidence, else "none". */
export function outcomeConfidenceSource(decisions: Iterable<Decision>): ConfidenceSource {
	let source: ConfidenceSource = "none";
	for (const d of decisions) {
		if (d.confidenceSource === "native") return "native";
		if (d.confidenceSource === "self-reported") source = "self-reported";
	}
	return source;
}

/**
 * Sole question: its label ("true"/"false", the choice, the score as a
 * string) or "abstain". Several: "qid=label" pairs sorted by qid, joined by ",".
 */
export function chosenLabel(decisions: Readonly<Record<string, Decision>>): string {
	const label = (d: Decision) => {
		if (d.abstained) return "abstain";
		if (d.kind === "score") return String(d.score);
		return d.choice ?? "abstain";
	};
	const ids = Object.keys(decisions).sort();
	if (ids.length === 1) return label(decisions[ids[0]!]!);
	return ids.map((id) => `${id}=${label(decisions[id]!)}`).join(",");
}
