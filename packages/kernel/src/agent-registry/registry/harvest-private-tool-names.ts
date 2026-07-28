import type { AgentPrivateTools } from "../../agent-definition";
import { getSpawnerToolMeta } from "../../agent-definition/spawner-tool";

interface StubPi {
	registerTool(tool: { name: string }): void;
	on(...args: unknown[]): void;
}

/** Boot-time harvest of an agent's tools.ts registrations. */
export interface HarvestedPrivateTools {
	/** All private tool names, in registration order. */
	names: string[];
	/** Spawner tool name → declared `spawns` allowlist (D77). */
	spawnerTools: Record<string, string[]>;
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
	const spawnerTools: Record<string, string[]> = {};
	const stubPi: StubPi = {
		registerTool(tool) {
			names.push(tool.name);
			const meta = getSpawnerToolMeta(tool);
			if (meta) spawnerTools[tool.name] = [...meta.spawns];
		},
		// Harvest runs registration code without a live session. Hooks therefore
		// register successfully but never execute; only tool declarations matter.
		on() {},
	};
	await register(stubPi as unknown as Parameters<AgentPrivateTools>[0]);
	return { names, spawnerTools };
}
