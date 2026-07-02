/**
 * Simple Research Kernel API — single local SQLite trace database.
 *
 * Boot: open .agent-kernel/trace.db (WAL), ensure the observability schema,
 * write the local kernel manifest (.agent-kernel/kernel.json). No Postgres,
 * no Docker, no tailer daemon — kernel-side lifecycle/spawn events flow
 * through the store's trace writer straight into SQLite.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createKernelTraceReadApi, type KernelTraceReadQuery } from "@agent-kernel/kernel/read-api";
import {
	deleteKernelTraceRows,
	ensureKernelObservabilitySchema,
	getKernelTraceReadRows,
	kernelDatabasePath,
	openKernelDatabase,
	writeKernelManifest,
	type Container,
	type KernelTraceReadRows
} from "@agent-kernel/db";
import { containers, piAgentSessions, traceEvents } from "@agent-kernel/db/schema";
import { runBackfill } from "@agent-kernel/tailer";
import type {
	AgentRun as ViewerAgentRun,
	KernelContainerSummary,
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	KernelTraceSessionSummary,
	PiSessionWithCount,
	TraceEventRow as ViewerTraceEventRow
} from "@agent-kernel/viewer-core";
import { and, count, desc, eq, max, sql } from "drizzle-orm";
import { Elysia } from "elysia";

import {
	EXAMPLE_ROOT,
	KERNEL_ID,
	PHASE,
	RESEARCH_SESSION_ROOT,
	SimpleResearchKernelStore,
	WORKING_MEMORY_DIR
} from "./simple-research-kernel-store";

const port = Number(Bun.env.PORT ?? 8788);
const frontendPort = Number(Bun.env.FRONTEND_PORT ?? 5174);
const appBaseUrl =
	Bun.env.AGENT_KERNEL_APP_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const piSessionsDir = resolve(EXAMPLE_ROOT, ".agent-kernel", "pi-sessions");
const dbPath = kernelDatabasePath(EXAMPLE_ROOT);

mkdirSync(piSessionsDir, { recursive: true });

const dbHandle = openKernelDatabase({ path: dbPath });
const db = dbHandle.db;
await ensureKernelObservabilitySchema(db);
await writeKernelManifest(EXAMPLE_ROOT, {
	kernelId: KERNEL_ID,
	displayName: "Simple Research Kernel",
	piSessionsDir,
	viewerBaseUrl: appBaseUrl
});

// TODO(Phase 2): mount the kernel emitter extension here so live agent-side
// events (pi lifecycle, turns, token usage) flow in-process into trace.db.
// Until then only kernel-side lifecycle/spawn events land live; complete
// JSONL transcripts can be imported with POST /api/backfill (runBackfill).

const store = new SimpleResearchKernelStore({
	db,
	piSessionsDir
});

function metadataString(
	metadata: Record<string, unknown> | null | undefined,
	key: string
): string | null {
	const value = metadata?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function toContainer(row: Container): KernelContainerSummary {
	return {
		id: row.id,
		kind: row.kind,
		parentContainerId: row.parentContainerId,
		label: row.label,
		status: row.status,
		workingDir: row.workingDir,
		phase: row.phase,
		phaseVocabulary: row.phaseVocabulary,
		metadata: row.metadata,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		endedAt: row.endedAt
	};
}

function toPiSession(row: KernelTraceReadRows["piSessions"][number]): PiSessionWithCount {
	return {
		id: row.id,
		containerId: row.containerId,
		parentSessionId: row.parentSessionId,
		parentToolUseId: row.parentToolUseId,
		agentName: row.agentName,
		displayLabel: row.displayLabel,
		model: row.model,
		promptHash: row.promptHash,
		status: row.status,
		phase: row.phase,
		createdAt: row.createdAt,
		endedAt: row.endedAt,
		eventCount: row.eventCount
	};
}

function toAgentRun(row: KernelTraceReadRows["agentRuns"][number]): ViewerAgentRun {
	return {
		id: row.id,
		piSessionId: row.piSessionId,
		containerId: row.containerId,
		parentRunId: row.parentRunId,
		parentToolUseId: row.parentToolUseId,
		agentName: row.agentName,
		trigger: row.trigger,
		inboundEventId: row.inboundEventId,
		outboundEventId: row.outboundEventId,
		displayLabel: row.displayLabel,
		phase: row.phase,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt
	};
}

function toTraceEvent(row: KernelTraceReadRows["events"][number]): ViewerTraceEventRow {
	return {
		eventId: row.eventId,
		containerId: row.containerId,
		runId: row.runId,
		piSessionId: row.piSessionId,
		agentId: row.agentId,
		userId: row.userId,
		type: row.type as ViewerTraceEventRow["type"],
		source: row.source as ViewerTraceEventRow["source"],
		traceLevel: row.traceLevel,
		eventData: row.eventData as ViewerTraceEventRow["eventData"],
		spanId: row.spanId,
		parentEventId: row.parentEventId,
		timestamp: row.timestamp
	};
}

function toDetail(rows: KernelTraceReadRows): KernelTraceSessionDetail {
	const container = toContainer(rows.rootContainer);
	const events = rows.events.map(toTraceEvent);
	const latestEventAt =
		events.at(-1)?.timestamp ?? container.endedAt ?? container.createdAt;

	return {
		session: {
			id: container.id,
			containerId: container.id,
			kind: container.kind,
			label: container.label,
			topic: metadataString(container.metadata, "topic") ?? container.label,
			status: container.status,
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

async function readDetail(
	containerId: string,
	query: KernelTraceReadQuery = {}
): Promise<KernelTraceSessionDetail | null> {
	await store.flushTraceWrites();
	const rows = await getKernelTraceReadRows(db, containerId, {
		after: query.after,
		limit: query.limit
	});
	return rows ? toDetail(rows) : null;
}

async function listTraceSessions(
	query: KernelTraceReadQuery = {}
): Promise<KernelTraceSessionListResponse> {
	await store.flushTraceWrites();
	const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
	// Trace sessions are containers of kind "session" for this kernel.
	const rows = await db
		.select()
		.from(containers)
		.where(and(eq(containers.kind, "session"), eq(containers.kernelId, KERNEL_ID)))
		.orderBy(desc(containers.createdAt))
		.limit(limit);

	const traceSessions: KernelTraceSessionSummary[] = await Promise.all(
		rows.map(async (row) => {
			const [piStats] = await db
				.select({ count: count() })
				.from(piAgentSessions)
				.where(eq(piAgentSessions.containerId, row.id));
			const [eventStats] = await db
				.select({
					count: count(),
					latestEventAt: max(traceEvents.timestamp)
				})
				.from(traceEvents)
				.where(eq(traceEvents.containerId, row.id));

			const latestEventAt = eventStats?.latestEventAt ?? null;
			return {
				id: row.id,
				containerId: row.id,
				kind: row.kind,
				label: row.label ?? row.id,
				topic: metadataString(row.metadata, "topic") ?? row.label,
				status: row.status,
				phase: row.phase ?? PHASE,
				createdAt: row.createdAt,
				updatedAt: latestEventAt ?? row.endedAt ?? row.startedAt ?? row.createdAt,
				piSessionCount: Number(piStats?.count ?? 0),
				eventCount: Number(eventStats?.count ?? 0),
				latestEventAt,
				metadata: row.metadata ?? {}
			};
		})
	);
	traceSessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

	return { trace_sessions: traceSessions };
}

function isActiveContainerStatus(status: string): boolean {
	return status === "active" || status === "running" || status === "queued";
}

async function deleteTraceSession(id: string) {
	await store.flushTraceWrites();
	const [container] = await db
		.select()
		.from(containers)
		.where(eq(containers.id, id))
		.limit(1);
	if (!container) {
		return {
			ok: false as const,
			status: 404,
			error: `Kernel trace session ${id} not found`
		};
	}

	if (isActiveContainerStatus(container.status)) {
		return {
			ok: false as const,
			status: 409,
			error: "Cannot delete an active trace"
		};
	}

	const result = await deleteKernelTraceRows(db, container.id);
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

const readApi = createKernelTraceReadApi<KernelTraceSessionDetail, KernelTraceSessionListResponse>({
	getContainerTrace(containerId, query) {
		return readDetail(containerId, query);
	},
	listSessionContainers(query) {
		return listTraceSessions(query);
	}
});

new Elysia()
	.use(readApi)
	.get("/api/research", async () => {
		const traces = await listTraceSessions();
		return store.getResearchInfo(traces.trace_sessions);
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
		await store.flushTraceWrites();
		return {
			ok: true,
			run,
			trace:
				(await listTraceSessions()).trace_sessions.find(
					(trace) => trace.containerId === run.containerId
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
	// Dev tool: import complete Pi JSONL transcripts into trace.db (idempotent
	// by event_id). The tailer is a backfill library now, not a daemon.
	.post("/api/backfill", async () => {
		const summary = await runBackfill({
			jsonlDir: piSessionsDir,
			db,
			mapper: {
				sessionBinding: { customType: "agent-kernel:session-binding" },
				lifecycleCustomType: "agent-kernel:pi-lifecycle",
				subagentLinkCustomType: "agent-kernel:subagent-link"
			}
		});
		return { ok: true, summary };
	})
	.get("/api/kernel-manifest", () => ({
		kernelId: KERNEL_ID,
		piSessionsDir,
		dbPath,
		researchSessionRoot: RESEARCH_SESSION_ROOT,
		workingMemoryTemplateDir: WORKING_MEMORY_DIR
	}))
	.get("/health", () => {
		db.run(sql`select 1`);
		return { status: "ok", mode: "local-sqlite" };
	})
	.listen({ hostname: "127.0.0.1", port });

function shutdown(): void {
	store.kernel.dispose();
	dbHandle.close();
}

process.once("SIGINT", () => {
	shutdown();
	process.exit(0);
});
process.once("SIGTERM", () => {
	shutdown();
	process.exit(0);
});

console.log(`Simple Research Kernel API listening on http://127.0.0.1:${port}`);
console.log(`Trace database: ${dbPath}`);
console.log(`Pi sessions directory: ${piSessionsDir}`);
