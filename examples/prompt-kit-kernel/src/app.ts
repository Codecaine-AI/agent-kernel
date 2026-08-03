import { join } from "node:path";

import { createKernelCatalogApi } from "@agent-kernel/kernel/catalog-api";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";

import {
	bootPromptKitKernel,
	type PromptKitKernelBootOptions,
} from "./kernel";
import { createPromptKitPromptEditSessions } from "./prompt-edit";

export async function createPromptKitKernelHarness(
	options: PromptKitKernelBootOptions = {},
) {
	const boot = await bootPromptKitKernel(options);
	const promptEditSessions = createPromptKitPromptEditSessions(boot.kernel, {
		workingDir: boot.rootDir,
		sessionRoot: join(boot.kernelRoot, "prompt-edit-sessions"),
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
		});

	let disposed = false;
	return {
		app,
		boot,
		promptEditSessions,
		async dispose() {
			if (disposed) return;
			disposed = true;
			promptEditSessions.disposeAll();
			boot.kernel.dispose();
			await boot.kernel.traceWriter.flush();
			boot.closeDatabase();
		},
	};
}

export type PromptKitKernelHarness = Awaited<
	ReturnType<typeof createPromptKitKernelHarness>
>;
