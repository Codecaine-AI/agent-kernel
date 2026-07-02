import type { PromptDocument } from "@codecaine-ai/prompt-kit";

import type { ParsedAgent } from "../../spawn-pipeline/types";
import type {
	AgentPrivateTools,
	NormalizedAgentManifest,
} from "../../agent-definition";
import type { AgentContextResolver } from "../../context";

export interface AgentDefinition {
	name: string;
	/** Runtime config + rendered prompt template (variables unsubstituted). */
	parsed: ParsedAgent;
	/** The validated, normalized agent.json contents (D76). */
	manifest: NormalizedAgentManifest;
	/** Canonical prompt document loaded from the sibling prompt.json. */
	promptDocument: PromptDocument;
	/** Content address of the prompt: "pk1-" + sha256(canonical bytes). */
	promptHash: string;
	/** Absolute path of the prompt.json the document was loaded from. */
	promptFile: string;
	/** Context sidecar (context.ts), attached by filename convention. */
	contextResolver: AgentContextResolver | null;
	contextModulePath: string | null;
	/** Tools sidecar (tools.ts), attached by filename convention. */
	privateTools: AgentPrivateTools | null;
	privateToolNames: string[];
	toolsModulePath: string | null;
	coreTools: string[];
	/** Absolute path of the agent.json manifest. */
	manifestFile: string;
	warnings: string[];
}

export interface AgentRegistry {
	get(name: string): AgentDefinition;
	tryGet(name: string): AgentDefinition | null;
	list(): AgentDefinition[];
	roots(): string[];
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
