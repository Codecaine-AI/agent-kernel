import type { ParsedAgent } from "../parsing/types";

export interface AgentDefinition {
	name: string;
	parsed: ParsedAgent;
	contextModulePath: string | null;
	indexModulePath: string | null;
	agentFile: string;
	warnings: string[];
}

export interface AgentRegistry {
	get(name: string): AgentDefinition;
	tryGet(name: string): AgentDefinition | null;
	list(): AgentDefinition[];
	catalogRoot(): string;
}

export class RegistryError extends Error {
	readonly agentFile: string;
	readonly violations: string[];

	constructor(agentFile: string, violations: string[]) {
		super(
			`Agent validation failed: ${agentFile}\n  - ${violations.join("\n  - ")}`,
		);
		this.name = "RegistryError";
		this.agentFile = agentFile;
		this.violations = violations;
	}
}
