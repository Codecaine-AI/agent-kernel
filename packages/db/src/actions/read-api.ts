import { and, asc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";

import { agentRuns } from "../schema/agent-runs";
import { containers } from "../schema/containers";
import { piAgentSessions } from "../schema/pi-agent-sessions";
import { traceEvents } from "../schema/trace-events";
import type {
	AgentRun,
	Container,
	PiAgentSession,
	TraceEventRow,
} from "../types";

type KernelDatabase = any;

export interface KernelTraceReadIdentity {
	containerId: string;
	legacySessionId?: string | null;
}

export interface KernelTraceReadOptions {
	after?: string | null;
	limit?: number;
	maxContainers?: number;
}

export interface PiAgentSessionWithEventCount extends PiAgentSession {
	eventCount: number;
}

export interface KernelTraceReadRows {
	rootContainer: Container;
	containers: Container[];
	piSessions: PiAgentSessionWithEventCount[];
	agentRuns: AgentRun[];
	events: TraceEventRow[];
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
	if (limit === undefined || !Number.isFinite(limit)) return fallback;
	return Math.max(1, Math.min(Math.floor(limit), max));
}

function requiredOr(conditions: SQL[]): SQL {
	const condition = or(...conditions);
	if (!condition) throw new Error("Kernel trace read requires at least one identity condition");
	return condition;
}

export async function listContainerTree(
	db: KernelDatabase,
	rootContainerId: string,
	opts: { maxContainers?: number } = {},
): Promise<Container[]> {
	const maxContainers = clampLimit(opts.maxContainers, 500, 5000);
	const [root] = await db
		.select()
		.from(containers)
		.where(eq(containers.id, rootContainerId))
		.limit(1);

	if (!root) return [];

	const rows: Container[] = [root];
	const seen = new Set<string>([root.id]);
	let frontier = [root.id];

	while (frontier.length > 0 && rows.length < maxContainers) {
		const remaining = maxContainers - rows.length;
		const children = await db
			.select()
			.from(containers)
			.where(inArray(containers.parentContainerId, frontier))
			.orderBy(asc(containers.createdAt))
			.limit(remaining);

		frontier = [];
		for (const child of children) {
			if (seen.has(child.id)) continue;
			seen.add(child.id);
			rows.push(child);
			frontier.push(child.id);
		}
	}

	return rows;
}

export async function getKernelTraceReadRows(
	db: KernelDatabase,
	identity: KernelTraceReadIdentity,
	opts: KernelTraceReadOptions = {},
): Promise<KernelTraceReadRows | undefined> {
	const containerRows = await listContainerTree(db, identity.containerId, {
		maxContainers: opts.maxContainers,
	});
	const rootContainer = containerRows[0];
	if (!rootContainer) return undefined;

	const containerIds = containerRows.map((container) => container.id);
	const limit = clampLimit(opts.limit, 5000, 10000);

	const piIdentityConditions: SQL[] = [
		inArray(piAgentSessions.containerId, containerIds),
	];
	if (identity.legacySessionId) {
		piIdentityConditions.push(eq(piAgentSessions.appSessionId, identity.legacySessionId));
	}

	const piSessions: PiAgentSessionWithEventCount[] = await db
		.select({
			id: piAgentSessions.id,
			appSessionId: piAgentSessions.appSessionId,
			parentId: piAgentSessions.parentId,
			containerId: piAgentSessions.containerId,
			phase: piAgentSessions.phase,
			displayLabel: piAgentSessions.displayLabel,
			agentName: piAgentSessions.agentName,
			status: piAgentSessions.status,
			model: piAgentSessions.model,
			startedAt: piAgentSessions.startedAt,
			completedAt: piAgentSessions.completedAt,
			createdAt: piAgentSessions.createdAt,
			updatedAt: piAgentSessions.updatedAt,
			eventCount: sql<number>`(
				SELECT COUNT(*)::int FROM ${traceEvents}
				WHERE ${traceEvents.piSessionId} = ${piAgentSessions.id}
			)`,
		})
		.from(piAgentSessions)
		.where(requiredOr(piIdentityConditions))
		.orderBy(asc(piAgentSessions.createdAt));

	const piSessionIds = piSessions.map((pi) => pi.id);
	const runIdentityConditions: SQL[] = [
		inArray(agentRuns.containerId, containerIds),
	];
	if (piSessionIds.length > 0) {
		runIdentityConditions.push(inArray(agentRuns.piSessionId, piSessionIds));
	}

	const runRows: AgentRun[] = await db
		.select()
		.from(agentRuns)
		.where(requiredOr(runIdentityConditions))
		.orderBy(asc(agentRuns.startedAt));

	const eventIdentityConditions: SQL[] = [
		inArray(traceEvents.containerId, containerIds),
	];
	if (identity.legacySessionId) {
		eventIdentityConditions.push(eq(traceEvents.appSessionId, identity.legacySessionId));
	}

	const eventConditions: SQL[] = [requiredOr(eventIdentityConditions)];
	if (opts.after) eventConditions.push(gt(traceEvents.timestamp, opts.after));

	const eventRows: TraceEventRow[] = await db
		.select()
		.from(traceEvents)
		.where(and(...eventConditions))
		.orderBy(asc(traceEvents.timestamp), asc(traceEvents.id))
		.limit(limit);

	return {
		rootContainer,
		containers: containerRows,
		piSessions,
		agentRuns: runRows,
		events: eventRows,
	};
}
