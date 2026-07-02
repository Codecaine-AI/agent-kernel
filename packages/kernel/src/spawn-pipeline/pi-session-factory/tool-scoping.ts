import type { AgentConfig } from "../types";

export const SUBAGENT_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"];

export interface ToolScopedSessionLike {
	getActiveToolNames(): string[];
	setActiveToolsByName(names: string[]): void;
}

export function applyToolScoping(
	session: ToolScopedSessionLike,
	config: AgentConfig,
): void {
	// D77: general subagent tools are never granted. Spawning happens only
	// through declared spawner tools (per-tool `spawns` allowlists), so the
	// generic Agent/steer surface is disallowed for every kernel agent.
	const disallowlist = [...(config.disallowedTools ?? []), ...SUBAGENT_TOOL_NAMES];
	const allowlist = config.tools ?? [];
	const extensions = config.extensions ?? true;

	const disallowedSet = disallowlist.length ? new Set(disallowlist) : undefined;
	const toolsAllowlist = allowlist.length ? new Set(allowlist) : undefined;
	const isExtensionTool = (n: string) => n.startsWith("mcp__") || n.includes("__");

	if (extensions === false) {
		const active = session.getActiveToolNames().filter((t) => {
			if (disallowedSet?.has(t)) return false;
			if (isExtensionTool(t)) return false;
			if (toolsAllowlist && !toolsAllowlist.has(t)) return false;
			return true;
		});
		session.setActiveToolsByName(active);
		return;
	}

	const active = session.getActiveToolNames().filter((t) => {
		if (disallowedSet?.has(t)) return false;
		if (toolsAllowlist && !toolsAllowlist.has(t) && !isExtensionTool(t)) return false;
		if (Array.isArray(extensions) && isExtensionTool(t)) {
			return extensions.some((ext) => t.startsWith(ext) || t.includes(ext));
		}
		return true;
	});
	session.setActiveToolsByName(active);
}
