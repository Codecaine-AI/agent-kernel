import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createKernelTraceReadApi, type KernelTraceReadQuery } from "@agent-kernel/kernel/read-api";
import {
	deleteKernelTraceRows,
	ensureKernelObservabilitySchema,
	getKernelTraceReadRows,
	insertTraceEventsBatch,
	upsertAgentRun,
	upsertContainer,
	upsertKernelRegistration,
	upsertPiAgentSession,
	type AgentStatus,
	type KernelTraceReadRows
} from "@agent-kernel/db";
import * as schema from "@agent-kernel/db/schema";
import type { TraceEvent } from "@agent-kernel/protocol";
import {
	CursorStore,
	DirectoryWatcher,
	EventMapper,
	EventQueue,
	createTailerConfig
} from "@agent-kernel/tailer";
import type {
	AgentRun as ViewerAgentRun,
	KernelContainerSummary,
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	KernelTraceSessionSummary,
	PiSessionWithCount,
	TraceEventRow as ViewerTraceEventRow
} from "@agent-kernel/viewer-core";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import postgres from "postgres";

import {
	APP_SESSION_ID,
	APP_SESSION_SLUG,
	SimpleResearchKernelStore,
	EXAMPLE_ROOT,
	PHASE,
	ROOT_CONTAINER_ID,
	WORKING_MEMORY_DIR,
	type SimpleResearchKernelPersistence
} from "./simple-research-kernel-store";

const DEFAULT_DATABASE_URL =
	"postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel";
const databaseUrl = Bun.env.AGENT_KERNEL_DATABASE_URL ?? DEFAULT_DATABASE_URL;
const port = Number(Bun.env.PORT ?? 8788);
const frontendPort = Number(Bun.env.FRONTEND_PORT ?? 5174);
const appBaseUrl =
	Bun.env.AGENT_KERNEL_APP_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const observerUrl = Bun.env.AGENT_KERNEL_OBSERVER_URL ?? "http://127.0.0.1:8790";
const piSessionsDir = resolve(import.meta.dir, "..", ".agent-kernel", "pi-sessions");
const tailerSnapshotPath = resolve(import.meta.dir, "..", ".agent-kernel", "tailer-cursors.json");

mkdirSync(piSessionsDir, { recursive: true });

const queryClient = postgres(databaseUrl, { max: 5, onnotice: () => {} });
const db = drizzle(queryClient, { schema });

function asAgentStatus(status: string): AgentStatus {
	return status as AgentStatus;
}

function createPersistence(): SimpleResearchKernelPersistence {
	return {
		async upsertContainer(container) {
			await upsertContainer(db, {
				id: container.id,
				parentContainerId: container.parentContainerId ?? null,
				label: container.label,
				status: container.status,
				workingDir: container.workingDir ?? null,
				worktreePath: container.worktreePath ?? null,
				phase: container.phase ?? null,
				phaseVocabulary: container.phaseVocabulary,
				metadata: container.metadata,
				startedAt: container.startedAt ?? null,
				completedAt: container.completedAt ?? null,
				createdAt: container.createdAt,
				updatedAt: container.updatedAt
			});
		},
		async upsertPiSession(session) {
			await upsertPiAgentSession(db, {
				id: session.id,
				appSessionId: session.appSessionId ?? null,
				parentId: session.parentId ?? null,
				containerId: session.containerId ?? null,
				phase: session.phase ?? null,
				displayLabel: session.displayLabel ?? null,
				agentName: session.agentName,
				status: asAgentStatus(session.status),
				model: session.model,
				startedAt: session.startedAt ?? null,
				completedAt: session.completedAt ?? null,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt
			});
		},
		async upsertAgentRun(run) {
			await upsertAgentRun(db, {
				id: run.id,
				piSessionId: run.piSessionId,
				agentName: run.agentName,
				containerId: run.containerId ?? null,
				phase: run.phase ?? null,
				parentRunId: run.parentRunId ?? null,
				displayLabel: run.displayLabel ?? null,
				parentToolUseId: run.parentToolUseId ?? null,
				runNumber: run.runNumber,
				status: asAgentStatus(run.status),
				startedAt: run.startedAt ?? null,
				completedAt: run.completedAt ?? null,
				createdAt: run.createdAt,
				updatedAt: run.updatedAt
			});
		},
		async insertTraceEvent(event: TraceEvent) {
			await insertTraceEventsBatch(db, [event]);
		}
	};
}

function toContainer(row: KernelTraceReadRows["containers"][number]): KernelContainerSummary {
	return {
		id: row.id,
		parentContainerId: row.parentContainerId,
		label: row.label,
		status: row.status,
		workingDir: row.workingDir,
		worktreePath: row.worktreePath,
		phase: row.phase,
		phaseVocabulary: row.phaseVocabulary,
		metadata: row.metadata,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toPiSession(row: KernelTraceReadRows["piSessions"][number]): PiSessionWithCount {
	return {
		id: row.id,
		appSessionId: row.appSessionId,
		parentId: row.parentId,
		agentName: row.agentName,
		model: row.model ?? "unknown",
		modelAlias: row.model?.replace(/^demo-/, "") ?? null,
		status: row.status,
		phase: row.phase,
		containerId: row.containerId,
		displayLabel: row.displayLabel,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		eventCount: row.eventCount
	};
}

function toAgentRun(row: KernelTraceReadRows["agentRuns"][number]): ViewerAgentRun {
	return {
		id: row.id,
		piSessionId: row.piSessionId,
		runNumber: row.runNumber,
		agentName: row.agentName,
		status: row.status,
		parentRunId: row.parentRunId,
		containerId: row.containerId,
		phase: row.phase,
		displayLabel: row.displayLabel,
		parentToolUseId: row.parentToolUseId,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toTraceEvent(row: KernelTraceReadRows["events"][number]): ViewerTraceEventRow {
	return {
		id: row.id,
		eventId: row.id,
		appSessionId: row.appSessionId,
		containerId: row.containerId,
		userId: row.userId,
		type: row.type as ViewerTraceEventRow["type"],
		source: row.source as ViewerTraceEventRow["source"],
		traceLevel: row.traceLevel,
		eventData: row.eventData as ViewerTraceEventRow["eventData"],
		spanId: row.spanId,
		parentEventId: row.parentEventId,
		timestamp: row.timestamp,
		piSessionId: row.piSessionId,
		agentId: null
	};
}

function metadataString(
	metadata: Record<string, unknown> | null | undefined,
	key: string
): string | null {
	const value = metadata?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function sessionIdForContainer(
	container: KernelTraceReadRows["rootContainer"],
	rows?: KernelTraceReadRows
): string {
	return (
		metadataString(container.metadata, "appSessionId") ??
		rows?.piSessions.find((session) => session.appSessionId)?.appSessionId ??
		rows?.events[0]?.appSessionId ??
		(container.id === ROOT_CONTAINER_ID ? APP_SESSION_ID : container.id)
	);
}

function slugForContainer(container: KernelTraceReadRows["rootContainer"]): string {
	return (
		metadataString(container.metadata, "appSessionSlug") ??
		(container.id === ROOT_CONTAINER_ID ? APP_SESSION_SLUG : container.id)
	);
}

function topicForContainer(container: KernelTraceReadRows["rootContainer"]): string | null {
	return metadataString(container.metadata, "topic") ?? container.label;
}

function isSeedTrace(summary: KernelTraceSessionSummary): boolean {
	return summary.id === APP_SESSION_ID || summary.containerId === ROOT_CONTAINER_ID;
}

function compareTraceSessions(a: KernelTraceSessionSummary, b: KernelTraceSessionSummary): number {
	const seedDelta = Number(isSeedTrace(a)) - Number(isSeedTrace(b));
	if (seedDelta !== 0) return seedDelta;
	return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

function toDetail(rows: KernelTraceReadRows): KernelTraceSessionDetail {
	const container = toContainer(rows.rootContainer);
	const events = rows.events.map(toTraceEvent);
	const latestEventAt = events.at(-1)?.timestamp ?? container.updatedAt;
	const sessionId = sessionIdForContainer(rows.rootContainer, rows);

	return {
		session: {
			id: sessionId,
			containerId: container.id,
			appSessionSlug: slugForContainer(rows.rootContainer),
			topic: topicForContainer(rows.rootContainer),
			status: container.status,
			appSessionType: metadataString(rows.rootContainer.metadata, "appSessionType") ?? "example",
			createdAt: container.createdAt,
			updatedAt: latestEventAt
		},
		container,
		containers: rows.containers.map(toContainer),
		pi_sessions: rows.piSessions.map(toPiSession),
		agent_runs: rows.agentRuns.map(toAgentRun),
		events
	};
}

async function resolveTraceContainerId(id: string): Promise<string | null> {
	const [direct] = await db
		.select({ id: schema.containers.id })
		.from(schema.containers)
		.where(and(eq(schema.containers.id, id), eq(schema.containers.workingDir, EXAMPLE_ROOT)))
		.limit(1);
	if (direct) return direct.id;

	const [byMetadata] = await db
		.select({ id: schema.containers.id })
		.from(schema.containers)
		.where(
			and(
				eq(schema.containers.workingDir, EXAMPLE_ROOT),
				or(
					sql`${schema.containers.metadata}->>'appSessionId' = ${id}`,
					sql`${schema.containers.metadata}->>'appSessionSlug' = ${id}`
				)
			)
		)
		.limit(1);
	return byMetadata?.id ?? null;
}

async function readDetail(
	id = APP_SESSION_ID,
	query: KernelTraceReadQuery = {}
): Promise<KernelTraceSessionDetail | null> {
	await flushObservability();
	const containerId = await resolveTraceContainerId(id);
	if (!containerId) return null;

	const [container] = await db
		.select()
		.from(schema.containers)
		.where(eq(schema.containers.id, containerId))
		.limit(1);
	if (!container) return null;

	const legacySessionId = sessionIdForContainer(container);
	const rows = await getKernelTraceReadRows(db, {
		containerId,
		legacySessionId
	}, {
		after: query.after,
		limit: query.limit
	});
	return rows ? toDetail(rows) : null;
}

function isActiveTraceStatus(status: string): boolean {
	return status === "queued" || status === "running";
}

async function deleteTraceSession(id: string) {
	await flushObservability();
	const containerId = await resolveTraceContainerId(id);
	if (!containerId) {
		return {
			ok: false as const,
			status: 404,
			error: `Kernel trace session ${id} not found`
		};
	}

	const [container] = await db
		.select()
		.from(schema.containers)
		.where(eq(schema.containers.id, containerId))
		.limit(1);
	if (!container) {
		return {
			ok: false as const,
			status: 404,
			error: `Kernel trace session ${id} not found`
		};
	}

	if (isActiveTraceStatus(container.status)) {
		return {
			ok: false as const,
			status: 409,
			error: "Cannot delete a queued or running trace"
		};
	}

	const result = await deleteKernelTraceRows(db, {
		containerId,
		legacySessionId: sessionIdForContainer(container)
	});
	if (!result) {
		return {
			ok: false as const,
			status: 404,
			error: `Kernel trace session ${id} not found`
		};
	}

	return {
		ok: true as const,
		...result
	};
}

async function listTraceSessions(
	query: KernelTraceReadQuery = {}
): Promise<KernelTraceSessionListResponse> {
	await flushObservability();
	const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
	const rows = await db
		.select()
		.from(schema.containers)
		.where(and(isNull(schema.containers.parentContainerId), eq(schema.containers.workingDir, EXAMPLE_ROOT)))
		.orderBy(desc(schema.containers.updatedAt), desc(schema.containers.createdAt))
		.limit(limit);

	const traceSessions: KernelTraceSessionSummary[] = await Promise.all(
		rows.map(async (row) => {
			const legacySessionId = metadataString(row.metadata, "appSessionId");
			const [piStats] = await db
				.select({ count: sql<number>`COUNT(*)::int` })
				.from(schema.piAgentSessions)
				.where(eq(schema.piAgentSessions.containerId, row.id));
			const [eventStats] = await db
				.select({
					count: sql<number>`COUNT(*)::int`,
					latestEventAt: sql<string | null>`MAX(${schema.traceEvents.timestamp})`
				})
				.from(schema.traceEvents)
				.where(
					legacySessionId
						? or(
								eq(schema.traceEvents.containerId, row.id),
								eq(schema.traceEvents.appSessionId, legacySessionId)
							)
						: eq(schema.traceEvents.containerId, row.id)
				);

			return {
				id: sessionIdForContainer(row),
				containerId: row.id,
				label: row.label,
				appSessionSlug: slugForContainer(row),
				topic: topicForContainer(row),
				status: row.status,
				appSessionType: metadataString(row.metadata, "appSessionType") ?? "example",
				phase: row.phase ?? PHASE,
				createdAt: row.createdAt,
				updatedAt: eventStats?.latestEventAt ?? row.updatedAt,
				piSessionCount: piStats?.count ?? 0,
				eventCount: eventStats?.count ?? 0,
				latestEventAt: eventStats?.latestEventAt ?? null,
				metadata: row.metadata
			};
		})
	);
	traceSessions.sort(compareTraceSessions);

	return { trace_sessions: traceSessions, unlinked: null };
}

async function resetSeedTraceRows(): Promise<void> {
	await db.execute(sql`
		DELETE FROM ${schema.traceEvents}
		WHERE ${schema.traceEvents.containerId} = ${ROOT_CONTAINER_ID}
			OR ${schema.traceEvents.appSessionId} = ${APP_SESSION_ID}
	`);
	await db.execute(sql`
		DELETE FROM ${schema.agentRuns}
		WHERE ${schema.agentRuns.containerId} = ${ROOT_CONTAINER_ID}
			OR ${schema.agentRuns.piSessionId} IN (
				SELECT ${schema.piAgentSessions.id}
				FROM ${schema.piAgentSessions}
				WHERE ${schema.piAgentSessions.containerId} = ${ROOT_CONTAINER_ID}
					OR ${schema.piAgentSessions.appSessionId} = ${APP_SESSION_ID}
			)
	`);
	await db.execute(sql`
		DELETE FROM ${schema.piAgentSessions}
		WHERE ${schema.piAgentSessions.containerId} = ${ROOT_CONTAINER_ID}
			OR ${schema.piAgentSessions.appSessionId} = ${APP_SESSION_ID}
	`);
	await db.execute(sql`
		DELETE FROM ${schema.containers}
		WHERE ${schema.containers.id} = ${ROOT_CONTAINER_ID}
	`);
}

try {
	await ensureKernelObservabilitySchema(db);
	await resetSeedTraceRows();
	await upsertKernelRegistration(db, {
		kernelId: ROOT_CONTAINER_ID,
		displayName: "Simple Research Kernel",
		workingDir: EXAMPLE_ROOT,
		piSessionsDir,
		appBaseUrl,
		appTraceUrlTemplate: `${appBaseUrl}/traces?containerId={containerId}`,
		genericTraceUrlTemplate: `${observerUrl}/containers/{containerId}`,
		markerConfig: {
			sessionBinding: "agent-kernel:session-binding",
			lifecycle: "agent-kernel:pi-lifecycle",
			subagentLink: "agent-kernel:subagent-link"
		},
		metadata: {
			mode: "local-observability",
			appSessionId: APP_SESSION_ID,
			workingMemoryDir: WORKING_MEMORY_DIR
		}
	});
} catch (error) {
	console.error(
		[
			"Failed to initialize the Agent Kernel database.",
			`Database URL: ${databaseUrl}`,
			"Start the shared services with `bun run dev:services`, then retry `bun run dev:simple-research`.",
			error instanceof Error ? error.message : String(error)
		].join("\n")
	);
	await queryClient.end({ timeout: 1 });
	process.exit(1);
}

const tailerConfig = createTailerConfig({
	watchDir: piSessionsDir,
	snapshotPath: tailerSnapshotPath,
	batchSize: 5,
	flushIntervalMs: 50
});
const cursorStore = new CursorStore(tailerConfig);
const eventQueue = new EventQueue({
	config: tailerConfig,
	insertEvents: async (events) => {
		await insertTraceEventsBatch(db, events);
	}
});
const mappers = new Map<string, EventMapper>();
const watcher = new DirectoryWatcher(
	(filePath, events) => {
		let mapper = mappers.get(filePath);
		if (!mapper) {
			mapper = new EventMapper({
				sessionBinding: {
					customType: "agent-kernel:session-binding"
				},
				lifecycleCustomType: "agent-kernel:pi-lifecycle",
				subagentLinkCustomType: "agent-kernel:subagent-link"
			});
			mappers.set(filePath, mapper);
		}
		for (const event of events) {
			const result = mapper.map(event);
			if (result.traceEvents.length > 0) {
				eventQueue.push(result.traceEvents);
			}
		}
	},
	cursorStore,
	tailerConfig
);
await cursorStore.loadSnapshot();
eventQueue.start();
watcher.start();
cursorStore.startPeriodicSave();

async function flushObservability(): Promise<void> {
	await store.flushPersistence();
	await eventQueue.flush();
}

async function shutdownTailer(): Promise<void> {
	watcher.stop();
	await eventQueue.stop();
	await cursorStore.stop();
}

process.once("SIGINT", () => {
	void shutdownTailer().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
	void shutdownTailer().finally(() => process.exit(0));
});

const store = new SimpleResearchKernelStore({
	persistence: createPersistence(),
	db,
	piSessionsDir
});

const readApi = createKernelTraceReadApi({
	async listTraceSessions(query) {
		return listTraceSessions(query);
	},
	async getTraceSessionDetail(id, query) {
		return readDetail(id, query);
	},
	async getContainerTrace(containerId, query) {
		return readDetail(containerId, query);
	}
});

new Elysia()
	.use(readApi)
	.get("/api/research", async () => {
		await flushObservability();
		return store.getResearchInfo();
	})
	.post("/api/run", async ({ body }) => {
		const prompt =
			typeof body === "object" &&
			body !== null &&
			"prompt" in body &&
			typeof body.prompt === "string"
				? body.prompt
				: "Research how this kernel should present agents, context loading, and memory.";
		const run = await store.startResearchRun(prompt);
		await flushObservability();
		return {
			ok: true,
			run,
			trace:
				(await listTraceSessions()).trace_sessions.find(
					(trace) => trace.id === run.appSessionId || trace.containerId === run.containerId
				) ?? null
		};
	})
	.delete("/api/traces/:id", async ({ params, set }) => {
		const result = await deleteTraceSession(params.id);
		if (!result.ok) {
			set.status = result.status;
			return { ok: false, error: result.error };
		}
		return result;
	})
	.get("/api/kernel-registration", async () => {
		await db.execute(sql`select 1`);
		return {
			kernelId: ROOT_CONTAINER_ID,
			piSessionsDir,
			databaseUrl
		};
	})
	.get("/health", async () => {
		await db.execute(sql`select 1`);
		return { status: "ok", mode: "local-observability" };
	})
	.listen({ hostname: "127.0.0.1", port });

console.log(`Simple Research Kernel API listening on http://127.0.0.1:${port}`);
console.log(`Database: ${databaseUrl}`);
console.log(`Registered Pi sessions directory: ${piSessionsDir}`);
