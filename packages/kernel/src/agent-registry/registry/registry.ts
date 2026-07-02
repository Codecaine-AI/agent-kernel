/**
 * Agent registry — discovers agent directories by their `agent.json`
 * manifest (D76). Each agent bundle is two data files plus two optional code
 * sidecars attached by filename convention:
 *
 *   agent-catalog/<agent-name>/
 *     agent.json           manifest (JSON-Schema validated)
 *     prompt.json          canonical PromptDocument (D70)
 *     prompt.rendered.md   derived snapshot
 *     context.ts           optional context sidecar
 *     tools.ts             optional private-tools sidecar
 *
 * Boot fails with an AggregateError of per-agent RegistryErrors.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	hashPrompt,
	renderXmlMarkdown,
	validatePrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

import {
	normalizeAgentManifest,
	validateAgentManifestShape,
	type AgentManifest,
	type AgentPrivateTools,
	type NormalizedAgentManifest,
} from "../../agent-definition";
import type { AgentContextResolver } from "../../context";
import { harvestPrivateToolNamesFromRegister } from "./harvest-private-tool-names";
import type { AgentDefinition, AgentRegistry } from "./types";
import { RegistryError } from "./types";
import { validateVariables } from "./validate-variables";

const MANIFEST_FILE_NAME = "agent.json";

function collectManifestFiles(dir: string): string[] {
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

interface LoadOne {
	def: AgentDefinition | null;
	error: RegistryError | null;
}

function loadManifest(manifestFile: string): NormalizedAgentManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RegistryError(manifestFile, [
			`invalid agent.json (parse error): ${msg}`,
		]);
	}
	const shape = validateAgentManifestShape(parsed);
	if (!shape.valid) {
		throw new RegistryError(
			manifestFile,
			shape.errors.map((error) => `invalid agent.json: ${error}`),
		);
	}
	return normalizeAgentManifest(parsed as AgentManifest);
}

interface LoadedPromptJson {
	document: PromptDocument;
	promptFile: string;
}

/**
 * Load and shape-validate the sibling `prompt.json` (the canonical prompt
 * artifact per D70). Throws RegistryError on a missing file, unparseable
 * JSON, or a document that fails the PromptDocument shape check.
 */
function loadPromptJson(manifestFile: string): LoadedPromptJson {
	const agentDir = dirname(manifestFile);
	const promptFile = join(agentDir, "prompt.json");
	if (!existsSync(promptFile)) {
		throw new RegistryError(manifestFile, [
			`missing prompt.json: an agent directory must contain a canonical PromptDocument at ${promptFile}`,
		]);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(promptFile, "utf8"));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RegistryError(manifestFile, [
			`invalid prompt.json (parse error): ${msg}`,
		]);
	}
	const shape = validatePromptDocumentShape(parsed);
	if (!shape.valid) {
		throw new RegistryError(
			manifestFile,
			shape.errors.map((error) => `invalid prompt.json: ${error}`),
		);
	}
	return { document: parsed as PromptDocument, promptFile };
}

/** context.ts sidecar: default export or named `context`, { loaders, assemble }. */
async function importContextSidecar(
	contextModulePath: string,
	manifestFile: string,
): Promise<AgentContextResolver> {
	const imported = (await import(pathToFileURL(contextModulePath).href)) as {
		default?: unknown;
		context?: unknown;
	};
	const candidate = (imported.default ?? imported.context) as
		| Partial<AgentContextResolver>
		| undefined;
	if (
		!candidate ||
		!Array.isArray(candidate.loaders) ||
		typeof candidate.assemble !== "function"
	) {
		throw new RegistryError(manifestFile, [
			`context.ts must export (default or named "context") an object with loaders[] and assemble(): ${contextModulePath}`,
		]);
	}
	return candidate as AgentContextResolver;
}

/** tools.ts sidecar: default export or named `tools`, a register function. */
async function importToolsSidecar(
	toolsModulePath: string,
	manifestFile: string,
): Promise<AgentPrivateTools> {
	const imported = (await import(pathToFileURL(toolsModulePath).href)) as {
		default?: unknown;
		tools?: unknown;
	};
	const candidate = imported.default ?? imported.tools;
	if (typeof candidate !== "function") {
		throw new RegistryError(manifestFile, [
			`tools.ts must export (default or named "tools") a register function: ${toolsModulePath}`,
		]);
	}
	return candidate as AgentPrivateTools;
}

function expandToolProfiles(
	manifest: NormalizedAgentManifest,
	toolProfiles: Record<string, string[]>,
	manifestFile: string,
): string[] {
	const expanded: string[] = [];
	const unknown: string[] = [];
	for (const profileName of manifest.toolProfiles) {
		const profile = toolProfiles[profileName];
		if (!profile) {
			unknown.push(profileName);
			continue;
		}
		expanded.push(...profile);
	}
	if (unknown.length > 0) {
		const known = Object.keys(toolProfiles).sort();
		throw new RegistryError(
			manifestFile,
			unknown.map(
				(name) =>
					`unknown tool profile "${name}" — known profiles: ${known.length ? known.join(", ") : "(none configured)"}`,
			),
		);
	}
	return expanded;
}

async function loadOne(
	manifestFile: string,
	toolProfiles: Record<string, string[]>,
): Promise<LoadOne> {
	const agentDir = dirname(manifestFile);
	const contextFileAbs = join(agentDir, "context.ts");
	const toolsFileAbs = join(agentDir, "tools.ts");
	try {
		const manifest = loadManifest(manifestFile);
		const profileTools = expandToolProfiles(manifest, toolProfiles, manifestFile);
		const { document: promptDocument, promptFile } = loadPromptJson(manifestFile);
		const promptValidation = validatePrompt(promptDocument, {
			declaredVariables: Object.keys(manifest.variables),
		});
		const errors = promptValidation.diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		);
		if (errors.length > 0) {
			return {
				def: null,
				error: new RegistryError(
					manifestFile,
					errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
				),
			};
		}

		const contextModulePath = existsSync(contextFileAbs) ? contextFileAbs : null;
		const toolsModulePath = existsSync(toolsFileAbs) ? toolsFileAbs : null;
		const contextResolver = contextModulePath
			? await importContextSidecar(contextModulePath, manifestFile)
			: null;
		const privateTools = toolsModulePath
			? await importToolsSidecar(toolsModulePath, manifestFile)
			: null;
		const privateToolNames = privateTools
			? await harvestPrivateToolNamesFromRegister(privateTools)
			: [];
		const coreTools = manifest.coreTools;
		const tools = [...new Set([...coreTools, ...profileTools, ...privateToolNames])];
		const body = renderXmlMarkdown(promptDocument);
		const promptHash = hashPrompt(promptDocument);
		const parsed = {
			config: {
				name: manifest.name,
				description: manifest.description,
				model: manifest.model,
				tools,
				disallowedTools: manifest.disallowedTools,
				extensions: manifest.extensions,
				canSpawnSubagent: manifest.canSpawnSubagent,
				variables: manifest.variables,
				maxTurns: manifest.maxTurns,
				runInBackground: manifest.runInBackground,
				thinking: manifest.thinking,
			},
			body,
			promptHash,
		};
		const result = validateVariables(parsed.body, parsed.config.variables);

		if (result.missingDeclarations.length > 0) {
			const violations = result.missingDeclarations.map(
				(v) => `undeclared variable reference: {{${v}}}`,
			);
			return { def: null, error: new RegistryError(manifestFile, violations) };
		}

		const warnings = [
			...promptValidation.diagnostics
				.filter((diagnostic) => diagnostic.severity === "warning")
				.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
			...result.unusedDeclarations.map(
				(v) => `unused variable declaration: ${v}`,
			),
		];

		return {
			def: {
				name: manifest.name,
				parsed,
				manifest,
				promptDocument,
				promptHash,
				promptFile,
				contextResolver,
				contextModulePath,
				privateTools,
				privateToolNames,
				toolsModulePath,
				coreTools,
				manifestFile,
				warnings,
			},
			error: null,
		};
	} catch (err) {
		if (err instanceof RegistryError) {
			return { def: null, error: err };
		}
		const msg = err instanceof Error ? err.message : String(err);
		return { def: null, error: new RegistryError(manifestFile, [msg]) };
	}
}

export interface BuildRegistryOptions {
	/** Catalog roots scanned recursively for agent.json manifests. */
	roots: string[];
	/** Named tool bundles referenced by manifest `toolProfiles` (D76/4b). */
	toolProfiles?: Record<string, string[]>;
}

export async function buildRegistry(
	opts: BuildRegistryOptions,
): Promise<AgentRegistry> {
	const roots = opts.roots;
	if (roots.length === 0) {
		throw new Error("buildRegistry requires at least one catalog root");
	}
	for (const root of roots) {
		if (!existsSync(root)) {
			throw new Error(`agent catalog root not found at ${root}`);
		}
	}

	const manifestFiles = roots.flatMap((root) => collectManifestFiles(root));
	const toolProfiles = opts.toolProfiles ?? {};
	const errors: RegistryError[] = [];
	const loaded: AgentDefinition[] = [];

	for (const manifestFile of manifestFiles) {
		const { def, error } = await loadOne(manifestFile, toolProfiles);
		if (def) loaded.push(def);
		if (error) errors.push(error);
	}

	const byName = new Map<string, AgentDefinition[]>();
	for (const def of loaded) {
		const group = byName.get(def.name) ?? [];
		group.push(def);
		byName.set(def.name, group);
	}

	const defs = new Map<string, AgentDefinition>();
	for (const [name, group] of byName) {
		if (group.length > 1) {
			const paths = group.map((d) => d.manifestFile).join(", ");
			errors.push(
				new RegistryError(group[0].manifestFile, [
					`name collision: '${name}' declared by multiple agent manifests: ${paths}`,
				]),
			);
		} else {
			defs.set(name, group[0]);
		}
	}

	if (errors.length > 0) {
		throw new AggregateError(
			errors,
			`Agent registry validation failed (${errors.length} agent(s))`,
		);
	}

	return {
		get(name: string): AgentDefinition {
			const def = defs.get(name);
			if (!def) throw new Error(`Agent not found in registry: ${name}`);
			return def;
		},
		tryGet(name: string): AgentDefinition | null {
			return defs.get(name) ?? null;
		},
		list(): AgentDefinition[] {
			return [...defs.values()];
		},
		roots: () => [...roots],
	};
}

export function catalogDirExists(catalogRoot: string): boolean {
	return existsSync(catalogRoot) && statSync(catalogRoot).isDirectory();
}
