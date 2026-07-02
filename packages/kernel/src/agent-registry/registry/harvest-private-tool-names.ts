import type { AgentPrivateTools } from "../../agent-definition";

interface StubPi {
	registerTool(tool: { name: string }): void;
}

/**
 * Dry-run an agent's tools.ts register function against a stub Pi API to
 * collect the private tool names it registers (used to build the full tool
 * allowlist at registry boot).
 */
export async function harvestPrivateToolNamesFromRegister(
	register: AgentPrivateTools,
): Promise<string[]> {
	const names: string[] = [];
	const stubPi: StubPi = {
		registerTool(tool) {
			names.push(tool.name);
		},
	};
	await register(stubPi as unknown as Parameters<AgentPrivateTools>[0]);
	return names;
}
