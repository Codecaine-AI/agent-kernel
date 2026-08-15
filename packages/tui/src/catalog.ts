/**
 * catalog.ts — multi-root agent resolution with precedence.
 *
 * Mirrors pi's global→project settings rule applied to agent catalogs
 * (docs/.drafts/tui-harness.design.md): resolve(name) over
 *
 *   [ cwd-walk .agent-kernel/kernel.json catalogRoots…,     (project layer)
 *     generic catalog at <agent-kernel repo>/catalog/ ]     (generic layer)
 *
 * A project bundle SHADOWS a generic one of the same name. buildRegistry
 * rejects same-name manifests inside one call (a real collision), so each
 * layer gets its own registry and precedence is resolved here, across layers.
 * A layer that fails to build (invalid bundle, missing root) degrades to a
 * warning instead of taking down resolution for the other layer.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The db-free sub-barrel, NOT `…/agent-registry`: pi runs extensions under
// Node, and the parent barrel re-exports register-prompt-revisions.ts, whose
// @agent-kernel/db import evaluates bun:sqlite at load.
import {
	buildRegistry,
	collectManifestFiles,
	RegistryError,
	type AgentDefinition,
	type AgentRegistry,
} from "@agent-kernel/kernel/agent-registry/registry";

export type CatalogSource = "project" | "generic";

/** A bundle the layer could not load — kept visible instead of vanishing. */
export interface UnavailableBundle {
	name: string;
	dir: string;
	source: CatalogSource;
	/** One-line cause, not a stack trace. */
	reason: string;
}

/**
 * A bundle declared (or defaulted, host absent) `host: "app"`: it runs only
 * in its owning app harness. Classified from the manifest JSON alone — its
 * sidecars are never evaluated here.
 */
export interface AppHostedBundle {
	name: string;
	dir: string;
	source: CatalogSource;
	description: string;
}

export const APP_HOSTED_REASON = "app-harness agent (runs in its owning harness)";

export interface CatalogLayer {
	source: CatalogSource;
	roots: string[];
	registry: AgentRegistry | null;
	/** Manifest-classified app-harness bundles (sidecars not evaluated). */
	appHosted: AppHostedBundle[];
	/** host:"any" bundles excluded from this layer's registry, with reasons. */
	unavailable: UnavailableBundle[];
	/** Whole-layer failure (e.g. missing root); null when the layer loaded. */
	error: string | null;
}

export interface LoadedCatalog {
	layers: CatalogLayer[];
	/** The kernel.json that supplied the project layer, when one was found. */
	projectKernelFile: string | null;
	warnings: string[];
}

export interface CatalogAgent {
	name: string;
	description: string;
	model: string;
	source: CatalogSource;
	def: AgentDefinition;
}

export interface ResolvedCatalogAgent {
	def: AgentDefinition;
	source: CatalogSource;
}

export interface CatalogOptions {
	/**
	 * Override for the generic catalog root. Defaults to `catalog/` at the
	 * agent-kernel repo root, located from this package's own position in the
	 * checkout. Pass null to disable the generic layer (tests).
	 */
	genericRoot?: string | null;
}

export interface GenericCatalogLocation {
	root: string | null;
	/** Why resolution failed, when it did — surfaced instead of silence. */
	unavailableReason: string | null;
}

/**
 * Locate this module's own directory across runtimes: bun and Node ESM have
 * import.meta.url; pi's jiti CJS transform shims it, but a transform that
 * drops it still defines __dirname. Both failing is reported, not swallowed.
 */
function packageSrcDir(): { dir: string | null; reason: string | null } {
	try {
		const url = import.meta.url;
		if (typeof url === "string" && url.startsWith("file:")) {
			return { dir: dirname(fileURLToPath(url)), reason: null };
		}
	} catch {
		// import.meta unavailable under this transform — fall through.
	}
	if (typeof __dirname === "string" && __dirname.length > 0) {
		return { dir: __dirname, reason: null };
	}
	return {
		dir: null,
		reason:
			"cannot locate @agent-kernel/tui's own directory under this module runtime (no import.meta.url, no __dirname)",
	};
}

/** `<agent-kernel repo>/catalog` — this package lives at packages/tui/src. */
export function locateGenericCatalog(): GenericCatalogLocation {
	const { dir, reason } = packageSrcDir();
	if (!dir) return { root: null, unavailableReason: reason };
	return { root: resolve(dir, "..", "..", "..", "catalog"), unavailableReason: null };
}

export function defaultGenericCatalogRoot(): string | null {
	return locateGenericCatalog().root;
}

/** Walk up from `cwd` to the nearest `.agent-kernel/kernel.json`. */
export function findProjectKernelFile(cwd: string): string | null {
	let dir = resolve(cwd);
	for (;;) {
		const candidate = join(dir, ".agent-kernel", "kernel.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Read a kernel.json's catalogRoots. Existing kernels write absolute paths
 * (canvas, simple-research-kernel); relative entries resolve against the
 * project directory (the parent of `.agent-kernel/`).
 */
export function readCatalogRoots(kernelFile: string): string[] {
	const parsed = JSON.parse(readFileSync(kernelFile, "utf8")) as {
		catalogRoots?: unknown;
	};
	if (!Array.isArray(parsed.catalogRoots)) return [];
	const projectDir = dirname(dirname(kernelFile));
	return parsed.catalogRoots
		.filter((root): root is string => typeof root === "string")
		.map((root) => (isAbsolute(root) ? root : resolve(projectDir, root)));
}

function flattenError(err: unknown): string {
	if (err instanceof AggregateError) {
		return err.errors
			.map((e) => (e instanceof Error ? e.message : String(e)))
			.join("; ");
	}
	return err instanceof Error ? err.message : String(err);
}

/** One-line cause for an unloadable bundle. */
function unavailableReasonOf(err: RegistryError): string {
	const firstLine = (err.violations[0] ?? err.message).split("\n")[0].trim();
	// The known app-coupled signature: a sidecar importing app runtime code
	// that reaches @agent-kernel/db, which needs bun:sqlite (absent under
	// pi's Node runtime). Name the situation instead of echoing the module
	// resolution error.
	if (firstLine.includes("bun:sqlite")) {
		return "unavailable under TUI: sidecar imports app runtime (bun:sqlite) — boot it through its app harness";
	}
	return `unavailable under TUI: ${firstLine}`;
}

function bundleNameOf(manifestFile: string): string {
	try {
		const parsed = JSON.parse(readFileSync(manifestFile, "utf8")) as {
			name?: unknown;
		};
		if (typeof parsed.name === "string" && parsed.name !== "") return parsed.name;
	} catch {
		// unreadable manifest — fall through to the directory name
	}
	return basename(dirname(manifestFile));
}

interface ManifestPeek {
	name: string;
	description: string;
	host: unknown;
}

/** Cheap manifest read for classification — null means "let the registry try". */
function peekManifest(manifestFile: string): ManifestPeek | null {
	try {
		const parsed = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<
			string,
			unknown
		>;
		return {
			name:
				typeof parsed.name === "string" && parsed.name !== ""
					? parsed.name
					: basename(dirname(manifestFile)),
			description: typeof parsed.description === "string" ? parsed.description : "",
			host: parsed.host,
		};
	} catch {
		return null;
	}
}

/**
 * Build one layer's registry with manifest-first host classification and
 * PER-BUNDLE failure isolation.
 *
 * Classification runs first, off the manifest JSON alone: `host: "app"` (or
 * absent — the default) bundles never get their sidecars evaluated; they list
 * as app-harness agents. Only `host: "any"` bundles reach buildRegistry (an
 * unreadable manifest or an invalid host value also goes through, so the
 * registry reports the real validation error).
 *
 * buildRegistry is all-or-nothing (one AggregateError of RegistryErrors), so
 * isolation works by exclude-and-retry to a fixpoint over the candidates. The
 * retry keeps cross-bundle validation (name collisions, spawner targets) live
 * over the survivors — an exclusion that breaks a dependent bundle simply
 * excludes that bundle on the next pass, with its own recorded reason.
 */
async function buildLayer(
	source: CatalogSource,
	roots: string[],
): Promise<CatalogLayer> {
	let manifests: string[];
	try {
		manifests = roots.flatMap((root) => collectManifestFiles(root));
	} catch (err) {
		return {
			source,
			roots,
			registry: null,
			appHosted: [],
			unavailable: [],
			error: flattenError(err),
		};
	}

	const appHosted: AppHostedBundle[] = [];
	const candidates: string[] = [];
	for (const manifestFile of manifests) {
		const peek = peekManifest(manifestFile);
		if (peek && (peek.host === undefined || peek.host === "app")) {
			appHosted.push({
				name: peek.name,
				dir: dirname(manifestFile),
				source,
				description: peek.description,
			});
			continue;
		}
		candidates.push(manifestFile);
	}

	const unavailable: UnavailableBundle[] = [];
	let candidateRoots = candidates.map((manifest) => dirname(manifest));
	// Each failed pass excludes ≥1 manifest, so passes are bounded.
	for (let pass = 0; pass <= candidates.length; pass++) {
		if (candidateRoots.length === 0) {
			return { source, roots, registry: null, appHosted, unavailable, error: null };
		}
		try {
			const registry = await buildRegistry({ roots: candidateRoots });
			return { source, roots, registry, appHosted, unavailable, error: null };
		} catch (err) {
			if (!(err instanceof AggregateError)) {
				return {
					source,
					roots,
					registry: null,
					appHosted,
					unavailable,
					error: flattenError(err),
				};
			}
			const failed = err.errors.filter(
				(e): e is RegistryError => e instanceof RegistryError,
			);
			if (failed.length === 0) {
				return {
					source,
					roots,
					registry: null,
					appHosted,
					unavailable,
					error: flattenError(err),
				};
			}
			for (const registryError of failed) {
				if (unavailable.some((u) => u.dir === dirname(registryError.agentFile))) {
					continue;
				}
				unavailable.push({
					name: bundleNameOf(registryError.agentFile),
					dir: dirname(registryError.agentFile),
					source,
					reason: unavailableReasonOf(registryError),
				});
			}
			const excludedDirs = new Set(unavailable.map((u) => u.dir));
			candidateRoots = candidates
				.filter((manifest) => !excludedDirs.has(dirname(manifest)))
				.map((manifest) => dirname(manifest));
		}
	}
	return { source, roots, registry: null, appHosted, unavailable, error: null };
}

export async function loadCatalog(
	cwd: string,
	opts: CatalogOptions = {},
): Promise<LoadedCatalog> {
	const warnings: string[] = [];
	const layers: CatalogLayer[] = [];

	const projectKernelFile = findProjectKernelFile(cwd);
	if (projectKernelFile) {
		const declared = readCatalogRoots(projectKernelFile);
		const roots = declared.filter((root) => {
			if (existsSync(root)) return true;
			warnings.push(`catalog root not found (skipped): ${root}`);
			return false;
		});
		if (roots.length > 0) {
			const layer = await buildLayer("project", roots);
			if (layer.error) {
				warnings.push(`project catalog failed to load: ${layer.error}`);
			}
			layers.push(layer);
		}
	}

	let genericRoot = opts.genericRoot ?? null;
	if (opts.genericRoot === undefined) {
		const located = locateGenericCatalog();
		genericRoot = located.root;
		if (located.unavailableReason) {
			warnings.push(`generic catalog unavailable: ${located.unavailableReason}`);
		}
	}
	if (genericRoot && existsSync(genericRoot)) {
		const layer = await buildLayer("generic", [genericRoot]);
		if (layer.error) {
			warnings.push(`generic catalog failed to load: ${layer.error}`);
		}
		layers.push(layer);
	}

	return { layers, projectKernelFile, warnings };
}

export interface AgentListing {
	agents: CatalogAgent[];
	/** Manifest-classified app-harness bundles (never evaluated here). */
	appHosted: AppHostedBundle[];
	/** Bundles that resolve by name but could not load, with one-line reasons. */
	unavailable: UnavailableBundle[];
	/** Layer degradations (failed roots) — show these. */
	warnings: string[];
}

/**
 * Every resolvable agent in precedence order — a project bundle shadows a
 * generic bundle of the same name (the whole specialization mechanism) —
 * plus the warnings that explain any layer that failed to contribute.
 */
export async function listAgentsDetailed(
	cwd: string,
	opts: CatalogOptions = {},
): Promise<AgentListing> {
	const catalog = await loadCatalog(cwd, opts);
	const seen = new Set<string>();
	const agents: CatalogAgent[] = [];
	for (const layer of catalog.layers) {
		if (!layer.registry) continue;
		for (const def of layer.registry.list()) {
			if (seen.has(def.name)) continue;
			seen.add(def.name);
			agents.push({
				name: def.name,
				description: def.manifest.description,
				model: def.manifest.model,
				source: layer.source,
				def,
			});
		}
	}
	// Classified and unavailable bundles stay visible unless a loadable
	// same-name bundle serves the name (a non-bootable project bundle falls
	// through to a loadable generic one — listing both would misread as two
	// agents).
	const appHosted: AppHostedBundle[] = [];
	for (const layer of catalog.layers) {
		for (const entry of layer.appHosted) {
			if (seen.has(entry.name)) continue;
			seen.add(entry.name);
			appHosted.push(entry);
		}
	}
	const unavailable: UnavailableBundle[] = [];
	for (const layer of catalog.layers) {
		for (const entry of layer.unavailable) {
			if (seen.has(entry.name)) continue;
			seen.add(entry.name);
			unavailable.push(entry);
		}
	}
	return {
		agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
		appHosted: appHosted.sort((a, b) => a.name.localeCompare(b.name)),
		unavailable: unavailable.sort((a, b) => a.name.localeCompare(b.name)),
		warnings: catalog.warnings,
	};
}

export async function listAgents(
	cwd: string,
	opts: CatalogOptions = {},
): Promise<CatalogAgent[]> {
	return (await listAgentsDetailed(cwd, opts)).agents;
}

export type AgentResolution =
	| { status: "ok"; def: AgentDefinition; source: CatalogSource }
	| { status: "app-hosted"; name: string; source: CatalogSource; reason: string }
	| { status: "unavailable"; name: string; source: CatalogSource; reason: string }
	| { status: "not-found" };

export async function resolveAgentDetailed(
	name: string,
	cwd: string,
	opts: CatalogOptions = {},
): Promise<AgentResolution> {
	const catalog = await loadCatalog(cwd, opts);
	for (const layer of catalog.layers) {
		const def = layer.registry?.tryGet(name);
		if (def) return { status: "ok", def, source: layer.source };
	}
	// Only after every loadable layer misses: a non-bootable project bundle
	// must not mask a loadable generic bundle of the same name.
	for (const layer of catalog.layers) {
		const entry = layer.appHosted.find((b) => b.name === name);
		if (entry) {
			return {
				status: "app-hosted",
				name: entry.name,
				source: entry.source,
				reason: APP_HOSTED_REASON,
			};
		}
	}
	for (const layer of catalog.layers) {
		const entry = layer.unavailable.find((u) => u.name === name);
		if (entry) {
			return {
				status: "unavailable",
				name: entry.name,
				source: entry.source,
				reason: entry.reason,
			};
		}
	}
	return { status: "not-found" };
}

export async function resolveAgent(
	name: string,
	cwd: string,
	opts: CatalogOptions = {},
): Promise<ResolvedCatalogAgent | null> {
	const resolution = await resolveAgentDetailed(name, cwd, opts);
	return resolution.status === "ok"
		? { def: resolution.def, source: resolution.source }
		: null;
}
