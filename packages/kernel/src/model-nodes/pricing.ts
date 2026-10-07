/**
 * Usage pricing and rollups for model nodes.
 *
 * Node usage is keyed by the served `provider/id`. A provider-reported cost
 * of 0 (Pi reports 0 for Jev) or no cost at all is "unknown", so the
 * kernel's price table fills it; an unknown model leaves costEstimate unset.
 */
import type { UsageDelta } from "@agent-kernel/db";
import type { TurnUsage } from "@agent-kernel/protocol";

import { applyPriceEstimate, type ModelPriceTable } from "../emitter";

/** Prefixes a bare served model id with its provider: ("typesafe", "jev-1.13.0") → "typesafe/jev-1.13.0". */
export function nodeModelRef(provider: string, model: string): string {
	return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

/**
 * Prices one node turn. `usage.model` is the served "provider/id". A
 * positive finite costEstimate is kept; 0, negative, NaN or missing is
 * replaced from `prices[usage.model]` when an entry exists.
 */
export function priceNodeUsage(usage: TurnUsage, prices: ModelPriceTable | undefined): TurnUsage {
	const { costEstimate, ...rest } = usage;
	if (costEstimate !== undefined && Number.isFinite(costEstimate) && costEstimate > 0) return usage;
	return applyPriceEstimate(rest, prices);
}

/**
 * Rolls priced turn usages into one TurnUsage for call_end (model = the last
 * turn's served model). costEstimate is the sum of known costs, unset when
 * no turn had one. Undefined for an empty list.
 */
export function sumNodeUsage(usages: readonly TurnUsage[]): TurnUsage | undefined {
	if (usages.length === 0) return undefined;
	let costEstimate: number | undefined;
	const total: TurnUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		model: usages[usages.length - 1]!.model,
	};
	for (const usage of usages) {
		total.inputTokens += usage.inputTokens;
		total.outputTokens += usage.outputTokens;
		total.cacheReadTokens += usage.cacheReadTokens;
		total.cacheWriteTokens += usage.cacheWriteTokens;
		if (usage.costEstimate !== undefined) costEstimate = (costEstimate ?? 0) + usage.costEstimate;
	}
	return costEstimate === undefined ? total : { ...total, costEstimate };
}

/** The usage rollup delta persisted with a node's completion (run, session, container). */
export function toUsageDelta(usage: TurnUsage | undefined): UsageDelta | null {
	if (!usage) return null;
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		...(usage.costEstimate !== undefined && { costEstimate: usage.costEstimate }),
	};
}
