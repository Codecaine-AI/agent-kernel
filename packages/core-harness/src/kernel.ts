/**
 * Core kernel boot — the agent-kernel repo running as a kernel of its own.
 *
 * Unlike the app harnesses (canvas-agent, prompt-kit-agent) this boot does
 * NOT write .agent-kernel/kernel.json: the manifest is owned by the repo (a
 * separate authoring surface), and this harness only READS it at startup to
 * learn kernelId / dbPath / catalogRoots. When the manifest is missing the
 * boot logs a clear error and falls back to the contract defaults (kernelId
 * `agent-kernel`, catalog/ as the browseable root, .agent-kernel/trace.db).
 *
 * The prompt-editor bundle lives in the sibling prompt-kit repo's
 * prompt-kit-agent catalog (Core meta-workspace layout). It joins this
 * kernel's registry unlisted — resolvable for prompt-edit spawns, absent from
 * the browseable listing — mirroring canvas-agent's KERNEL_CATALOG_ROOTS.
 */
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	readKernelManifest,
	type KernelDatabase,
	type ReadKernelManifest,
} from "@agent-kernel/db";
import {
	createKernel,
	type CatalogRootSpec,
	type KernelInstance,
} from "@agent-kernel/kernel";

import { promptEditSharedTools } from "./prompt-edit";

export const KERNEL_ID = "agent-kernel";
export const DISPLAY_NAME = "Agent Kernel";
export const DEFAULT_PORT = 4860;
/** Same default as prompt-kit-agent's DEFAULT_PROMPT_EDITOR_MODEL. */
export const DEFAULT_PROMPT_EDITOR_MODEL = "codex-lb/gpt-5.6-sol";

/** This file lives at packages/core-harness/src/kernel.ts. */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
export const KERNEL_ROOT = join(REPO_ROOT, ".agent-kernel");
/** The repo's generic catalog (context-editor et al.). */
export const GENERIC_CATALOG_ROOT = join(REPO_ROOT, "catalog");
/** Repo-local models-process config (codex-lb provider), like the siblings. */
export const DEFAULT_PI_AGENT_DIR = join(REPO_ROOT, ".pi-agent");

/**
 * The shared prompt-editor bundle in the sibling prompt-kit repo. Present
 * only in the Core meta-workspace layout — standalone checkouts must still
 * boot, so it joins the registry conditionally (see bootCoreKernel).
 */
export const PROMPT_KIT_AGENT_ROOT = resolve(
	REPO_ROOT,
	"..",
	"prompt-kit",
	"packages",
	"prompt-kit-agent",
);
export const PROMPT_EDITOR_CATALOG_DIR = join(PROMPT_KIT_AGENT_ROOT, "catalog");

export interface CoreKernelBootOptions {
	/** Runtime root containing this boot's .agent-kernel directory. */
	rootDir?: string;
	/** Override for tests or nonstandard local layouts. */
	dbPath?: string;
	piAgentDir?: string;
	promptEditorModel?: string;
	contextEditorModel?: string;
	docsWriterModel?: string;
}

export interface CoreKernelBoot {
	rootDir: string;
	kernelRoot: string;
	kernelId: string;
	dbPath: string;
	piSessionsDir: string;
	piAgentDir: string;
	/** Browseable catalog roots (manifest catalogRoots or catalog/ fallback). */
	catalogRoots: string[];
	/** True when the sibling prompt-kit prompt-editor catalog resolved. */
	promptEditorCatalogPresent: boolean;
	promptEditorModel: string;
	db: KernelDatabase;
	kernel: KernelInstance<unknown>;
	closeDatabase: () => void;
}

function resolveAgainst(base: string, path: string): string {
	return isAbsolute(path) ? path : resolve(base, path);
}

/**
 * Read .agent-kernel/kernel.json. The manifest is repo-owned; a missing file
 * is tolerated (the fallback defaults match the manifest's contract), but the
 * degradation is logged loudly so a misplaced checkout is diagnosable.
 */
async function readCoreManifest(
	rootDir: string,
): Promise<ReadKernelManifest | undefined> {
	const manifest = await readKernelManifest(rootDir);
	if (!manifest) {
		console.error(
			`core-harness: kernel manifest not found at ${join(rootDir, ".agent-kernel/kernel.json")}; `
				+ `booting on contract defaults (kernelId ${KERNEL_ID}, catalog root ${join(rootDir, "catalog")}, `
				+ `db ${kernelDatabasePath(rootDir)}). Write the manifest to make this kernel discoverable.`,
		);
		return undefined;
	}
	if (manifest.kernelId !== KERNEL_ID) {
		console.warn(
			`core-harness: manifest kernelId ${JSON.stringify(manifest.kernelId)} differs from expected `
				+ `${JSON.stringify(KERNEL_ID)}; using the manifest's id.`,
		);
	}
	return manifest;
}

export async function bootCoreKernel(
	options: CoreKernelBootOptions = {},
): Promise<CoreKernelBoot> {
	const rootDir = resolve(options.rootDir ?? REPO_ROOT);
	const manifest = await readCoreManifest(rootDir);
	const kernelRoot = manifest?.kernelRoot
		? resolveAgainst(rootDir, manifest.kernelRoot)
		: join(rootDir, ".agent-kernel");
	// Contract: a relative manifest dbPath (e.g. "trace.db") lives under the
	// kernel root, matching kernelDatabasePath's .agent-kernel/trace.db.
	const dbPath = resolve(
		options.dbPath
			?? (manifest?.dbPath
				? resolveAgainst(kernelRoot, manifest.dbPath)
				: kernelDatabasePath(rootDir)),
	);
	const piSessionsDir = manifest?.piSessionsDir
		? resolveAgainst(rootDir, manifest.piSessionsDir)
		: join(kernelRoot, "pi-sessions");
	const piAgentDir = resolve(
		options.piAgentDir
			?? Bun.env.CORE_HARNESS_PI_AGENT_DIR
			?? DEFAULT_PI_AGENT_DIR,
	);
	const catalogRoots = (
		manifest?.catalogRoots ?? [GENERIC_CATALOG_ROOT]
	).map((root) => resolveAgainst(rootDir, root));
	const promptEditorModel =
		options.promptEditorModel
			?? Bun.env.CORE_HARNESS_PROMPT_EDITOR_MODEL
			?? DEFAULT_PROMPT_EDITOR_MODEL;
	// The generic context-editor bundle declares model "context-editor"; same
	// local codex-lb model unless overridden.
	const contextEditorModel =
		options.contextEditorModel
			?? Bun.env.CORE_HARNESS_CONTEXT_EDITOR_MODEL
			?? promptEditorModel;
	// The generic docs-writer bundle declares model "docs-writer"; same local
	// codex-lb model unless overridden.
	const docsWriterModel =
		options.docsWriterModel
			?? Bun.env.CORE_HARNESS_DOCS_WRITER_MODEL
			?? promptEditorModel;

	const missingRoots = catalogRoots.filter((root) => !existsSync(root));
	if (missingRoots.length > 0) {
		throw new Error(
			`core-harness catalog root${missingRoots.length === 1 ? "" : "s"} not found: ${missingRoots.join(", ")}`,
		);
	}

	const promptEditorCatalogPresent = existsSync(PROMPT_EDITOR_CATALOG_DIR);
	if (!promptEditorCatalogPresent) {
		console.warn(
			`core-harness: prompt-editor catalog not found at ${PROMPT_EDITOR_CATALOG_DIR}; `
				+ "prompt-edit sessions will not resolve the prompt-editor agent "
				+ "(standalone checkout without the sibling prompt-kit repo).",
		);
	}
	/**
	 * Registry roots for createKernel: the browseable roots plus, when
	 * present, the shared prompt-editor bundle — resolvable for edit-session
	 * spawns and detail reads, omitted from the browseable agent list.
	 */
	const kernelCatalogRoots: CatalogRootSpec[] = promptEditorCatalogPresent
		? [...catalogRoots, { path: PROMPT_EDITOR_CATALOG_DIR, listed: false }]
		: [...catalogRoots];

	mkdirSync(piSessionsDir, { recursive: true });

	const database = openKernelDatabase({ path: dbPath });
	let kernel: KernelInstance<unknown> | null = null;
	try {
		await ensureKernelObservabilitySchema(database.db);
		// No writeKernelManifest here: .agent-kernel/kernel.json is repo-owned.

		kernel = createKernel({
			id: manifest?.kernelId ?? KERNEL_ID,
			db: database.db,
			catalog: { roots: kernelCatalogRoots },
			models: {
				aliases: {
					"prompt-editor": promptEditorModel,
					"context-editor": contextEditorModel,
					"docs-writer": docsWriterModel,
				},
			},
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
			kernelId: manifest?.kernelId ?? KERNEL_ID,
			dbPath,
			piSessionsDir,
			piAgentDir,
			catalogRoots,
			promptEditorCatalogPresent,
			promptEditorModel,
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
