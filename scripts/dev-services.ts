const composeFile = `${import.meta.dir}/../docker-compose.agent-kernel.yml`;

const services = Bun.spawn(["docker", "compose", "-f", composeFile, "up", "agent-kernel-db"], {
	stdout: "inherit",
	stderr: "inherit"
});

console.log("\nPi Agent Kernel local services");
console.log("  Postgres: 127.0.0.1:55432");
console.log(
	"  URL:      postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel\n"
);

function shutdown() {
	services.kill();
}

process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});

const code = await services.exited;
process.exit(code);
