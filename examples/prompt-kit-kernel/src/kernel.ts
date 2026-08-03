import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	writeKernelManifest,
	type KernelDatabase,
} from "@agent-kernel/db";
import { createKernel, type KernelInstance } from "@agent-kernel/kernel";

import { promptEditSharedTools } from "./prompt-edit";

export const KERNEL_ID = "prompt-kit-kernel";
export const DISPLAY_NAME = "Prompt Kit";
export const DEFAULT_PORT = 4850;
export const DEFAULT_PROMPT_EDITOR_MODEL = "codex-lb/gpt-5.5";

/** This file lives at examples/prompt-kit-kernel/src/kernel.ts. */
export const HARNESS_ROOT = resolve(import.meta.dir, "..");
export const AGENT_KERNEL_ROOT = resolve(HARNESS_ROOT, "..", "..");
export const PROMPT_EDITOR_CATALOG_ROOT = join(AGENT_KERNEL_ROOT, "catalog");
export const CATALOG_ROOTS = [PROMPT_EDITOR_CATALOG_ROOT] as const;

/**
 * Reuse the local models-process configuration already provisioned for the
 * sibling runnable example. Override for an isolated checkout or a different
 * local model provider.
 */
export const DEFAULT_PI_AGENT_DIR = join(
	AGENT_KERNEL_ROOT,
	"examples",
	"simple-research-kernel",
	".pi-agent",
);

export interface PromptKitKernelBootOptions {
	/** Runtime root containing this boot's .agent-kernel directory. */
	rootDir?: string;
	/** Override for tests or nonstandard local layouts. */
	dbPath?: string;
	piAgentDir?: string;
	readApiBaseUrl?: string;
	promptEditorModel?: string;
	catalogRoots?: string[];
	/** Defaults true; tests can still write the manifest into their temp root. */
	writeManifest?: boolean;
}

export interface PromptKitKernelBoot {
	rootDir: string;
	kernelRoot: string;
	dbPath: string;
	piSessionsDir: string;
	piAgentDir: string;
	catalogRoots: string[];
	db: KernelDatabase;
	kernel: KernelInstance<unknown>;
	closeDatabase: () => void;
}

function requireCatalogRoots(roots: readonly string[]): void {
	const missing = roots.filter((root) => !existsSync(root));
	if (missing.length > 0) {
		throw new Error(
			`Prompt Kit kernel catalog root${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}`,
		);
	}
}

export async function bootPromptKitKernel(
	options: PromptKitKernelBootOptions = {},
): Promise<PromptKitKernelBoot> {
	const rootDir = resolve(options.rootDir ?? HARNESS_ROOT);
	const kernelRoot = join(rootDir, ".agent-kernel");
	const dbPath = resolve(options.dbPath ?? kernelDatabasePath(rootDir));
	const piSessionsDir = join(kernelRoot, "pi-sessions");
	const piAgentDir = resolve(
		options.piAgentDir ?? Bun.env.PROMPT_KIT_KERNEL_PI_AGENT_DIR ?? DEFAULT_PI_AGENT_DIR,
	);
	const catalogRoots = [...(options.catalogRoots ?? CATALOG_ROOTS)];
	const promptEditorModel =
		options.promptEditorModel ??
		Bun.env.PROMPT_KIT_KERNEL_PROMPT_EDITOR_MODEL ??
		DEFAULT_PROMPT_EDITOR_MODEL;
	const readApiBaseUrl =
		options.readApiBaseUrl ?? `http://127.0.0.1:${DEFAULT_PORT}`;

	requireCatalogRoots(catalogRoots);
	mkdirSync(piSessionsDir, { recursive: true });

	const database = openKernelDatabase({ path: dbPath });
	let kernel: KernelInstance<unknown> | null = null;
	try {
		await ensureKernelObservabilitySchema(database.db);
		if (options.writeManifest !== false) {
			await writeKernelManifest(rootDir, {
				manifestVersion: 2,
				kernelId: KERNEL_ID,
				displayName: DISPLAY_NAME,
				kernelRoot,
				dbPath,
				catalogRoots,
				piSessionsDir,
				readApiBaseUrl,
			});
		}

		kernel = createKernel({
			id: KERNEL_ID,
			db: database.db,
			catalog: { roots: catalogRoots },
			models: { aliases: { "prompt-editor": promptEditorModel } },
			sharedTools: promptEditSharedTools,
			piSessionsDir,
			piAgentDir,
			concurrency: { maxBackgroundAgents: 1 },
			logger: console,
		});

		// Fail boot immediately if the catalog is malformed or missing agents.
		await kernel.registry();

		return {
			rootDir,
			kernelRoot,
			dbPath,
			piSessionsDir,
			piAgentDir,
			catalogRoots,
			db: database.db,
			kernel,
			closeDatabase: database.close,
		};
	} catch (error) {
		kernel?.dispose();
		database.close();
		throw error;
	}
}
