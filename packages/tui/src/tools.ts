/**
 * tools.ts — bind a bundle's tools sidecar to a live pi session.
 *
 * The sidecar contract is `(pi, runtime?) => void | Promise<void>`
 * (AgentPrivateTools). Standalone there is no app runtime and no kernel
 * dispatch, so:
 *   - self-contained tools register and run normally;
 *   - tools that require an app runtime register fine (the exemplar sidecars
 *     resolve their runtime lazily inside execute) and fail with the bundle's
 *     own error at call time;
 *   - spawner tools (D77) are blocked at tool_call with a visible reason —
 *     their execute expects the kernel-injected dispatch handle, which only
 *     the spawn pipeline can bind. Wiring dispatch through the subagents
 *     module over catalog precedence is phase 3.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentDefinition } from "@agent-kernel/kernel/agent-registry/registry";

export interface BoundBundleTools {
	/** True when the sidecar's register function ran without throwing. */
	bound: boolean;
	toolNames: string[];
	/** Spawner tool names blocked for standalone sessions. */
	blockedSpawnerTools: string[];
	/** Visible degradation notice for the user, or null when fully bound. */
	notice: string | null;
}

export async function bindBundleTools(
	pi: ExtensionAPI,
	def: AgentDefinition,
): Promise<BoundBundleTools> {
	const blockedSpawnerTools = Object.keys(def.spawnerTools);
	const notices: string[] = [];

	if (!def.privateTools) {
		return { bound: false, toolNames: [], blockedSpawnerTools: [], notice: null };
	}

	let bound = false;
	try {
		await def.privateTools(pi, undefined);
		bound = true;
	} catch (err) {
		notices.push(
			`tools sidecar failed to register (${def.toolsModulePath ?? "tools"}): ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}

	if (bound && blockedSpawnerTools.length > 0) {
		const blocked = new Set(blockedSpawnerTools);
		pi.on("tool_call", (event) => {
			if (!blocked.has(event.toolName)) return;
			return {
				block: true,
				reason:
					`${event.toolName} is a kernel spawner tool and needs the spawn ` +
					"pipeline's dispatch handle; it is unavailable in a standalone " +
					"TUI session. Continue without sub-agents.",
			};
		});
		notices.push(
			`spawner tools disabled standalone: ${blockedSpawnerTools.join(", ")}`,
		);
	}

	return {
		bound,
		toolNames: bound ? def.privateToolNames : [],
		blockedSpawnerTools: bound ? blockedSpawnerTools : [],
		notice: notices.length > 0 ? notices.join("\n") : null,
	};
}
