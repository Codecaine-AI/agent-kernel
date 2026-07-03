const apiPort = String(Bun.env.PORT ?? "8788");
const frontendPort = String(Bun.env.FRONTEND_PORT ?? "5174");

const api = Bun.spawn(["bun", "run", "api"], {
	cwd: import.meta.dir + "/..",
	env: {
		...Bun.env,
		PORT: apiPort,
		FRONTEND_PORT: frontendPort
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
console.log(`  Viewer: http://127.0.0.1:${frontendPort}`);
console.log(`  API:    http://127.0.0.1:${apiPort}/kernel/trace-sessions`);
console.log("  DB:     .agent-kernel/trace.db (local SQLite — no services needed)\n");

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
