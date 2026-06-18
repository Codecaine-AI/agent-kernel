const api = Bun.spawn(["bun", "run", "api"], {
	cwd: import.meta.dir + "/..",
	stdout: "inherit",
	stderr: "inherit"
});

const frontend = Bun.spawn(["bun", "run", "frontend"], {
	cwd: import.meta.dir + "/..",
	stdout: "inherit",
	stderr: "inherit"
});

console.log("\nPi Agent Kernel workbench");
console.log("  Viewer: http://127.0.0.1:5174");
console.log("  API:    http://127.0.0.1:8788/kernel/trace-sessions/basic-demo\n");

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
