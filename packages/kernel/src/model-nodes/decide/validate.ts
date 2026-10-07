/**
 * Decision request and config validation (plan §4.3). Every rule runs and
 * every issue is listed; callers throw KernelDecideValidationError before
 * any row is written. Issues name question ids and fields, never
 * instruction or state text.
 */
import type { JsonObject as PiJsonObject } from "@earendil-works/pi-ai";

import type { DecisionQuestion, DecisionState, KernelDecideConfig, ThresholdApplied } from "../types";

export const QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_INSTRUCTIONS_CHARS = 4_000;
export const MAX_STATE_BYTES = 2 * 1024 * 1024;
export const MIN_CHOICE_LABELS = 2;
export const MAX_CHOICE_LABELS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

type ThresholdField = keyof ThresholdApplied;

/** The threshold fields each question type may carry. */
export const THRESHOLD_FIELDS: Record<DecisionQuestion["type"], readonly ThresholdField[]> = {
	bool: ["passAt", "failAt"],
	choice: ["minTop", "minMargin"],
	score: ["abstainBelow"],
};
const ALL_THRESHOLD_FIELDS: readonly ThresholdField[] = ["passAt", "failAt", "minTop", "minMargin", "abstainBelow"];

/** The question's own threshold fields, its overrides merged over `defaults`. */
export function effectiveThresholds(q: DecisionQuestion, defaults: Required<ThresholdApplied>): ThresholdApplied {
	switch (q.type) {
		case "bool":
			return { passAt: q.passAt ?? defaults.passAt, failAt: q.failAt ?? defaults.failAt };
		case "choice":
			return { minTop: q.minTop ?? defaults.minTop, minMargin: q.minMargin ?? defaults.minMargin };
		case "score":
			return { abstainBelow: q.abstainBelow ?? defaults.abstainBelow };
	}
}

/**
 * Range rules on an effective threshold set: `0 ≤ failAt < passAt ≤ 1`,
 * `0 < minTop ≤ 1`, `0 ≤ minMargin < 1`, `0 ≤ abstainBelow ≤ 1`. Only the
 * fields present are checked.
 */
export function thresholdIssues(t: ThresholdApplied, label: string): string[] {
	const issues: string[] = [];
	for (const field of ALL_THRESHOLD_FIELDS) {
		const value = t[field];
		if (value !== undefined && !isFiniteNumber(value)) issues.push(`${label}: ${field} must be a finite number`);
	}
	const { passAt, failAt, minTop, minMargin, abstainBelow } = t;
	if (isFiniteNumber(passAt) && isFiniteNumber(failAt) && !(0 <= failAt && failAt < passAt && passAt <= 1)) {
		issues.push(`${label}: requires 0 ≤ failAt < passAt ≤ 1 (failAt ${failAt}, passAt ${passAt})`);
	}
	if (isFiniteNumber(minTop) && !(minTop > 0 && minTop <= 1)) issues.push(`${label}: requires 0 < minTop ≤ 1`);
	if (isFiniteNumber(minMargin) && !(minMargin >= 0 && minMargin < 1)) {
		issues.push(`${label}: requires 0 ≤ minMargin < 1`);
	}
	if (isFiniteNumber(abstainBelow) && !(abstainBelow >= 0 && abstainBelow <= 1)) {
		issues.push(`${label}: requires 0 ≤ abstainBelow ≤ 1`);
	}
	return issues;
}

/**
 * Every issue with a question set, thresholds checked after merging each
 * question's overrides with `defaults` (round 2 A2-F4).
 */
export function questionIssues(questions: unknown, defaults: Required<ThresholdApplied>): string[] {
	if (!isPlainObject(questions)) return ["questions must be an object of question id → question"];
	const entries = Object.entries(questions);
	if (entries.length === 0) return ["at least one question is required"];
	const issues: string[] = [];
	for (const [id, raw] of entries) {
		const label = `question ${JSON.stringify(id)}`;
		if (!QUESTION_ID_PATTERN.test(id)) issues.push(`${label}: id must match ${QUESTION_ID_PATTERN}`);
		if (!isPlainObject(raw)) {
			issues.push(`${label}: must be an object`);
			continue;
		}
		const type = raw.type;
		if (type !== "bool" && type !== "choice" && type !== "score") {
			issues.push(`${label}: type must be "bool", "choice" or "score"`);
			continue;
		}
		const instructions = raw.instructions;
		if (typeof instructions !== "string" || instructions.trim().length === 0) {
			issues.push(`${label}: instructions must be a non-empty string`);
		} else if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
			issues.push(`${label}: instructions exceed ${MAX_INSTRUCTIONS_CHARS} characters`);
		}
		issues.push(...criteriaIssues(type, raw.criteria, label));

		const allowed = THRESHOLD_FIELDS[type];
		let thresholdsTyped = true;
		for (const field of ALL_THRESHOLD_FIELDS) {
			if (raw[field] === undefined) continue;
			if (!allowed.includes(field)) {
				issues.push(`${label}: ${field} is not allowed on a ${type} question`);
				thresholdsTyped = false;
			} else if (!isFiniteNumber(raw[field])) {
				issues.push(`${label}: ${field} must be a finite number`);
				thresholdsTyped = false;
			}
		}
		if (thresholdsTyped) {
			issues.push(...thresholdIssues(effectiveThresholds(raw as unknown as DecisionQuestion, defaults), label));
		}
	}
	return issues;
}

function criteriaIssues(type: DecisionQuestion["type"], criteria: unknown, label: string): string[] {
	if (type === "bool") {
		if (!isPlainObject(criteria)) return [`${label}: bool criteria must be { true, false }`];
		const issues: string[] = [];
		for (const key of ["true", "false"] as const) {
			if (!isNonEmptyString(criteria[key])) issues.push(`${label}: criteria.${key} must be a non-empty string`);
		}
		return issues;
	}
	if (type === "choice") {
		if (!isPlainObject(criteria)) return [`${label}: choice criteria must be an object of label → description`];
		const labels = Object.keys(criteria);
		const issues: string[] = [];
		if (labels.length < MIN_CHOICE_LABELS || labels.length > MAX_CHOICE_LABELS) {
			issues.push(`${label}: choice needs ${MIN_CHOICE_LABELS}–${MAX_CHOICE_LABELS} labels (got ${labels.length})`);
		}
		const seen = new Set<string>();
		for (const choice of labels) {
			if (choice.trim().length === 0) issues.push(`${label}: choice labels must be non-empty`);
			else if (seen.has(choice.trim())) issues.push(`${label}: choice label ${JSON.stringify(choice)} is not unique`);
			seen.add(choice.trim());
			if (!isNonEmptyString(criteria[choice])) {
				issues.push(`${label}: description of label ${JSON.stringify(choice)} must be a non-empty string`);
			}
		}
		return issues;
	}
	if (!Array.isArray(criteria)) return [`${label}: score criteria must be an array of level descriptions`];
	const issues: string[] = [];
	if (criteria.length < MIN_SCORE_LEVELS || criteria.length > MAX_SCORE_LEVELS) {
		issues.push(`${label}: score needs ${MIN_SCORE_LEVELS}–${MAX_SCORE_LEVELS} levels (got ${criteria.length})`);
	}
	criteria.forEach((level, i) => {
		if (!isNonEmptyString(level)) issues.push(`${label}: score level ${i} must be a non-empty string`);
	});
	return issues;
}

export type StateCheck = { ok: true; state: PiJsonObject; json: string } | { ok: false; issues: string[] };

/** A plain JSON object, or a string wrapped as `{ text }`; serialized size ≤ 2 MB. */
export function checkState(state: DecisionState): StateCheck {
	const wrapped: unknown = typeof state === "string" ? { text: state } : state;
	if (!isPlainObject(wrapped)) return { ok: false, issues: ["state must be a plain JSON object or a string"] };
	let json: string;
	try {
		json = JSON.stringify(wrapped);
	} catch {
		return { ok: false, issues: ["state must be JSON-serializable"] };
	}
	const bytes = Buffer.byteLength(json, "utf8");
	if (bytes > MAX_STATE_BYTES) {
		return { ok: false, issues: [`state is ${bytes} bytes serialized; the limit is ${MAX_STATE_BYTES}`] };
	}
	return { ok: true, state: wrapped as PiJsonObject, json };
}

/** Per-call engine options: `timeoutMs` > 0 and finite, `maxRetries` a non-negative integer. */
export function callOptionIssues(opts: { timeoutMs?: unknown; maxRetries?: unknown }): string[] {
	const issues: string[] = [];
	if (opts.timeoutMs !== undefined && !isPositiveFinite(opts.timeoutMs)) {
		issues.push("timeoutMs must be a finite number > 0");
	}
	if (opts.maxRetries !== undefined && !isNonNegativeInteger(opts.maxRetries)) {
		issues.push("maxRetries must be a non-negative integer");
	}
	return issues;
}

/**
 * `config.decide` issues, checked once by createKernel: complete and
 * ordered default thresholds, wire precision in (0, 1], positive token
 * budgets, and sane timeouts and retries.
 */
export function decideConfigIssues(config: KernelDecideConfig | undefined): string[] {
	if (!config) return [];
	const issues: string[] = [];
	if (config.engine !== undefined && typeof config.engine?.classify !== "function") {
		issues.push("config.decide.engine must implement classify()");
	}
	if (config.defaults !== undefined) {
		if (!isPlainObject(config.defaults)) {
			issues.push("config.decide.defaults must be an object");
		} else {
			for (const field of ALL_THRESHOLD_FIELDS) {
				if (config.defaults[field] === undefined) issues.push(`config.decide.defaults: ${field} is required`);
			}
			issues.push(...thresholdIssues(config.defaults, "config.decide.defaults"));
		}
	}
	for (const [api, step] of Object.entries(config.wirePrecision ?? {})) {
		if (!(isFiniteNumber(step) && step > 0 && step <= 1)) {
			issues.push(`config.decide.wirePrecision[${JSON.stringify(api)}] must be finite, > 0 and ≤ 1`);
		}
	}
	for (const [ref, budget] of Object.entries(config.tokenBudgets ?? {})) {
		if (!(typeof budget === "number" && budget > 0)) {
			issues.push(`config.decide.tokenBudgets[${JSON.stringify(ref)}] must be a number > 0`);
		}
	}
	issues.push(...callOptionIssues(config).map((issue) => `config.decide.${issue}`));
	if (config.maxRetryDelayMs !== undefined && !isPositiveFinite(config.maxRetryDelayMs)) {
		issues.push("config.decide.maxRetryDelayMs must be a finite number > 0");
	}
	return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
