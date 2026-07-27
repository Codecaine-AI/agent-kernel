import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentContextResolver } from "../context";
import type { StateModule, WindowPolicy } from "../state/types";
import { validateAgentManifestShape } from "./agent-manifest-schema";

export {
	AGENT_MANIFEST_SCHEMA_ID,
	agentManifestJsonSchema,
	validateAgentManifestShape,
	type AgentManifestShapeResult,
} from "./agent-manifest-schema";

export {
	SPAWNER_TOOL_MARKER,
	SPAWNER_WILDCARD,
	defineSpawnerTool,
	getSpawnerToolMeta,
	spawnAllowed,
	type SpawnerDispatch,
	type SpawnerDispatchOptions,
	type SpawnerToolContext,
	type SpawnerToolDeclaration,
	type SpawnerToolDefinition,
	type SpawnerToolMeta,
} from "./spawner-tool";

export interface AgentVariableDeclaration {
	default?: unknown;
	description?: string;
	optional?: boolean;
	required?: boolean;
}

export type AgentExtensionsConfig = true | string[] | false;

/**
 * Optional `state` block in agent.json. Declaring a window policy activates
 * the state extension even for an agent with no `state.ts` sidecar — that is
 * the "base agent, bounded window" case. A manifest with no `state` block and
 * no sidecar stays a complete pass-through.
 */
export interface AgentStateConfig {
	window?: WindowPolicy;
}

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
 * The agent manifest — the pure-data contents of an agent directory's
 * `agent.json` (D76). The system prompt is NOT part of the manifest: the
 * registry pairs it with a sibling `prompt.json` (canonical PromptDocument,
 * D70); `context.ts` and `tools.ts` attach by filename convention.
 */
export interface AgentManifest {
	$schema?: string;
	name: string;
	description: string;
	/** Model id or a kernel-config alias resolved at spawn (D76/4b). */
	model: string;
	thinking?: string;
	maxTurns?: number;
	coreTools?: string[];
	disallowedTools?: string[];
	extensions?: AgentExtensionsConfig;
	runInBackground?: boolean;
	/** Named tool bundles expanded from kernel-config `toolProfiles` at boot. */
	toolProfiles?: string[];
	variables?: Record<string, AgentVariableDeclaration>;
	/** Sanctioned per-spawn overrides selected via spawn `variant` option. */
	variants?: Record<string, AgentVariantDefinition>;
	/** Per-agent state/window configuration (see AgentStateConfig). */
	state?: AgentStateConfig;
}

export type NormalizedAgentManifest = AgentManifest & {
	coreTools: string[];
	disallowedTools: string[];
	extensions: AgentExtensionsConfig;
	runInBackground: boolean;
	toolProfiles: string[];
	variables: Record<string, AgentVariableDeclaration>;
	variants: Record<string, AgentVariantDefinition>;
};

/** Fill manifest defaults without validating. Prefer `defineAgent`. */
export function normalizeAgentManifest(
	manifest: AgentManifest,
): NormalizedAgentManifest {
	return {
		...manifest,
		coreTools: manifest.coreTools ?? [],
		disallowedTools: manifest.disallowedTools ?? [],
		extensions: manifest.extensions ?? true,
		runInBackground: manifest.runInBackground ?? false,
		toolProfiles: manifest.toolProfiles ?? [],
		variables: manifest.variables ?? {},
		variants: manifest.variants ?? {},
	};
}

/**
 * Typed helper that validates and normalizes an agent manifest object.
 *
 * Since D76 the registry entry point is the `agent.json` file itself —
 * `defineAgent` is no longer imported by agent bundles. It survives as the
 * programmatic way to construct a valid manifest (generators, tests, tooling
 * that writes agent.json files). Throws on a manifest that fails the shared
 * JSON Schema shape check.
 */
export function defineAgent(manifest: AgentManifest): NormalizedAgentManifest {
	const shape = validateAgentManifestShape(manifest);
	if (!shape.valid) {
		throw new Error(
			`defineAgent: invalid agent manifest\n  - ${shape.errors.join("\n  - ")}`,
		);
	}
	return normalizeAgentManifest(manifest);
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

/**
 * Typed helper for the optional `state.ts` sidecar — the seed/update/render
 * contract. Mirrors defineContext / defineTools; re-exported from the kernel
 * root so agent bundles import it the same way.
 */
export function defineState<S>(module: StateModule<S>): StateModule<S> {
	return module;
}
