/**
 * Bundle layout resolution — the file-or-folder discovery contract.
 *
 * An agent bundle is `agent.json` plus four sections, each of which may be a
 * single file (the scale-down form) or a folder with an `index.ts` entry
 * point (the vertical-slice form from the bundle-tree design):
 *
 *   catalog/<agent>/
 *     agent.json          the index
 *     prompt.json    | prompt/prompt.json     section ① — SOURCE OF TRUTH
 *                      prompt/system.md       generated md render, ignored here
 *     context.ts     | context/index.ts       section ②
 *     tools.ts       | tools/index.ts         the action surface
 *     state.ts       | state/index.ts         section ③
 *
 * Resolution order is always file-first, then folder. When both forms exist
 * the file wins *silently* — that is what lets a migration leave a one-line
 * re-export shim at the old path. `doctor` surfaces the shadowed path as a
 * warning; the registry does not.
 *
 * Folder internals are unconstrained: `index.ts` is the only entry point the
 * registry looks at, and every other file inside a section folder (including
 * `prompt/system.md`) is invisible to discovery.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Which of the two legal shapes a bundle section resolved to. */
export type BundleEntryForm = "file" | "folder";

/** The three code sidecars that follow the `<kind>.ts` / `<kind>/index.ts` rule. */
export type BundleSidecarKind = "context" | "tools" | "state";

/** Every section of a bundle, including the prompt. */
export type BundleSection = "prompt" | BundleSidecarKind;

export interface ResolvedBundleEntry {
	/** Absolute path of the resolved entry point, or null when the section is absent. */
	path: string | null;
	/** Which form resolved, or null when the section is absent. */
	form: BundleEntryForm | null;
	/**
	 * The losing path when both forms are present on disk. Resolution ignores
	 * it (file always wins); doctor reports it so a stale shim is visible.
	 */
	shadowedPath: string | null;
}

/** The resolved form of each section of one bundle. */
export interface AgentBundleLayout {
	/** Absolute path of the bundle directory (the agent.json's parent). */
	dir: string;
	prompt: ResolvedBundleEntry;
	context: ResolvedBundleEntry;
	tools: ResolvedBundleEntry;
	state: ResolvedBundleEntry;
}

const ABSENT: ResolvedBundleEntry = { path: null, form: null, shadowedPath: null };

export const MANIFEST_FILE_NAME = "agent.json";
export const PROMPT_FILE_NAME = "prompt.json";
export const SECTION_ENTRY_FILE_NAME = "index.ts";
/** The generated markdown render of prompt.json inside a `prompt/` folder. */
export const PROMPT_SYSTEM_MD_NAME = "system.md";
/** The generated markdown render beside a flat `prompt.json`. */
export const PROMPT_RENDERED_MD_NAME = "prompt.rendered.md";

function resolveEntry(fileForm: string, folderForm: string): ResolvedBundleEntry {
	const fileExists = existsSync(fileForm);
	const folderExists = existsSync(folderForm);
	if (fileExists) {
		return {
			path: fileForm,
			form: "file",
			shadowedPath: folderExists ? folderForm : null,
		};
	}
	if (folderExists) {
		return { path: folderForm, form: "folder", shadowedPath: null };
	}
	return ABSENT;
}

/**
 * Locate section ①: `<dir>/prompt.json` first, then `<dir>/prompt/prompt.json`.
 * `prompt/system.md` is never consulted — it is a generated read-only render.
 */
export function resolvePromptEntry(agentDir: string): ResolvedBundleEntry {
	return resolveEntry(
		join(agentDir, PROMPT_FILE_NAME),
		join(agentDir, "prompt", PROMPT_FILE_NAME),
	);
}

/**
 * Locate a code sidecar: `<dir>/<kind>.ts` first, then `<dir>/<kind>/index.ts`.
 */
export function resolveSidecarEntry(
	agentDir: string,
	kind: BundleSidecarKind,
): ResolvedBundleEntry {
	return resolveEntry(
		join(agentDir, `${kind}.ts`),
		join(agentDir, kind, SECTION_ENTRY_FILE_NAME),
	);
}

/** Resolve all four sections of one bundle directory. */
export function resolveBundleLayout(agentDir: string): AgentBundleLayout {
	return {
		dir: agentDir,
		prompt: resolvePromptEntry(agentDir),
		context: resolveSidecarEntry(agentDir, "context"),
		tools: resolveSidecarEntry(agentDir, "tools"),
		state: resolveSidecarEntry(agentDir, "state"),
	};
}

/**
 * Where the generated markdown render of a prompt.json belongs:
 * `<dir>/prompt/system.md` in folder form, `<dir>/prompt.rendered.md` in file
 * form. Derived from the resolved prompt path so both forms round-trip.
 */
export function renderedPromptPathFor(promptFile: string): string {
	const promptDir = dirname(promptFile);
	return basename(promptDir) === "prompt"
		? join(promptDir, PROMPT_SYSTEM_MD_NAME)
		: join(promptDir, PROMPT_RENDERED_MD_NAME);
}

/** Recursively collect every `agent.json` under a catalog root, sorted. */
export function collectManifestFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectManifestFiles(full));
		} else if (entry.name === MANIFEST_FILE_NAME) {
			results.push(full);
		}
	}
	return results.sort((a, b) => a.localeCompare(b));
}

/** The bundle directories (agent.json parents) under a catalog root, sorted. */
export function collectBundleDirs(root: string): string[] {
	return collectManifestFiles(root).map((file) => dirname(file));
}

/** The sections of a layout, in tree order, as (section, entry) pairs. */
export function bundleSections(
	layout: AgentBundleLayout,
): Array<[BundleSection, ResolvedBundleEntry]> {
	return [
		["prompt", layout.prompt],
		["context", layout.context],
		["tools", layout.tools],
		["state", layout.state],
	];
}
