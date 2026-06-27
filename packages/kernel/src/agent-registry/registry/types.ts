import type { ParsedAgent } from "../parsing/types";
import type {
	AgentPrivateTools,
	TypedAgentDefinition,
} from "../../agent-definition";
import type { AgentContextResolver } from "../../context";

export interface AgentDefinition {
	name: string;
	parsed: ParsedAgent;
	source: "typed" | "markdown";
	typedDefinition: TypedAgentDefinition | null;
	contextResolver: AgentContextResolver | null;
	contextModulePath: string | null;
	toolsModulePath: string | null;
	indexModulePath: string | null;
	privateTools: AgentPrivateTools | null;
	privateToolNames: string[];
	coreTools: string[];
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
