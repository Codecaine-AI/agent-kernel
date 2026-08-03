import { createPromptKitKernelHarness } from "./app";
import { DEFAULT_PORT } from "./kernel";

const port = Number(
	Bun.env.PROMPT_KIT_KERNEL_PORT ?? Bun.env.PORT ?? DEFAULT_PORT,
);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`PROMPT_KIT_KERNEL_PORT must be a valid TCP port; got ${port}`);
}

const baseUrl = `http://127.0.0.1:${port}`;
const harness = await createPromptKitKernelHarness({ readApiBaseUrl: baseUrl });
let server: ReturnType<typeof harness.app.listen>;
try {
	server = harness.app.listen({ hostname: "127.0.0.1", port });
} catch (error) {
	await harness.dispose();
	throw error;
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	server.stop();
	await harness.dispose();
}

process.once("SIGINT", () => {
	void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
	void shutdown().finally(() => process.exit(0));
});

console.log(`Prompt Kit kernel listening on ${baseUrl}`);
console.log(`Trace database: ${harness.boot.dbPath}`);
console.log(`Catalog roots: ${harness.boot.catalogRoots.join(", ")}`);
