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
	/** The pi session this run belongs to — a selection fallback when the run
	 *  has no standalone `run:<id>` span (single-run sessions are not wrapped). */
	piSessionId: string;
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
		piSessionId: run.piSessionId,
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

// ── span-scoped aggregation ─────────────────────────────────────────────────

/**
 * The container/phase/agent/run "span" whose usage aggregate the detail panel
 * shows. Kinds mirror spanFactories' id conventions:
 *   - container:<containerId>  → all runs under that container
 *   - phase:<phase>            → runs stamped with that phase
 *   - pi:<piSessionUuid>       → runs belonging to that pi session
 *   - run:<runUuid>            → the single run
 */
export type UsageScope =
	| { kind: "container"; containerId: string }
	| { kind: "phase"; phase: string }
	| { kind: "session"; piSessionId: string }
	| { kind: "run"; runId: string };

const SPAN_ID_PREFIXES: ReadonlyArray<[prefix: string, make: (rest: string) => UsageScope]> = [
	["container:", (rest) => ({ kind: "container", containerId: rest })],
	["phase:", (rest) => ({ kind: "phase", phase: rest })],
	["pi:", (rest) => ({ kind: "session", piSessionId: rest })],
	["run:", (rest) => ({ kind: "run", runId: rest })],
];

/**
 * Parse a built span's `id` into the usage scope it represents, or null when
 * the id is a leaf event span (no aggregate to show). Order matters only in
 * that each prefix is distinct.
 */
export function usageScopeForSpanId(spanId: string): UsageScope | null {
	for (const [prefix, make] of SPAN_ID_PREFIXES) {
		if (spanId.startsWith(prefix)) return make(spanId.slice(prefix.length));
	}
	return null;
}

/** True when a run belongs under the given scope. */
function runInScope(run: AgentRun, scope: UsageScope): boolean {
	switch (scope.kind) {
		case "container":
			return run.containerId === scope.containerId;
		case "phase":
			return (run.phase ?? null) === scope.phase;
		case "session":
			return run.piSessionId === scope.piSessionId;
		case "run":
			return run.id === scope.runId;
	}
}

export interface SpanUsageAggregate {
	scope: UsageScope;
	totals: UsageTotals;
	byAgent: AgentUsageRollup[];
	runs: RunUsageRow[];
}

/**
 * Fold just the runs belonging to one container/phase/session/run span into a
 * usage aggregate. Returns null when the scope catches no runs (nothing to
 * show — the caller falls back to the event's normal renderer). Duration comes
 * from the container only for the whole-container scope; narrower scopes leave
 * duration to the runs (null when a run lacks an end).
 */
export function aggregateUsageForScope(input: {
	scope: UsageScope;
	runs: AgentRun[];
	container?: KernelContainerSummary | null;
}): SpanUsageAggregate | null {
	const scoped = input.runs.filter((run) => runInScope(run, input.scope)).map(toRunRow);
	if (scoped.length === 0) return null;
	const container =
		input.scope.kind === "container" ? (input.container ?? null) : null;
	return {
		scope: input.scope,
		totals: computeTotals(scoped, container),
		byAgent: rollupByAgent(scoped),
		runs: scoped,
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
