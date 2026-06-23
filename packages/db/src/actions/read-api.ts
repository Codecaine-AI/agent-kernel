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

export interface KernelTraceDeleteResult {
	containerIds: string[];
	piSessionIds: string[];
	deleted: {
		traceEvents: number;
		agentRuns: number;
		piAgentSessions: number;
		containers: number;
	};
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

	const piSessionRows: PiAgentSession[] = await db
		.select()
		.from(piAgentSessions)
		.where(requiredOr(piIdentityConditions))
		.orderBy(asc(piAgentSessions.createdAt));

	const piSessionIds = piSessionRows.map((pi) => pi.id);
	const eventCountRows: Array<{ piSessionId: string | null; eventCount: number }> =
		piSessionIds.length > 0
			? await db
					.select({
						piSessionId: traceEvents.piSessionId,
						eventCount: sql<number>`COUNT(*)::int`,
					})
					.from(traceEvents)
					.where(inArray(traceEvents.piSessionId, piSessionIds))
					.groupBy(traceEvents.piSessionId)
			: [];
	const eventCountsByPiSession = new Map<string, number>();
	for (const row of eventCountRows) {
		if (row.piSessionId) eventCountsByPiSession.set(row.piSessionId, Number(row.eventCount ?? 0));
	}
	const piSessions: PiAgentSessionWithEventCount[] = piSessionRows.map((session) => ({
		...session,
		eventCount: eventCountsByPiSession.get(session.id) ?? 0,
	}));

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

export async function deleteKernelTraceRows(
	db: KernelDatabase,
	identity: KernelTraceReadIdentity,
	opts: Pick<KernelTraceReadOptions, "maxContainers"> = {},
): Promise<KernelTraceDeleteResult | undefined> {
	const containerRows = await listContainerTree(db, identity.containerId, {
		maxContainers: opts.maxContainers,
	});
	const rootContainer = containerRows[0];
	if (!rootContainer) return undefined;

	const containerIds = containerRows.map((container) => container.id);

	return db.transaction(async (tx: KernelDatabase) => {
		const piIdentityConditions: SQL[] = [
			inArray(piAgentSessions.containerId, containerIds),
		];
		if (identity.legacySessionId) {
			piIdentityConditions.push(eq(piAgentSessions.appSessionId, identity.legacySessionId));
		}
		const piIdentityCondition = requiredOr(piIdentityConditions);

		const piSessionRows: Array<{ id: string }> = await tx
			.select({ id: piAgentSessions.id })
			.from(piAgentSessions)
			.where(piIdentityCondition);
		const piSessionIds = piSessionRows.map((session) => session.id);

		const eventIdentityConditions: SQL[] = [
			inArray(traceEvents.containerId, containerIds),
		];
		if (identity.legacySessionId) {
			eventIdentityConditions.push(eq(traceEvents.appSessionId, identity.legacySessionId));
		}
		if (piSessionIds.length > 0) {
			eventIdentityConditions.push(inArray(traceEvents.piSessionId, piSessionIds));
		}
		const deletedEvents: Array<{ id: string }> = await tx
			.delete(traceEvents)
			.where(requiredOr(eventIdentityConditions))
			.returning({ id: traceEvents.id });

		const runIdentityConditions: SQL[] = [
			inArray(agentRuns.containerId, containerIds),
		];
		if (piSessionIds.length > 0) {
			runIdentityConditions.push(inArray(agentRuns.piSessionId, piSessionIds));
		}
		const deletedRuns: Array<{ id: string }> = await tx
			.delete(agentRuns)
			.where(requiredOr(runIdentityConditions))
			.returning({ id: agentRuns.id });

		const deletedPiSessions: Array<{ id: string }> = await tx
			.delete(piAgentSessions)
			.where(piIdentityCondition)
			.returning({ id: piAgentSessions.id });

		const deletedContainers: Array<{ id: string }> = [];
		for (const container of [...containerRows].reverse()) {
			const rows: Array<{ id: string }> = await tx
				.delete(containers)
				.where(eq(containers.id, container.id))
				.returning({ id: containers.id });
			deletedContainers.push(...rows);
		}

		return {
			containerIds,
			piSessionIds,
			deleted: {
				traceEvents: deletedEvents.length,
				agentRuns: deletedRuns.length,
				piAgentSessions: deletedPiSessions.length,
				containers: deletedContainers.length,
			},
		};
	});
}
