const apiPort = String(Bun.env.PORT ?? "8788");
const frontendPort = String(Bun.env.FRONTEND_PORT ?? "5174");
const databaseUrl =
	Bun.env.AGENT_KERNEL_DATABASE_URL ??
	"postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel";

const api = Bun.spawn(["bun", "run", "api"], {
	cwd: import.meta.dir + "/..",
	env: {
		...Bun.env,
		PORT: apiPort,
		FRONTEND_PORT: frontendPort,
		AGENT_KERNEL_DATABASE_URL: databaseUrl
	},
	stdout: "inherit",
	stderr: "inherit"
});

const frontend = Bun.spawn(["bun", "run", "frontend"], {
	cwd: import.meta.dir + "/..",
	env: {
		...Bun.env,
		FRONTEND_PORT: frontendPort,
		API_TARGET: `http://127.0.0.1:${apiPort}`
	},
	stdout: "inherit",
	stderr: "inherit"
});

console.log("\nPi Agent Kernel Simple Research Kernel");
console.log("  Services: bun run dev:services");
console.log(`  Viewer:   http://127.0.0.1:${frontendPort}`);
console.log(`  API:      http://127.0.0.1:${apiPort}/kernel/trace-sessions/simple-research-kernel`);
console.log(`  DB:       ${databaseUrl}\n`);

function shutdown() {
	api.kill();
	frontend.kill();
}

process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});

await Promise.race([api.exited, frontend.exited]);
shutdown();
