import type { AgentRegistry } from "./types";

let instance: AgentRegistry | null = null;

export function initAgentRegistry(registry: AgentRegistry): AgentRegistry {
	if (instance) {
		throw new Error(
			"initAgentRegistry: already initialised; call __resetAgentRegistryForTests first if intentional",
		);
	}
	instance = registry;
	return instance;
}

export function getAgentRegistry(): AgentRegistry {
	if (!instance) {
		throw new Error(
			"AgentRegistry not initialized; call initAgentRegistry() during boot before handling requests",
		);
	}
	return instance;
}

export function __resetAgentRegistryForTests(): void {
	instance = null;
}
