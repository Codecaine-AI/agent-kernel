/**
 * usage-summary — pure rollup helpers behind the UsageSummaryPanel.
 *
 * These take the trace detail's runs/sessions/container and fold them into the
 * numbers the panel renders: a totals strip, a per-run table, and a per-agent
 * breakdown. Kept framework-free so the aggregation math is unit-testable
 * without a DOM.
 *
 * Cost policy: a run's cost only counts when it is a positive number. The trace
 * db stores `0` for rows written before pricing existed, so a zero (or null)
 * cost is treated as "no price" and rolls up to `null` — the panel renders that
 * as an em dash rather than "$0.00".
 */
import type {
	AgentRun,
	KernelContainerSummary,
	PiAgentSession,
} from "@agent-kernel/viewer-core";

export interface UsageTotals {
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	/** null when no run carried a positive cost. */
	cost: number | null;
	runCount: number;
	/** Container span in ms (started→ended), or null when not resolvable. */
	durationMs: number | null;
}

export interface RunUsageRow {
	id: string;
	agentName: string;
	trigger: string;
	status: string;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number | null;
	durationMs: number | null;
}

export interface AgentUsageRollup {
	agentName: string;
	runCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number | null;
}

export interface UsageSummary {
	totals: UsageTotals;
	runs: RunUsageRow[];
	byAgent: AgentUsageRollup[];
}

function n(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A cost only counts when it is a positive, finite number (see cost policy). */
function positiveCost(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: null;
}

/** Sum two optional costs, preserving "no price" (null) unless one side has a price. */
function addCost(a: number | null, b: number | null): number | null {
	if (a === null && b === null) return null;
	return n(a) + n(b);
}

/** Millisecond span between two ISO timestamps, or null when unresolvable. */
export function durationMs(
	start: string | null | undefined,
	end: string | null | undefined,
): number | null {
	if (!start || !end) return null;
	const from = Date.parse(start);
	const to = Date.parse(end);
	if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
	return to - from;
}

export function toRunRow(run: AgentRun): RunUsageRow {
	return {
		id: run.id,
		agentName: run.agentName,
		trigger: run.trigger,
		status: run.status,
		inputTokens: n(run.usageInputTokens),
		outputTokens: n(run.usageOutputTokens),
		cacheRead: n(run.usageCacheRead),
		cacheWrite: n(run.usageCacheWrite),
		cost: positiveCost(run.usageCostEstimate),
		durationMs: durationMs(run.startedAt, run.endedAt),
	};
}

/** Fold runs by agentName into per-agent rollups, sorted by total tokens desc. */
export function rollupByAgent(runs: RunUsageRow[]): AgentUsageRollup[] {
	const byAgent = new Map<string, AgentUsageRollup>();
	for (const run of runs) {
		const existing = byAgent.get(run.agentName);
		if (existing) {
			existing.runCount += 1;
			existing.inputTokens += run.inputTokens;
			existing.outputTokens += run.outputTokens;
			existing.cacheRead += run.cacheRead;
			existing.cacheWrite += run.cacheWrite;
			existing.cost = addCost(existing.cost, run.cost);
		} else {
			byAgent.set(run.agentName, {
				agentName: run.agentName,
				runCount: 1,
				inputTokens: run.inputTokens,
				outputTokens: run.outputTokens,
				cacheRead: run.cacheRead,
				cacheWrite: run.cacheWrite,
				cost: run.cost,
			});
		}
	}
	return [...byAgent.values()].sort(
		(a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
	);
}

/**
 * Totals strip. Token/cost totals come from the runs (the leaf usage rows);
 * duration comes from the container span so the header reads a wall-clock time
 * even when individual runs lack end timestamps.
 */
export function computeTotals(
	runs: RunUsageRow[],
	container: KernelContainerSummary | null | undefined,
): UsageTotals {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost: number | null = null;
	for (const run of runs) {
		inputTokens += run.inputTokens;
		outputTokens += run.outputTokens;
		cacheRead += run.cacheRead;
		cacheWrite += run.cacheWrite;
		cost = addCost(cost, run.cost);
	}
	return {
		inputTokens,
		outputTokens,
		cacheRead,
		cacheWrite,
		cost,
		runCount: runs.length,
		durationMs: durationMs(container?.startedAt, container?.endedAt),
	};
}

/** The one entry point the panel calls: detail → totals + rows + per-agent. */
export function summarizeUsage(input: {
	container?: KernelContainerSummary | null;
	runs: AgentRun[];
	/** Present for API symmetry; totals derive from runs, not sessions. */
	sessions?: PiAgentSession[];
}): UsageSummary {
	const runs = input.runs.map(toRunRow);
	return {
		totals: computeTotals(runs, input.container ?? null),
		runs,
		byAgent: rollupByAgent(runs),
	};
}

// ── formatting ────────────────────────────────────────────────────────────

/** Compact integer with thousands separators; "0" stays "0". */
export function formatTokens(value: number): string {
	return value.toLocaleString("en-US");
}

/** USD cost, or an em dash when there is no price (null). */
export function formatCost(value: number | null): string {
	if (value === null) return "—";
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: value < 1 ? 4 : 2,
	})}`;
}

/** Human duration (e.g. "1m 24s", "820ms"), or an em dash when unknown. */
export function formatDuration(ms: number | null): string {
	if (ms === null) return "—";
	if (ms < 1000) return `${ms}ms`;
	const totalSeconds = Math.round(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}
