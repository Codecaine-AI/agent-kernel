/**
 * Trace doctor — executable linkage-invariant checker for one kernel database.
 *
 * Implements invariants 1-7 from docs/10-system-design/15-identity-model.md:
 *
 *   1. Every trace_events.container_id exists in containers
 *   2. Every agent_runs.container_id and .pi_session_id resolve
 *   3. Every child session's parent_session_id resolves and carries
 *      parent_tool_use_id
 *   4. Every run reaches a terminal status, or its session is still active
 *   5. Every tool_call_start has a matching end, or its run ended abnormally
 *   6. The container tree has no cycles; every container has a kind
 *   7. Every trace_events.run_id resolves to an existing run
 *   8. (Phase 2 — skipped) turn usage sums == run == session == container
 */

import {
	agentRuns,
	containers,
	piAgentSessions,
	traceEvents,
	type KernelDatabase,
} from "@agent-kernel/db";

const SAMPLE_LIMIT = 10;

export interface DoctorViolation {
	invariant: number;
	name: string;
	description: string;
	count: number;
	/** Up to 10 offending row ids (event/run/session/container ids). */
	sampleIds: string[];
}

export interface DoctorSkippedCheck {
	invariant: number;
	reason: string;
}

export interface DoctorReport {
	checkedAt: string;
	counts: {
		containers: number;
		piAgentSessions: number;
		agentRuns: number;
		traceEvents: number;
	};
	violations: DoctorViolation[];
	skipped: DoctorSkippedCheck[];
	ok: boolean;
}

const TERMINAL_RUN_STATUSES = new Set(["done", "error", "aborted", "turn-limit"]);
const ABNORMAL_RUN_STATUSES = new Set(["error", "aborted", "turn-limit"]);

interface ViolationCollector {
	invariant: number;
	name: string;
	description: string;
	ids: string[];
}

function collect(
	violations: DoctorViolation[],
	collector: ViolationCollector,
): void {
	if (collector.ids.length === 0) return;
	violations.push({
		invariant: collector.invariant,
		name: collector.name,
		description: collector.description,
		count: collector.ids.length,
		sampleIds: collector.ids.slice(0, SAMPLE_LIMIT),
	});
}

export async function runTraceDoctor(db: KernelDatabase): Promise<DoctorReport> {
	const containerRows = await db
		.select({
			id: containers.id,
			kind: containers.kind,
			parentContainerId: containers.parentContainerId,
		})
		.from(containers);
	const sessionRows = await db
		.select({
			id: piAgentSessions.id,
			parentSessionId: piAgentSessions.parentSessionId,
			parentToolUseId: piAgentSessions.parentToolUseId,
			status: piAgentSessions.status,
		})
		.from(piAgentSessions);
	const runRows = await db
		.select({
			id: agentRuns.id,
			containerId: agentRuns.containerId,
			piSessionId: agentRuns.piSessionId,
			status: agentRuns.status,
		})
		.from(agentRuns);
	const eventRows = await db
		.select({
			eventId: traceEvents.eventId,
			containerId: traceEvents.containerId,
			runId: traceEvents.runId,
			type: traceEvents.type,
			eventData: traceEvents.eventData,
		})
		.from(traceEvents);

	const containerIds = new Set(containerRows.map((c) => c.id));
	const sessionById = new Map(sessionRows.map((s) => [s.id, s]));
	const runById = new Map(runRows.map((r) => [r.id, r]));

	const violations: DoctorViolation[] = [];

	// 1. Every trace_events.container_id exists in containers.
	collect(violations, {
		invariant: 1,
		name: "event-container-resolves",
		description: "trace_events.container_id must exist in containers",
		ids: eventRows
			.filter((e) => !containerIds.has(e.containerId))
			.map((e) => e.eventId),
	});

	// 2. Every agent_runs.container_id and .pi_session_id resolve.
	collect(violations, {
		invariant: 2,
		name: "run-linkage-resolves",
		description: "agent_runs.container_id and .pi_session_id must resolve",
		ids: runRows
			.filter(
				(r) => !containerIds.has(r.containerId) || !sessionById.has(r.piSessionId),
			)
			.map((r) => r.id),
	});

	// 3. Child sessions: parent resolves and parent_tool_use_id is carried.
	collect(violations, {
		invariant: 3,
		name: "child-session-linkage",
		description:
			"child pi_agent_sessions.parent_session_id must resolve and carry parent_tool_use_id",
		ids: sessionRows
			.filter(
				(s) =>
					s.parentSessionId != null &&
					(!sessionById.has(s.parentSessionId) || !s.parentToolUseId),
			)
			.map((s) => s.id),
	});

	// 4. Every run reaches a terminal status, or its session is still active.
	collect(violations, {
		invariant: 4,
		name: "run-terminal-or-session-active",
		description:
			"non-terminal runs are only allowed while their session is still active",
		ids: runRows
			.filter((r) => {
				if (TERMINAL_RUN_STATUSES.has(r.status)) return false;
				const session = sessionById.get(r.piSessionId);
				return !session || session.status !== "active";
			})
			.map((r) => r.id),
	});

	// 5. Every tool_call_start has a matching end, or its run ended abnormally.
	const endedToolUseIds = new Set<string>();
	for (const e of eventRows) {
		if (e.type !== "tool_call_end") continue;
		const toolUseId = toolUseIdOf(e.eventData);
		if (toolUseId) endedToolUseIds.add(toolUseId);
	}
	collect(violations, {
		invariant: 5,
		name: "tool-call-pairing",
		description:
			"tool_call_start events must pair with a tool_call_end unless the run is still running or ended abnormally",
		ids: eventRows
			.filter((e) => {
				if (e.type !== "tool_call_start") return false;
				const toolUseId = toolUseIdOf(e.eventData);
				if (toolUseId && endedToolUseIds.has(toolUseId)) return false;
				const run = e.runId ? runById.get(e.runId) : undefined;
				if (run && (run.status === "running" || ABNORMAL_RUN_STATUSES.has(run.status))) {
					return false;
				}
				return true;
			})
			.map((e) => e.eventId),
	});

	// 6. Container tree has no cycles; every container has a kind.
	collect(violations, {
		invariant: 6,
		name: "container-kind-present",
		description: "every container must carry a non-empty kind",
		ids: containerRows.filter((c) => !c.kind).map((c) => c.id),
	});
	const parentOf = new Map(
		containerRows.map((c) => [c.id, c.parentContainerId ?? null]),
	);
	const inCycle: string[] = [];
	const acyclic = new Set<string>();
	for (const c of containerRows) {
		const path = new Set<string>();
		let cursor: string | null = c.id;
		let cyclic = false;
		while (cursor != null && parentOf.has(cursor) && !acyclic.has(cursor)) {
			if (path.has(cursor)) {
				cyclic = true;
				break;
			}
			path.add(cursor);
			cursor = parentOf.get(cursor) ?? null;
		}
		if (cyclic) {
			inCycle.push(c.id);
		} else {
			for (const id of path) acyclic.add(id);
		}
	}
	collect(violations, {
		invariant: 6,
		name: "container-tree-acyclic",
		description: "the container parent tree must not contain cycles",
		ids: inCycle,
	});

	// 7. Every trace_events.run_id resolves to an existing run.
	collect(violations, {
		invariant: 7,
		name: "event-run-resolves",
		description: "trace_events.run_id must resolve to an existing agent_runs row",
		ids: eventRows
			.filter((e) => e.runId != null && !runById.has(e.runId))
			.map((e) => e.eventId),
	});

	// 8. TODO(Phase 2): turn usage sums == run rollup == session rollup ==
	// container rollup. Usage is not populated until the in-process emitter
	// lands; the check is skipped so healthy Phase 1 databases stay green.
	const skipped: DoctorSkippedCheck[] = [
		{
			invariant: 8,
			reason: "usage rollups land in Phase 2 (emitter) — check not yet active",
		},
	];

	return {
		checkedAt: new Date().toISOString(),
		counts: {
			containers: containerRows.length,
			piAgentSessions: sessionRows.length,
			agentRuns: runRows.length,
			traceEvents: eventRows.length,
		},
		violations,
		skipped,
		ok: violations.length === 0,
	};
}

function toolUseIdOf(eventData: unknown): string | undefined {
	if (eventData && typeof eventData === "object") {
		const value = (eventData as Record<string, unknown>).tool_use_id;
		if (typeof value === "string") return value;
	}
	return undefined;
}

/** Human-readable report for the CLI. */
export function formatDoctorReport(report: DoctorReport, dbPath?: string): string {
	const lines: string[] = [];
	lines.push(`agent-kernel doctor${dbPath ? ` — ${dbPath}` : ""}`);
	lines.push(`checked at ${report.checkedAt}`);
	lines.push(
		`rows: ${report.counts.containers} containers, ` +
			`${report.counts.piAgentSessions} sessions, ` +
			`${report.counts.agentRuns} runs, ` +
			`${report.counts.traceEvents} events`,
	);
	lines.push("");
	if (report.violations.length === 0) {
		lines.push("OK — no linkage invariant violations found.");
	} else {
		lines.push(`FAIL — ${report.violations.length} violation kind(s):`);
		for (const v of report.violations) {
			lines.push("");
			lines.push(`  [invariant ${v.invariant}] ${v.name} — ${v.count} row(s)`);
			lines.push(`    ${v.description}`);
			lines.push(`    samples: ${v.sampleIds.join(", ")}`);
		}
	}
	for (const s of report.skipped) {
		lines.push("");
		lines.push(`  (skipped invariant ${s.invariant}: ${s.reason})`);
	}
	return lines.join("\n");
}
