/**
 * node-display — what a model-node row shows in the tree (plan §4.9, §7.5):
 * the kind badge, the title, a result chip, a duration chip, and the attempt
 * labels of retried nodes. Pure: it reads the attributes viewer-core puts on
 * node rows (model-nodes.ts / toNodeSpan) and on step and gate spans
 * (spanAttributes.ts), so the tree and its tests share one reading.
 *
 *   call      node row or attempt row: `ok`, `error · parse`, `aborted`
 *   decision  node row or attempt row: `pass p=0.91`, `continue p=0.71`, `abstain`
 *   step      the first output-summary value (`objdiff 100`), else the check result
 *   gate      the verdict (`pass`, `fail`, `abstain`)
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import type { NodeDisplayType } from "../icons";
import {
	formatDurationMs,
	nodeDisplayTypeOf,
	readBoolAttr,
	readNumericAttr,
	readStringAttr,
} from "../span-style";

/** The chip treatment; status decides it, so a chip agrees with its row's frame. */
export type NodeChipTone = "success" | "danger" | "warning" | "neutral";

export type NodeKindBadge = "CALL" | "DECIDE" | "STEP" | "GATE";

export interface NodeSpanDisplay {
	type: NodeDisplayType;
	badge: NodeKindBadge;
	/**
	 * The name the row shows. An attempt row reads `attempt n`, plus why it
	 * failed when it did (`attempt 1 · 503`, `attempt 1 · abandoned`).
	 */
	title: string;
	/** The full name for the row's tooltip (an attempt row adds `of m` and the error). */
	tooltip: string;
	result: { label: string; tone: NodeChipTone } | null;
	/** Formatted duration ("110 ms", "1.8 s"), or null while the node runs. */
	duration: string | null;
	/** Attempt count on a node row that summarizes several attempts (the `×m` chip). */
	attempts: number | null;
}

const BADGE: Record<NodeDisplayType, NodeKindBadge> = {
	call: "CALL",
	decision: "DECIDE",
	step: "STEP",
	gate: "GATE",
};

const ATTEMPT_EVENT_TYPES = new Set(["call_attempt", "decision_attempt"]);
const NODE_ROW_EVENT_TYPES = new Set(["call_container", "decision_container"]);

export function toneOf(status: TraceSpan["status"]): NodeChipTone {
	if (status === "error") return "danger";
	if (status === "warning") return "warning";
	if (status === "success") return "success";
	return "neutral";
}

/** A probability on the chip and the bars: two decimals, as the wire carries it. */
export function formatProbability(p: number): string {
	return p.toFixed(2);
}

/** The decision_made answers a decision row carries as its output, or null. */
interface DecisionAnswer {
	kind?: string;
	choice?: string;
	probability?: number;
	score?: number;
	distribution?: Record<string, number>;
	confidence?: number;
	verdict?: "pass" | "fail";
	abstained?: boolean;
}

function parseAnswers(output: string | undefined): Record<string, DecisionAnswer> | null {
	if (!output) return null;
	try {
		const parsed = JSON.parse(output) as { answers?: unknown };
		const answers = parsed?.answers;
		return answers && typeof answers === "object" && !Array.isArray(answers)
			? (answers as Record<string, DecisionAnswer>)
			: null;
	} catch {
		return null;
	}
}

/**
 * A decision's chip, kept short so the row's name keeps its width: `abstain`
 * when it abstained; for its sole question, the verdict with p(true) for a
 * judged bool (`pass p=0.91`), the label with its probability for a choice,
 * the score for a score; else the chosen label.
 */
export function decisionResultLabel(span: TraceSpan): string | null {
	if (readBoolAttr(span, "abstained") === true) return "abstain";
	const chosen = readStringAttr(span, "chosen");
	const answers = parseAnswers(span.output);
	const ids = answers ? Object.keys(answers) : [];
	if (!answers || ids.length !== 1) return chosen ?? null;

	const answer = answers[ids[0]!]!;
	if (answer.abstained) return "abstain";
	if (answer.kind === "bool" && typeof answer.probability === "number") {
		const p = formatProbability(answer.probability);
		return `${answer.verdict ?? answer.choice ?? chosen ?? "true"} p=${p}`;
	}
	if (answer.kind === "choice" && answer.choice) {
		const p = answer.distribution?.[answer.choice] ?? answer.confidence;
		return typeof p === "number" ? `${answer.choice} p=${formatProbability(p)}` : answer.choice;
	}
	if (answer.kind === "score" && typeof answer.score === "number") {
		return `score ${answer.score}`;
	}
	return chosen ?? null;
}

function callResultLabel(span: TraceSpan): string | null {
	const status = readStringAttr(span, "status");
	if (status === "error") {
		const kind = readStringAttr(span, "error_kind");
		return kind ? `error · ${kind}` : "error";
	}
	return status ?? null;
}

function summaryValue(value: unknown): string {
	if (value === null || typeof value !== "object") return String(value);
	return JSON.stringify(value);
}

/** A step's first output-summary value, `key value` for an object summary. */
export function stepResultLabel(span: TraceSpan): string | null {
	if (readStringAttr(span, "status") === "error") return "error";
	if (span.output) {
		try {
			const summary = JSON.parse(span.output) as unknown;
			if (summary !== null && typeof summary === "object" && !Array.isArray(summary)) {
				const first = Object.entries(summary)[0];
				if (first) return `${first[0]} ${summaryValue(first[1])}`;
			} else if (summary !== null && summary !== undefined) {
				return summaryValue(summary);
			}
		} catch {
			return span.output;
		}
	}
	return readStringAttr(span, "check_result") ?? readStringAttr(span, "status") ?? null;
}

function gateResultLabel(span: TraceSpan): string | null {
	const verdict = readStringAttr(span, "verdict");
	if (!verdict) return null;
	return readBoolAttr(span, "aborted") === true ? `${verdict} · aborted` : verdict;
}

function resultLabel(type: NodeDisplayType, span: TraceSpan): string | null {
	switch (type) {
		case "call":
			return callResultLabel(span);
		case "decision":
			return decisionResultLabel(span);
		case "step":
			return stepResultLabel(span);
		case "gate":
			return gateResultLabel(span);
	}
}

function durationOf(span: TraceSpan): string | null {
	if (span.status === "pending") return null;
	const ms = readNumericAttr(span, "duration_ms") ?? span.duration;
	return Number.isFinite(ms) && ms >= 0 ? formatDurationMs(ms) : null;
}

/**
 * Why an attempt failed (call_end status error or aborted), in a word: its
 * HTTP status, else its error kind, else that status. An attempt that ran to
 * an answer, abstain included, has none.
 */
function attemptFailure(span: TraceSpan): string | undefined {
	const status = readStringAttr(span, "status");
	if (status !== "error" && status !== "aborted") return undefined;
	const http = readNumericAttr(span, "http_status");
	return http !== undefined ? String(http) : (readStringAttr(span, "error_kind") ?? status);
}

function attemptLabels(span: TraceSpan): { title: string; tooltip: string } | null {
	const number = readNumericAttr(span, "attempt_number");
	if (number === undefined) return null;
	const count = readNumericAttr(span, "attempt_count");
	const failure = attemptFailure(span);
	const detail = [readStringAttr(span, "error_kind"), readStringAttr(span, "error_message")].filter(Boolean);
	return {
		title: failure ? `attempt ${number} · ${failure}` : `attempt ${number}`,
		tooltip: [count === undefined ? `attempt ${number}` : `attempt ${number} of ${count}`, ...detail].join(" · "),
	};
}

/** The tree row for a model-node span, or null for every other span. */
export function getNodeSpanDisplay(span: TraceSpan): NodeSpanDisplay | null {
	const eventType = readStringAttr(span, "event_type");
	const type = nodeDisplayTypeOf(eventType);
	if (!type || !eventType) return null;

	const attemptCount = readNumericAttr(span, "attempt_count");
	const attempt = ATTEMPT_EVENT_TYPES.has(eventType) ? attemptLabels(span) : null;

	const label = resultLabel(type, span);
	return {
		type,
		badge: BADGE[type],
		title: attempt?.title ?? span.title,
		tooltip: attempt?.tooltip ?? span.title,
		result: label ? { label, tone: toneOf(span.status) } : null,
		duration: durationOf(span),
		attempts:
			NODE_ROW_EVENT_TYPES.has(eventType) && attemptCount !== undefined && attemptCount > 1
				? attemptCount
				: null,
	};
}
