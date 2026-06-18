import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import {
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
import type {
	AgentRun as ViewerAgentRun,
	KernelContainerSummary,
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	PiSessionWithCount,
	TraceEventRow as ViewerTraceEventRow
} from "@agent-kernel/viewer-core";
import { sql } from "drizzle-orm";
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

function toDetail(rows: KernelTraceReadRows): KernelTraceSessionDetail {
	const container = toContainer(rows.rootContainer);
	const events = rows.events.map(toTraceEvent);
	const latestEventAt = events.at(-1)?.timestamp ?? container.updatedAt;

	return {
		session: {
			id: APP_SESSION_ID,
			containerId: container.id,
			appSessionSlug: APP_SESSION_SLUG,
			topic: "Simple Research Kernel",
			status: container.status,
			appSessionType: "example",
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

async function readDetail(): Promise<KernelTraceSessionDetail | null> {
	await store.flushPersistence();
	const rows = await getKernelTraceReadRows(db, {
		containerId: ROOT_CONTAINER_ID,
		legacySessionId: APP_SESSION_ID
	});
	return rows ? toDetail(rows) : null;
}

async function listTraceSessions(): Promise<KernelTraceSessionListResponse> {
	const detail = await readDetail();
	if (!detail?.container) return { trace_sessions: [], unlinked: null };

	return {
		trace_sessions: [
			{
				id: APP_SESSION_ID,
				containerId: detail.container.id,
				label: detail.container.label,
				appSessionSlug: APP_SESSION_SLUG,
				topic: detail.session.topic,
				status: detail.container.status,
				appSessionType: detail.session.appSessionType,
				phase: detail.container.phase ?? PHASE,
				createdAt: detail.container.createdAt,
				updatedAt: detail.session.updatedAt,
				piSessionCount: detail.pi_sessions.length,
				eventCount: detail.events.length,
				latestEventAt: detail.events.at(-1)?.timestamp ?? null,
				metadata: detail.container.metadata
			}
		],
		unlinked: null
	};
}

try {
	await ensureKernelObservabilitySchema(db);
	await upsertKernelRegistration(db, {
		kernelId: ROOT_CONTAINER_ID,
		displayName: "Simple Research Kernel",
		workingDir: EXAMPLE_ROOT,
		piSessionsDir,
		appBaseUrl,
		appTraceUrlTemplate: `${appBaseUrl}/?containerId={containerId}`,
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

const store = new SimpleResearchKernelStore({ persistence: createPersistence() });

const readApi = createKernelTraceReadApi({
	async listTraceSessions() {
		return listTraceSessions();
	},
	async getTraceSessionDetail(id) {
		if (![APP_SESSION_ID, APP_SESSION_SLUG, ROOT_CONTAINER_ID].includes(id)) return null;
		return readDetail();
	},
	async getContainerTrace(containerId) {
		if (containerId !== ROOT_CONTAINER_ID) return null;
		return readDetail();
	}
});

new Elysia()
	.use(readApi)
	.get("/api/research", async () => {
		await store.flushPersistence();
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
		const run = store.startResearchRun(prompt);
		await store.flushPersistence();
		return {
			ok: true,
			run,
			trace: (await listTraceSessions()).trace_sessions[0] ?? null
		};
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
