import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { AgentContextResolver } from "../context";

export interface AgentVariableDeclaration {
	default?: unknown;
	description?: string;
	optional?: boolean;
	required?: boolean;
}

export type AgentExtensionsConfig = true | string[] | false;

export type AgentPrivateTools<TRuntime = unknown> = (
	pi: ExtensionAPI,
	runtime?: TRuntime,
) => void | Promise<void>;

export interface AgentVariantDefinition {
	model?: string;
	thinking?: string;
	maxTurns?: number;
	runInBackground?: boolean;
	displayLabel?: string;
}

/**
 * Typed agent manifest authored in `agent.ts`. The system prompt is NOT part
 * of this config: the registry pairs the definition with a sibling
 * `prompt.json` (canonical PromptDocument) by convention (D70).
 */
export interface AgentDefinitionConfig<TRuntime = unknown> {
	name: string;
	description: string;
	model: string;
	coreTools?: string[];
	disallowedTools?: string[];
	extensions?: AgentExtensionsConfig;
	canSpawnSubagent?: boolean;
	variables?: Record<string, AgentVariableDeclaration>;
	maxTurns?: number;
	runInBackground?: boolean;
	thinking?: string;
	context?: AgentContextResolver | null;
	tools?: AgentPrivateTools<TRuntime> | null;
	variants?: Record<string, AgentVariantDefinition>;
}

export type TypedAgentDefinition<TRuntime = unknown> =
	AgentDefinitionConfig<TRuntime> & {
		readonly __agentDefinitionBrand: "agent-kernel/typed-agent";
	};

export function defineAgent<TRuntime = unknown>(
	config: AgentDefinitionConfig<TRuntime>,
): TypedAgentDefinition<TRuntime> {
	return {
		...config,
		coreTools: config.coreTools ?? [],
		disallowedTools: config.disallowedTools ?? [],
		extensions: config.extensions ?? true,
		canSpawnSubagent: config.canSpawnSubagent ?? false,
		variables: config.variables ?? {},
		runInBackground: config.runInBackground ?? false,
		tools: config.tools ?? null,
		context: config.context ?? null,
		__agentDefinitionBrand: "agent-kernel/typed-agent",
	};
}

export function defineContext<TResolver extends AgentContextResolver>(
	resolver: TResolver,
): TResolver {
	return resolver;
}

export function defineTools<TRuntime = unknown>(
	tools: AgentPrivateTools<TRuntime>,
): AgentPrivateTools<TRuntime> {
	return tools;
}

export function isTypedAgentDefinition(
	value: unknown,
): value is TypedAgentDefinition {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { __agentDefinitionBrand?: unknown }).__agentDefinitionBrand ===
			"agent-kernel/typed-agent"
	);
}
