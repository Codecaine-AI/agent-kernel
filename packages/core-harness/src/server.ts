/**
 * Core harness server — the agent-kernel repo's own kernel service on :4860,
 * fronted by the Observatory's kernel proxy (which forwards
 * /projects/:id/kernel/* to `${readApiBaseUrl}/kernel/*`). Mounts:
 *
 *   /kernel/*   trace read API + catalog API (+ prompt-edit session routes)
 *   /health
 */
import { join } from "node:path";

import { createKernelCatalogApi } from "@agent-kernel/kernel/catalog-api";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";

import { bootCoreKernel, DEFAULT_PORT, PROMPT_EDITOR_CATALOG_DIR, PROMPT_KIT_AGENT_ROOT } from "./kernel";
import {
	bootPromptEditTraceKernel,
	createCorePromptEditSessions,
} from "./prompt-edit";

const port = Number(Bun.env.CORE_HARNESS_PORT ?? Bun.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`CORE_HARNESS_PORT must be a valid TCP port; got ${port}`);
}
const baseUrl = `http://127.0.0.1:${port}`;

const boot = await bootCoreKernel();
// Prompt-editor runs record under the prompt-kit kernel when its repo is
// present — prompt-edit traces are owned by that kernel, not this one.
const promptEditTraceKernel = await bootPromptEditTraceKernel({
	promptKitAgentRoot: PROMPT_KIT_AGENT_ROOT,
	promptEditorCatalogDir: PROMPT_EDITOR_CATALOG_DIR,
	promptEditorCatalogPresent: boot.promptEditorCatalogPresent,
	piAgentDir: boot.piAgentDir,
	promptEditorModel: boot.promptEditorModel,
});
const promptEditSessions = createCorePromptEditSessions(boot.kernel, {
	workingDir: boot.rootDir,
	sessionRoot: join(boot.kernelRoot, "prompt-edit-sessions"),
	spawnKernel: promptEditTraceKernel?.kernel,
});

const catalogApi = createKernelCatalogApi(
	boot.kernel.catalogApiService({ allowWrites: true }),
	{
		prefix: "/kernel",
		allowWrites: true,
		promptEditSessions,
	},
);
const readApi = createKernelTraceReadApi(boot.kernel.readApiService, {
	prefix: "/kernel",
});

const app = new Elysia()
	.use(readApi)
	.use(catalogApi)
	.get("/health", () => {
		boot.db.run(sql`select 1`);
		return { status: "ok", kernel: boot.kernel.id };
	})
	.listen({ hostname: "127.0.0.1", port });

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	app.stop();
	promptEditSessions.disposeAll();
	promptEditTraceKernel?.close();
	boot.kernel.dispose();
	await boot.kernel.traceWriter.flush();
	boot.closeDatabase();
}

process.once("SIGINT", () => {
	void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
	void shutdown().finally(() => process.exit(0));
});

console.log(`Core harness (${boot.kernelId}) listening on ${baseUrl}`);
console.log(`Trace database: ${boot.dbPath}`);
console.log(`Catalog roots: ${boot.catalogRoots.join(", ")}`);
console.log(
	promptEditTraceKernel
		? `Prompt-edit trace kernel: ${promptEditTraceKernel.kernel.id} (db: ${promptEditTraceKernel.dbPath})`
		: "Prompt-edit trace kernel: none (prompt-kit repo absent); prompt-editor runs record under the core kernel",
);

export { app };
