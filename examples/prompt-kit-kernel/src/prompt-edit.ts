/**
 * Prompt-edit session wiring for this harness.
 *
 * The session service owns the edit queue and staged proposals. The kernel
 * owns agent spawning. A small FIFO bridges the launch's per-session tools to
 * createKernel's per-spawn sharedTools hook, matching the Canvas host seam.
 * This is a single-operator development harness, so launches are serialized
 * by convention; a multi-user host should replace the FIFO with keyed binding.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { updateContainerStatus } from "@agent-kernel/db";
import {
	createPromptEditSessionService,
	PROMPT_EDITOR_AGENT_NAME,
	type CreateKernelConfig,
	type KernelInstance,
	type LaunchedPromptEditSession,
	type PromptEditSessionService,
} from "@agent-kernel/kernel";

const pendingLaunches: LaunchedPromptEditSession[] = [];

/** Queue a launch for the next prompt-editor spawn. Exported for focused tests. */
export function enqueuePromptEditLaunch(launch: LaunchedPromptEditSession): void {
	pendingLaunches.push(launch);
}

/** Bind session tools only to prompt-editor spawns, consuming the FIFO once. */
export const promptEditSharedTools: NonNullable<
	CreateKernelConfig["sharedTools"]
> = (config) => {
	if (config.name !== PROMPT_EDITOR_AGENT_NAME) return [];
	const launch = pendingLaunches.shift();
	return launch ? [launch.tools] : [];
};

export interface PromptKitPromptEditSessionOptions {
	workingDir: string;
	sessionRoot: string;
}

export function createPromptKitPromptEditSessions<TToolRuntime>(
	kernel: KernelInstance<TToolRuntime>,
	options: PromptKitPromptEditSessionOptions,
): PromptEditSessionService {
	return createPromptEditSessionService({
		registry: () => kernel.registry(),
		catalog: kernel.catalogApiService({ allowWrites: true }),
		allowWrites: true,
		spawnAgent: async (launch) => {
			const sessionDir = join(options.sessionRoot, launch.session.id);
			mkdirSync(sessionDir, { recursive: true });
			const container = await kernel.container({
				kind: "session",
				key: ["prompt-edit", launch.session.id],
				label: `Edit prompt: ${launch.session.targetAgent}`,
				phase: "prompt-edit",
				phaseVocabulary: ["prompt-edit"],
				workingDir: options.workingDir,
				metadata: {
					topic: `Edit ${launch.session.targetAgent}`,
					targetAgent: launch.session.targetAgent,
					promptEditSessionId: launch.session.id,
				},
			});
			const startedAt = new Date().toISOString();
			if (kernel.db) {
				await updateContainerStatus(kernel.db, container.id, "active", {
					startedAt,
				});
			}

			try {
				enqueuePromptEditLaunch(launch);
				await kernel.spawnAgent(
					launch.spawn.agentName,
					launch.spawn.prompt,
					null,
					{
						containerId: container.id,
						workingDir: options.workingDir,
						sessionDir,
						phase: "prompt-edit",
						trigger: "operator",
						variables: launch.spawn.variables,
						sessionData: launch.spawn.sessionData,
					},
				);
				if (kernel.db) {
					await updateContainerStatus(kernel.db, container.id, "done", {
						endedAt: new Date().toISOString(),
					});
				}
			} catch (error) {
				if (kernel.db) {
					await updateContainerStatus(kernel.db, container.id, "error", {
						endedAt: new Date().toISOString(),
					});
				}
				throw error;
			}
		},
	});
}
