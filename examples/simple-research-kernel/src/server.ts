/**
 * Simple Research Kernel API — single local SQLite trace database.
 *
 * Boot: open .agent-kernel/trace.db (WAL), ensure the observability schema,
 * write the local kernel manifest (.agent-kernel/kernel.json). No Postgres,
 * no Docker, no tailer daemon — trace reads and writes go through the
 * kernel's default traceWriter / readApiService (Phase 4b).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createKernelCatalogApi } from "@agent-kernel/kernel/catalog-api";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import {
	deleteKernelTraceRows,
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	writeKernelManifest
} from "@agent-kernel/db";
import { containers } from "@agent-kernel/db/schema";
import { runBackfill } from "@agent-kernel/tailer";
import type {
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";
import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";

import {
	EXAMPLE_ROOT,
	KERNEL_ID,
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

const store = new SimpleResearchKernelStore({
	db,
	piSessionsDir
});
const kernel = store.kernel;

// The container-backed default read service: getContainerTrace over the
// container subtree, listSessionContainers over kind="session" rows. Shapes
// are structurally the viewer-core trace session contract.
const readService = kernel.readApiService;

async function listTraceSessions(): Promise<KernelTraceSessionListResponse> {
	return (await readService.listSessionContainers()) as KernelTraceSessionListResponse;
}

function isActiveContainerStatus(status: string): boolean {
	return status === "active" || status === "running" || status === "queued";
}

async function deleteTraceSession(id: string) {
	await kernel.traceWriter.flush();
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
	getContainerTrace: (containerId, query) =>
		readService.getContainerTrace(containerId, query) as Promise<KernelTraceSessionDetail | null>,
	listSessionContainers: (query) =>
		readService.listSessionContainers(query) as Promise<KernelTraceSessionListResponse>
});

// Catalog API (Phase 5): registry listing, agent detail, prompt lab saves,
// revision history + per-revision stats. This is the dev harness, so catalog
// writes (PUT .../prompt mutates prompt.json on disk) are enabled.
const catalogApi = createKernelCatalogApi(
	kernel.catalogApiService({ allowWrites: true })
);

new Elysia()
	.use(readApi)
	.use(catalogApi)
	.get("/api/research", async () => {
		const traces = await listTraceSessions();
		return store.getResearchInfo(traces.trace_sessions);
	})
	.post("/api/run", async ({ body }) => {
		const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const prompt =
			typeof input.prompt === "string"
				? input.prompt
				: "Research how this kernel should present agents, context loading, and memory.";
		const variant = typeof input.variant === "string" ? input.variant : undefined;
		const run = await store.startResearchRun(prompt, { variant });
		await kernel.traceWriter.flush();
		return {
			ok: true,
			run,
			trace:
				(await listTraceSessions()).trace_sessions.find(
					(trace: KernelTraceSessionSummary) => trace.containerId === run.containerId
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
	// Trace doctor over the kernel db (invariants 1-8, identity model spec).
	.get("/api/doctor", () => kernel.doctor())
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
	kernel.dispose();
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
