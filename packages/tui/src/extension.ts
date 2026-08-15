/**
 * extension.ts — pi extension entry for @agent-kernel/tui.
 *
 * Load via settings.json `extensions` array or `pi -e .../src/extension.ts`.
 * Registers /kernel (list + boot); the boot replaces the system prompt with
 * the bundle's assembled ① ② ③ each turn.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAgentCommands } from "./commands";

export default function agentKernelTui(pi: ExtensionAPI): void {
	registerAgentCommands(pi);
}
