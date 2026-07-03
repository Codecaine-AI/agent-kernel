/**
 * Usage rollup write path for one run (Phase 2).
 *
 * Per pi_turn_end with usage the run row is incremented; when the run closes
 * the run totals are folded into the session and container rows exactly once.
 * Writes are chained so increments land in order and finalize() never races
 * an in-flight turn increment.
 */
import {
	incrementContainerUsage,
	incrementSessionUsage,
	updateRunUsage,
	type KernelDatabase,
	type UsageDelta,
} from "@agent-kernel/db";
import type { TurnUsage } from "@agent-kernel/protocol";

export interface RunUsageRecorderIdentity {
	runId: string;
	piSessionUuid: string;
	containerId: string;
}

export interface RunUsageRecorderLoggerLike {
	warn(message: string, data?: Record<string, unknown>): void;
}

export interface RunUsageRecorder {
	/** Increment the run row for one turn's usage. */
	recordTurn(usage: TurnUsage): void;
	/**
	 * Fold the run's accumulated totals into the session and container rows.
	 * Idempotent — the fold happens at most once per recorder.
	 */
	finalize(): Promise<void>;
}

export function createRunUsageRecorder(
	db: KernelDatabase,
	identity: RunUsageRecorderIdentity,
	logger?: RunUsageRecorderLoggerLike,
): RunUsageRecorder {
	let chain: Promise<void> = Promise.resolve();
	let finalized = false;
	const totals: UsageDelta = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};

	function enqueue(work: () => Promise<void>, label: string): void {
		chain = chain
			.then(work)
			.catch((e) =>
				logger?.warn(`${label} failed`, {
					runId: identity.runId,
					error: (e as Error).message,
				}),
			);
	}

	return {
		recordTurn(usage: TurnUsage): void {
			if (finalized) return;
			totals.inputTokens += usage.inputTokens;
			totals.outputTokens += usage.outputTokens;
			totals.cacheReadTokens += usage.cacheReadTokens;
			totals.cacheWriteTokens += usage.cacheWriteTokens;
			if (usage.costEstimate !== undefined) {
				totals.costEstimate = (totals.costEstimate ?? 0) + usage.costEstimate;
			}
			const delta: UsageDelta = {
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheWriteTokens,
				...(usage.costEstimate !== undefined && { costEstimate: usage.costEstimate }),
			};
			enqueue(() => updateRunUsage(db, identity.runId, delta), "updateRunUsage");
		},

		async finalize(): Promise<void> {
			if (finalized) {
				await chain;
				return;
			}
			finalized = true;
			const hasUsage =
				totals.inputTokens > 0 ||
				totals.outputTokens > 0 ||
				totals.cacheReadTokens > 0 ||
				totals.cacheWriteTokens > 0 ||
				totals.costEstimate !== undefined;
			if (hasUsage) {
				enqueue(
					() =>
						incrementSessionUsage(db, identity.piSessionUuid, {
							inputTokens: totals.inputTokens,
							outputTokens: totals.outputTokens,
						}),
					"incrementSessionUsage",
				);
				enqueue(
					() => incrementContainerUsage(db, identity.containerId, totals),
					"incrementContainerUsage",
				);
			}
			await chain;
		},
	};
}
