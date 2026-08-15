/**
 * Prompt-edit session wiring for the core harness.
 *
 * The session service owns the edit queue and staged proposals. The kernel
 * owns agent spawning. A small module-level FIFO bridges the launch's
 * per-session tools to createKernel's per-spawn sharedTools hook, gated on
 * the prompt-editor agent name — the same seam as the prompt-kit and canvas
 * harnesses, with the same documented limitation: this is a single-operator
 * development harness, launches are serialized by convention; a multi-user
 * host should replace the FIFO with keyed binding.
 *
 * Trace ownership (mirrors canvas-agent's bootPromptEditTraceKernel): the
 * prompt-kit kernel OWNS prompt-edit traces — a kernel owns every trace of
 * its domain, wherever the run executed. When the sibling prompt-kit repo is
 * present, prompt-editor spawns run through an auxiliary kernel — id
 * `prompt-kit-kernel`, trace.db and pi-sessions under
 * prompt-kit-agent/.agent-kernel — so core-harness prompt edits land in the
 * Prompt Kit project's trace surface, not this harness's. Standalone
 * checkouts answer null and fall back to the core kernel.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	updateContainerStatus,
} from "@agent-kernel/db";
import {
	createKernel,
	createPromptEditSessionService,
	PROMPT_EDITOR_AGENT_NAME,
	type CreateKernelConfig,
	type KernelInstance,
	type LaunchedPromptEditSession,
	type PromptEditSessionService,
} from "@agent-kernel/kernel";

/** Launches whose tools binder awaits the matching prompt-editor spawn. */
const pendingLaunches: LaunchedPromptEditSession[] = [];

/** Queue a launch for the next prompt-editor spawn. Exported for focused tests. */
export function enqueuePromptEditLaunch(launch: LaunchedPromptEditSession): void {
	pendingLaunches.push(launch);
}

/**
 * `sharedTools` hook for createKernel: binds the queued prompt-edit session
 * tools onto prompt-editor spawns, consuming the FIFO once; every other
 * agent gets no extra tools. Shared by the core kernel and the auxiliary
 * trace kernel — whichever kernel spawns the prompt-editor, the tools bind.
 */
export const promptEditSharedTools: NonNullable<
	CreateKernelConfig["sharedTools"]
> = (config) => {
	if (config.name !== PROMPT_EDITOR_AGENT_NAME) return [];
	const launch = pendingLaunches.shift();
	return launch ? [launch.tools] : [];
};

export const PROMPT_KIT_KERNEL_ID = "prompt-kit-kernel";

export interface PromptEditTraceKernelOptions {
	/** prompt-kit/packages/prompt-kit-agent — owns trace.db and pi-sessions. */
	promptKitAgentRoot: string;
	/** The prompt-editor bundle root (prompt-kit-agent/catalog). */
	promptEditorCatalogDir: string;
	/** Answer null (fall back to the core kernel) when the catalog is absent. */
	promptEditorCatalogPresent: boolean;
	piAgentDir: string;
	promptEditorModel: string;
}

export interface PromptEditTraceKernelBoot {
	kernel: KernelInstance<unknown>;
	dbPath: string;
	close: () => void;
}

/**
 * Boot the auxiliary prompt-kit-bound kernel prompt-editor runs record under.
 * No manifest write: the prompt-kit harness owns its kernel.json.
 */
export async function bootPromptEditTraceKernel(
	options: PromptEditTraceKernelOptions,
): Promise<PromptEditTraceKernelBoot | null> {
	if (!options.promptEditorCatalogPresent) return null;
	const piSessionsDir = join(
		options.promptKitAgentRoot,
		".agent-kernel",
		"pi-sessions",
	);
	mkdirSync(piSessionsDir, { recursive: true });
	const dbPath = kernelDatabasePath(options.promptKitAgentRoot);
	const handle = openKernelDatabase({ path: dbPath });
	await ensureKernelObservabilitySchema(handle.db);
	const kernel = createKernel({
		id: PROMPT_KIT_KERNEL_ID,
		db: handle.db,
		catalog: { roots: [options.promptEditorCatalogDir] },
		models: { aliases: { "prompt-editor": options.promptEditorModel } },
		// Same module-level launch queue as the core kernel's hook.
		sharedTools: promptEditSharedTools,
		piSessionsDir,
		piAgentDir: options.piAgentDir,
		concurrency: { maxBackgroundAgents: 1 },
		logger: console,
	});
	return {
		kernel,
		dbPath,
		close: () => {
			kernel.dispose();
			handle.close();
		},
	};
}

export interface CorePromptEditSessionOptions {
	workingDir: string;
	sessionRoot: string;
	/**
	 * The kernel prompt-editor runs record under (the prompt-kit trace kernel
	 * when present). Session bookkeeping — registry and catalog writes — stays
	 * on the core kernel, where the TARGET bundles live.
	 */
	spawnKernel?: KernelInstance<unknown>;
}

export function createCorePromptEditSessions<TToolRuntime>(
	kernel: KernelInstance<TToolRuntime>,
	options: CorePromptEditSessionOptions,
): PromptEditSessionService {
	const runner: KernelInstance<unknown> =
		options.spawnKernel ?? (kernel as KernelInstance<unknown>);
	return createPromptEditSessionService({
		registry: () => kernel.registry(),
		catalog: kernel.catalogApiService({ allowWrites: true }),
		allowWrites: true,
		spawnAgent: async (launch) => {
			const sessionDir = join(options.sessionRoot, launch.session.id);
			mkdirSync(sessionDir, { recursive: true });
			enqueuePromptEditLaunch(launch);
			// Kind "session" + this label + the status updates mirror the
			// prompt-kit harness's own prompt-edit containers, so core-driven
			// edits list identically in that kernel's trace surface.
			const container = await runner.container({
				kind: "session",
				key: ["prompt-edit", launch.session.id],
				label: `Edit prompt: ${launch.session.targetAgent}`,
				phase: "prompt-edit",
				phaseVocabulary: ["prompt-edit"],
				workingDir: options.workingDir,
				metadata: {
					app: "core-harness",
					topic: `Edit ${launch.session.targetAgent}`,
					targetAgent: launch.session.targetAgent,
					promptEditSessionId: launch.session.id,
				},
			});
			if (runner.db) {
				await updateContainerStatus(runner.db, container.id, "active", {
					startedAt: new Date().toISOString(),
				});
			}
			try {
				await runner.spawnAgent(
					launch.spawn.agentName,
					launch.spawn.prompt,
					null,
					{
						containerId: container.id,
						workingDir: options.workingDir,
						sessionDir,
						phase: "prompt-edit",
						trigger: "operator",
						sessionData: launch.spawn.sessionData,
						displayLabel: "Prompt Editor",
					},
				);
				if (runner.db) {
					await updateContainerStatus(runner.db, container.id, "done", {
						endedAt: new Date().toISOString(),
					});
				}
			} catch (error) {
				if (runner.db) {
					await updateContainerStatus(runner.db, container.id, "error", {
						endedAt: new Date().toISOString(),
					});
				}
				throw error;
			}
		},
	});
}
