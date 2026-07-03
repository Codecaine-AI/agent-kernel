/**
 * Read API helpers — container-first. All reads are keyed by containerId;
 * there is no app-session identity in this package.
 */
import { and, asc, count, desc, eq, gt, inArray, max, type SQL } from "drizzle-orm";

import type { KernelDatabase } from "../client";
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

export interface SessionContainerStatsRow {
	container: Container;
	piSessionCount: number;
	eventCount: number;
	latestEventAt: string | null;
}

export interface ListSessionContainersOptions {
	/** Scope to one kernel's containers. */
	kernelId?: string;
	/** Container kind to list; defaults to "session". */
	kind?: string;
	limit?: number;
}

/**
 * Containers of kind "session" (newest first) with the per-container pi
 * session count, event count, and latest event timestamp — the rows behind
 * the trace-sessions index.
 */
export async function listSessionContainersWithStats(
	db: KernelDatabase,
	opts: ListSessionContainersOptions = {},
): Promise<SessionContainerStatsRow[]> {
	const limit = clampLimit(opts.limit, 100, 500);
	const kind = opts.kind ?? "session";
	const conditions: SQL[] = [eq(containers.kind, kind)];
	if (opts.kernelId) conditions.push(eq(containers.kernelId, opts.kernelId));

	const rows = await db
		.select()
		.from(containers)
		.where(and(...conditions))
		.orderBy(desc(containers.createdAt))
		.limit(limit);
	if (rows.length === 0) return [];

	const containerIds = rows.map((row) => row.id);
	const piCounts = await db
		.select({ containerId: piAgentSessions.containerId, count: count() })
		.from(piAgentSessions)
		.where(inArray(piAgentSessions.containerId, containerIds))
		.groupBy(piAgentSessions.containerId);
	const eventStats = await db
		.select({
			containerId: traceEvents.containerId,
			count: count(),
			latestEventAt: max(traceEvents.timestamp),
		})
		.from(traceEvents)
		.where(inArray(traceEvents.containerId, containerIds))
		.groupBy(traceEvents.containerId);

	const piCountByContainer = new Map(
		piCounts.map((row) => [row.containerId, Number(row.count ?? 0)]),
	);
	const eventStatsByContainer = new Map(
		eventStats.map((row) => [
			row.containerId,
			{ count: Number(row.count ?? 0), latestEventAt: row.latestEventAt ?? null },
		]),
	);

	return rows.map((container) => {
		const stats = eventStatsByContainer.get(container.id);
		return {
			container,
			piSessionCount: piCountByContainer.get(container.id) ?? 0,
			eventCount: stats?.count ?? 0,
			latestEventAt: stats?.latestEventAt ?? null,
		};
	});
}

/** Breadth-first walk of a container subtree, root first. */
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

/**
 * Everything the viewer needs for one container subtree: the container rows,
 * their sessions (with event counts), runs, and events — keyed by containerId
 * only.
 */
export async function getKernelTraceReadRows(
  db: KernelDatabase,
  rootContainerId: string,
  opts: KernelTraceReadOptions = {},
): Promise<KernelTraceReadRows | undefined> {
  const containerRows = await listContainerTree(db, rootContainerId, {
    maxContainers: opts.maxContainers,
  });
  const rootContainer = containerRows[0];
  if (!rootContainer) return undefined;

  const containerIds = containerRows.map((container) => container.id);
  const limit = clampLimit(opts.limit, 5000, 10000);

  const piSessionRows: PiAgentSession[] = await db
    .select()
    .from(piAgentSessions)
    .where(inArray(piAgentSessions.containerId, containerIds))
    .orderBy(asc(piAgentSessions.createdAt));

  const piSessionIds = piSessionRows.map((pi) => pi.id);
  const eventCountRows =
    piSessionIds.length > 0
      ? await db
          .select({
            piSessionId: traceEvents.piSessionId,
            eventCount: count(),
          })
          .from(traceEvents)
          .where(inArray(traceEvents.piSessionId, piSessionIds))
          .groupBy(traceEvents.piSessionId)
      : [];
  const eventCountsByPiSession = new Map<string, number>();
  for (const row of eventCountRows) {
    if (row.piSessionId) {
      eventCountsByPiSession.set(row.piSessionId, Number(row.eventCount ?? 0));
    }
  }
  const piSessions: PiAgentSessionWithEventCount[] = piSessionRows.map(
    (session) => ({
      ...session,
      eventCount: eventCountsByPiSession.get(session.id) ?? 0,
    }),
  );

  const runRows: AgentRun[] = await db
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.containerId, containerIds))
    .orderBy(asc(agentRuns.startedAt));

  const eventConditions: SQL[] = [
    inArray(traceEvents.containerId, containerIds),
  ];
  if (opts.after) eventConditions.push(gt(traceEvents.timestamp, opts.after));

  const eventRows: TraceEventRow[] = await db
    .select()
    .from(traceEvents)
    .where(and(...eventConditions))
    .orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId))
    .limit(limit);

  return {
    rootContainer,
    containers: containerRows,
    piSessions,
    agentRuns: runRows,
    events: eventRows,
  };
}

/** Delete a container subtree and all rows hanging off it. */
export async function deleteKernelTraceRows(
  db: KernelDatabase,
  rootContainerId: string,
  opts: Pick<KernelTraceReadOptions, "maxContainers"> = {},
): Promise<KernelTraceDeleteResult | undefined> {
  const containerRows = await listContainerTree(db, rootContainerId, {
    maxContainers: opts.maxContainers,
  });
  const rootContainer = containerRows[0];
  if (!rootContainer) return undefined;

  const containerIds = containerRows.map((container) => container.id);

  return db.transaction(async (tx) => {
    const piSessionRows = await tx
      .select({ id: piAgentSessions.id })
      .from(piAgentSessions)
      .where(inArray(piAgentSessions.containerId, containerIds));
    const piSessionIds = piSessionRows.map((session) => session.id);

    const eventConditions: SQL[] = [
      inArray(traceEvents.containerId, containerIds),
    ];
    const deletedEvents = await tx
      .delete(traceEvents)
      .where(and(...eventConditions))
      .returning({ eventId: traceEvents.eventId });

    const deletedRuns = await tx
      .delete(agentRuns)
      .where(inArray(agentRuns.containerId, containerIds))
      .returning({ id: agentRuns.id });

    const deletedPiSessions =
      piSessionIds.length > 0
        ? await tx
            .delete(piAgentSessions)
            .where(inArray(piAgentSessions.id, piSessionIds))
            .returning({ id: piAgentSessions.id })
        : [];

    const deletedContainers: Array<{ id: string }> = [];
    for (const container of [...containerRows].reverse()) {
      const rows = await tx
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
