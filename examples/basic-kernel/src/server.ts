import { Elysia } from "elysia";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";

import { DemoKernelStore } from "./kernel-demo-store";

const store = new DemoKernelStore();
const port = Number(Bun.env.PORT ?? 8788);

const readApi = createKernelTraceReadApi({
	async listTraceSessions() {
		return store.listTraceSessions();
	},
	async getTraceSessionDetail() {
		return store.getTraceSessionDetail();
	},
	async getContainerTrace() {
		return store.getTraceSessionDetail();
	}
});

new Elysia()
	.use(readApi)
	.get("/api/workbench", () => ({
		kernelId: store.kernel.id,
		concurrency: store.kernel.concurrency,
		trace: store.listTraceSessions().trace_sessions[0]
	}))
	.post("/api/run", async ({ body }) => {
		const prompt =
			typeof body === "object" &&
			body !== null &&
			"prompt" in body &&
			typeof body.prompt === "string"
				? body.prompt
				: "Run the basic kernel workbench demo.";
		const result = await store.kernel.spawnAgent("kernel-workbench-agent", prompt, null, {
			prompt
		});
		return {
			ok: true,
			responseText: result.responseText,
			trace: store.listTraceSessions().trace_sessions[0]
		};
	})
	.get("/health", () => ({ status: "ok" }))
	.listen({ hostname: "127.0.0.1", port });

console.log(`Basic kernel API listening on http://127.0.0.1:${port}`);
