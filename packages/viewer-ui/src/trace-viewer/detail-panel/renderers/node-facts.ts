/**
 * node-facts — the fact rows call and decision bodies share, read from the
 * attributes viewer-core puts on model-node rows (toNodeSpan): model routing,
 * attempts, tokens and cost. Pure.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { readNumericAttr, readStringAttr } from "../../span-style";
import { formatCost, formatTokens } from "../../usage-summary";

export type FactRow = { key: string; label: string; value: string };

/** One row, or none when the value is missing. */
export function factRow(key: string, label: string, value: string | undefined): FactRow[] {
	return value === undefined || value === "" ? [] : [{ key, label, value }];
}

/** "1,204 in · 88 out", or undefined when the row carries no token counts. */
export function tokenSummary(span: TraceSpan): string | undefined {
	const input = readNumericAttr(span, "input_tokens");
	const output = readNumericAttr(span, "output_tokens");
	if (input === undefined && output === undefined) return undefined;
	return `${formatTokens(input ?? 0)} in · ${formatTokens(output ?? 0)} out`;
}

export function costSummary(span: TraceSpan): string | undefined {
	const cost = readNumericAttr(span, "cost_estimate");
	return cost === undefined ? undefined : formatCost(cost);
}

/**
 * Attempts: "2 (showing attempt 2)" on a node row that summarizes retries,
 * "1 of 2" on an attempt row, else the engine's own attempt count.
 */
export function attemptSummary(span: TraceSpan): string | undefined {
	const count = readNumericAttr(span, "attempt_count");
	const selected = readNumericAttr(span, "selected_attempt");
	const number = readNumericAttr(span, "attempt_number");
	if (count !== undefined && selected !== undefined) {
		return `${count} (showing attempt ${selected})`;
	}
	if (count !== undefined && number !== undefined) return `${number} of ${count}`;
	const engineAttempts = readNumericAttr(span, "attempts");
	return engineAttempts === undefined ? undefined : String(engineAttempts);
}

/** The served model, plus the requested one (and its alias) when routing changed it. */
export function modelRows(span: TraceSpan): FactRow[] {
	const served = readStringAttr(span, "model");
	const requested = readStringAttr(span, "requested_model");
	const alias = readStringAttr(span, "model_alias");
	return [
		...factRow("model", "Model", served),
		...(requested && requested !== served ? factRow("requested_model", "Requested", requested) : []),
		...(alias && alias !== requested ? factRow("model_alias", "Alias", alias) : []),
	];
}

/** Tokens and cost rows, when the row carries usage. */
export function usageRows(span: TraceSpan): FactRow[] {
	return [
		...factRow("tokens", "Tokens", tokenSummary(span)),
		...factRow("cost", "Cost", costSummary(span)),
	];
}
