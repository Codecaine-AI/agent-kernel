/**
 * ProbabilityBars utils — one decision question as bar rows with threshold
 * markers (plan §7.5: bars per option, the threshold or floor line at the
 * right position). Pure.
 *
 *   bool    one `true` row, p(true), with the passAt and failAt markers
 *   choice  one row per label of the distribution, the argmax chosen, with
 *           the minTop floor marker on every row
 *   score   one row per level of the distribution, then a `confidence` row
 *           with the abstainBelow marker
 *
 * Widths and marker positions are percentages clamped to [0, 100], so a
 * malformed probability can never draw outside its track.
 */

export type BarMarkerKind = "pass" | "fail" | "floor";

export interface BarMarker {
	kind: BarMarkerKind;
	/** "pass ≥ 0.85", "fail ≤ 0.15", "floor 0.50". */
	label: string;
	positionPct: number;
}

export interface BarRow {
	label: string;
	/** The probability as the wire carried it, or null when it was missing. */
	value: number | null;
	widthPct: number;
	/** The label the decision chose (drawn solid; the others lighter). */
	chosen: boolean;
	markers: BarMarker[];
}

export interface BarQuestion {
	id: string;
	kind: string;
	rows: BarRow[];
	/** "pass", "fail", the chosen label, the score, or "abstain · <reason>". */
	outcome: string;
	abstained: boolean;
	/** No probability to draw (engine error, refusal): the bars say so instead. */
	empty: boolean;
}

/** The answer fields the bars read (protocol Decision, loosely typed: it comes from JSON). */
export interface BarAnswer {
	kind?: string;
	choice?: string;
	probability?: number;
	score?: number;
	distribution?: Record<string, number>;
	confidence?: number;
	verdict?: "pass" | "fail";
	abstained?: boolean;
	abstainReason?: string;
}

export interface BarThreshold {
	passAt?: number;
	failAt?: number;
	minTop?: number;
	minMargin?: number;
	abstainBelow?: number;
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** A probability as a percentage of the track, clamped to [0, 100], to 0.01 %. */
export function clampPct(probability: number | null | undefined): number {
	if (!isNumber(probability)) return 0;
	return Math.min(100, Math.max(0, Math.round(probability * 10_000) / 100));
}

export function formatP(p: number): string {
	return p.toFixed(2);
}

function marker(kind: BarMarkerKind, label: string, at: number | undefined): BarMarker[] {
	return isNumber(at) ? [{ kind, label: `${label} ${formatP(at)}`, positionPct: clampPct(at) }] : [];
}

function barRow(label: string, value: unknown, chosen: boolean, markers: BarMarker[]): BarRow {
	const p = isNumber(value) ? value : null;
	return { label, value: p, widthPct: clampPct(p), chosen, markers };
}

function outcomeOf(answer: BarAnswer): string {
	if (answer.abstained) {
		return answer.abstainReason ? `abstain · ${answer.abstainReason}` : "abstain";
	}
	if (answer.kind === "bool") return answer.verdict ?? answer.choice ?? "answered";
	if (answer.kind === "score") return isNumber(answer.score) ? `score ${answer.score}` : "answered";
	return answer.choice ?? "answered";
}

/** One question's bars from its answer and the thresholds it was judged against. */
export function questionBars(id: string, answer: BarAnswer, threshold: BarThreshold = {}): BarQuestion {
	const kind = answer.kind ?? "bool";
	let rows: BarRow[] = [];
	if (kind === "bool") {
		if (isNumber(answer.probability)) {
			rows = [
				barRow("true", answer.probability, true, [
					...marker("pass", "pass ≥", threshold.passAt),
					...marker("fail", "fail ≤", threshold.failAt),
				]),
			];
		}
	} else {
		const floor = kind === "choice" ? marker("floor", "floor", threshold.minTop) : [];
		rows = Object.entries(answer.distribution ?? {}).map(([label, p]) =>
			barRow(label, p, !answer.abstained && label === answer.choice, floor),
		);
		if (kind === "score" && isNumber(answer.confidence)) {
			rows.push(
				barRow("confidence", answer.confidence, false, marker("floor", "abstain below", threshold.abstainBelow)),
			);
		}
	}
	return {
		id,
		kind,
		rows,
		outcome: outcomeOf(answer),
		abstained: answer.abstained === true,
		empty: rows.length === 0,
	};
}

/** A gate's decide check question (GateCheckRecord.questions[i]) as a bool bar. */
export function gateQuestionBars(question: {
	question_id: string;
	result: string;
	run_id?: string;
	probability?: number;
	pass_at?: number;
	fail_at?: number;
	abstain_reason?: string;
}): BarQuestion {
	return questionBars(
		question.question_id,
		{
			kind: "bool",
			probability: question.probability,
			abstained: question.result === "abstain",
			abstainReason: question.abstain_reason,
			verdict: question.result === "pass" || question.result === "fail" ? question.result : undefined,
		},
		{ passAt: question.pass_at, failAt: question.fail_at },
	);
}
