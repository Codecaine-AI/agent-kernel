import type { AgentPrivateTools } from "../../agent-definition";
import { getSpawnerToolMeta } from "../../agent-definition/spawner-tool";

interface StubPi {
	registerTool(tool: {
		name: string;
		label?: string;
		description?: string;
		parameters?: unknown;
	}): void;
	on(...args: unknown[]): void;
}

/** One full tool declaration harvested from a tools.ts registration. */
export interface HarvestedToolDefinition {
	name: string;
	label: string;
	description: string;
	/** Plain-JSON parameters schema (TypeBox objects serialize to this). */
	parameters: Record<string, unknown>;
}

/** Boot-time harvest of an agent's tools.ts registrations. */
export interface HarvestedPrivateTools {
	/** All private tool names, in registration order. */
	names: string[];
	/** Full declarations (name/label/description/parameters), same order. */
	definitions: HarvestedToolDefinition[];
	/** Spawner tool name → declared `spawns` allowlist (D77). */
	spawnerTools: Record<string, string[]>;
}

function plainParameters(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object") return {};
	try {
		return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Dry-run an agent's tools.ts register function against a stub Pi API to
 * collect the private tool names it registers (used to build the full tool
 * allowlist at registry boot) and any spawner declarations (D77): tools
 * compiled by `defineSpawnerTool` carry their agent-name allowlist, which
 * the registry validates against the catalog and the emitter uses to mark
 * spawner tool calls in traces.
 */
export async function harvestPrivateToolsFromRegister(
	register: AgentPrivateTools,
): Promise<HarvestedPrivateTools> {
	const names: string[] = [];
	const definitions: HarvestedToolDefinition[] = [];
	const spawnerTools: Record<string, string[]> = {};
	const stubPi: StubPi = {
		registerTool(tool) {
			names.push(tool.name);
			definitions.push({
				name: tool.name,
				label: tool.label ?? tool.name,
				description: tool.description ?? "",
				parameters: plainParameters(tool.parameters),
			});
			const meta = getSpawnerToolMeta(tool);
			if (meta) spawnerTools[tool.name] = [...meta.spawns];
		},
		// Harvest runs registration code without a live session. Hooks therefore
		// register successfully but never execute; only tool declarations matter.
		on() {},
	};
	await register(stubPi as unknown as Parameters<AgentPrivateTools>[0]);
	return { names, definitions, spawnerTools };
}
