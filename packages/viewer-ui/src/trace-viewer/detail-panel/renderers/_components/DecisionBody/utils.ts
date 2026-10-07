/**
 * DecisionBody utils — pure readers over a decision row: its decision_made
 * payload (the row's output, viewer-core toNodeSpan) and its attributes.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	formatDurationMs,
	readBoolAttr,
	readNumericAttr,
	readStringAttr,
} from "../../../../span-style";
import {
	attemptSummary,
	factRow,
	modelRows,
	usageRows,
	type FactRow,
} from "../../node-facts";
import type { BarAnswer, BarThreshold } from "./_components/ProbabilityBars";

/** decision_made, as the row's output carries it (snake_case payload, camelCase answers). */
export interface DecisionPayload {
	decision_name?: string;
	answers: Record<string, BarAnswer>;
	chosen?: string;
	confidence_source?: string;
	abstained: boolean;
	abstain_reason?: string;
	threshold_applied: Record<string, BarThreshold>;
	engine?: string;
	provider?: string;
	api?: string;
	model?: string;
	requested_model?: string;
	error_kind?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The decision_made payload, or null when the row carries none (still running, no outcome). */
export function parseDecision(span: TraceSpan): DecisionPayload | null {
	if (!span.output) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(span.output);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !isRecord(parsed.answers)) return null;
	return {
		...(parsed as Partial<DecisionPayload>),
		answers: parsed.answers as Record<string, BarAnswer>,
		abstained: parsed.abstained === true,
		threshold_applied: isRecord(parsed.threshold_applied)
			? (parsed.threshold_applied as Record<string, BarThreshold>)
			: {},
	};
}

/** "jev-1.13.0" from "typesafe/jev-1.13.0": the model id without its provider. */
export function modelId(ref: string): string {
	const slash = ref.indexOf("/");
	return slash >= 0 ? ref.slice(slash + 1) : ref;
}

export interface DecisionBadgeSet {
	/** native | self-reported | none. */
	confidenceSource: string | null;
	/** "jev · jev-1.13.0": the engine and the served model. */
	engineModel: string | null;
	/** The requested model, only when it differs from the served one. */
	requested: string | null;
}

export function decisionBadges(span: TraceSpan, decision: DecisionPayload | null): DecisionBadgeSet {
	const engine = decision?.engine ?? readStringAttr(span, "engine");
	const served = decision?.model ?? readStringAttr(span, "model");
	const requested = decision?.requested_model ?? readStringAttr(span, "requested_model");
	const parts = [engine, served ? modelId(served) : undefined].filter(Boolean);
	return {
		confidenceSource: decision?.confidence_source ?? readStringAttr(span, "confidence_source") ?? null,
		engineModel: parts.length > 0 ? parts.join(" · ") : null,
		requested: requested && requested !== served ? requested : null,
	};
}

export interface AbstainFacts {
	/** low-confidence | refusal | engine-error. */
	reason: string;
	/** The engine's error kind, e.g. "malformed-answer", "http", "too-large". */
	errorKind: string | null;
	/** Per question: its own abstain reason. */
	questions: Array<{ id: string; reason: string }>;
}

/** Why a decision abstained, or null when it answered. */
export function abstainFacts(span: TraceSpan, decision: DecisionPayload | null): AbstainFacts | null {
	const abstained = decision?.abstained ?? readBoolAttr(span, "abstained") ?? false;
	if (!abstained) return null;
	const questions = Object.entries(decision?.answers ?? {}).flatMap(([id, answer]) =>
		answer.abstained ? [{ id, reason: answer.abstainReason ?? "abstain" }] : [],
	);
	return {
		reason: decision?.abstain_reason ?? readStringAttr(span, "abstain_reason") ?? "abstain",
		errorKind: decision?.error_kind ?? readStringAttr(span, "error_kind") ?? null,
		questions,
	};
}

/** "pass ≥ 0.85 · fail ≤ 0.15", "floor 0.50 · margin 0.10", "abstain below 0.40". */
export function thresholdLabel(threshold: BarThreshold): string | undefined {
	const parts: string[] = [];
	const p = (value: number) => value.toFixed(2);
	if (threshold.passAt !== undefined) parts.push(`pass ≥ ${p(threshold.passAt)}`);
	if (threshold.failAt !== undefined) parts.push(`fail ≤ ${p(threshold.failAt)}`);
	if (threshold.minTop !== undefined) parts.push(`floor ${p(threshold.minTop)}`);
	if (threshold.minMargin !== undefined) parts.push(`margin ${p(threshold.minMargin)}`);
	if (threshold.abstainBelow !== undefined) parts.push(`abstain below ${p(threshold.abstainBelow)}`);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The decision's facts table: what it chose, against which thresholds, on which model, at what cost. */
export function decisionMetaRows(span: TraceSpan, decision: DecisionPayload | null): FactRow[] {
	const duration = readNumericAttr(span, "duration_ms");
	const route = [decision?.provider ?? readStringAttr(span, "provider"), decision?.api ?? readStringAttr(span, "api")]
		.filter(Boolean)
		.join(" · ");
	const thresholds = Object.entries(decision?.threshold_applied ?? {}).flatMap(([id, threshold]) =>
		factRow(`threshold:${id}`, `Threshold · ${id}`, thresholdLabel(threshold)),
	);
	return [
		...factRow("decision_name", "Decision", decision?.decision_name ?? readStringAttr(span, "function_name")),
		...factRow("chosen", "Chosen", decision?.chosen ?? readStringAttr(span, "chosen")),
		...thresholds,
		...factRow("engine", "Engine", decision?.engine ?? readStringAttr(span, "engine")),
		...modelRows(span),
		...factRow("route", "Route", route || undefined),
		...factRow(
			"confidence_source",
			"Confidence",
			decision?.confidence_source ?? readStringAttr(span, "confidence_source"),
		),
		...factRow("prompt_hash", "Prompt hash", readStringAttr(span, "prompt_hash")),
		...factRow("status", "Status", readStringAttr(span, "status")),
		...factRow("attempts", "Attempts", attemptSummary(span)),
		...factRow("duration", "Duration", duration === undefined ? undefined : formatDurationMs(duration)),
		...usageRows(span),
		...factRow("trigger", "Trigger", readStringAttr(span, "trigger")),
		...factRow("run_id", "Run", readStringAttr(span, "run_id")),
	];
}
