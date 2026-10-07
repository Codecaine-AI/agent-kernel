/**
 * Decision token budget (plan §4.3). The estimate is deliberately
 * conservative for code: R3 measured ~1.57 UTF-8 bytes per token at the
 * TypeSafe limit, so dividing by 1.5 over-counts. Over budget, the kernel
 * sends nothing and every answer abstains `engine-error` (`too-large`).
 */
import type { ClassifierQuestion } from "@earendil-works/pi-ai";

export const DEFAULT_TOKEN_BUDGETS: Readonly<Record<string, number>> = {
	"typesafe/*": 32_000,
	"openrouter/*": 32_000,
	"opencode/*": 32_000,
	"openai/*": 500_000,
};

/** `Math.ceil(utf8Bytes(s) / 1.5)`. */
export function estimateTokens(s: string): number {
	return Math.ceil(Buffer.byteLength(s, "utf8") / 1.5);
}

/** estimate(JSON(state)) + the largest estimate(JSON(question)). */
export function estimateDecisionTokens(stateJson: string, questions: Record<string, ClassifierQuestion>): number {
	let largest = 0;
	for (const question of Object.values(questions)) {
		largest = Math.max(largest, estimateTokens(JSON.stringify(question)));
	}
	return estimateTokens(stateJson) + largest;
}

/** Budget for "provider/id": exact key, then "provider/*"; undefined means no limit. */
export function budgetFor(modelRef: string, budgets: Readonly<Record<string, number>>): number | undefined {
	const exact = budgets[modelRef];
	if (exact !== undefined) return exact;
	const slash = modelRef.indexOf("/");
	if (slash <= 0) return undefined;
	return budgets[`${modelRef.slice(0, slash)}/*`];
}
