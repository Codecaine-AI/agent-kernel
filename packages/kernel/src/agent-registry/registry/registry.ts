import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	renderXmlMarkdown,
	validatePrompt,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import { isTypedAgentDefinition, type TypedAgentDefinition } from "../../agent-definition";
import { parseAgentFile } from "../parsing/frontmatter-parser";
import {
	harvestPrivateToolNamesFromPath,
	harvestPrivateToolNamesFromRegister,
} from "./harvest-private-tool-names";
import type { AgentDefinition, AgentRegistry } from "./types";
import { RegistryError } from "./types";
import { validateVariables } from "./validate-variables";

type AgentCatalogEntry =
	| { kind: "typed"; filePath: string }
	| { kind: "markdown"; filePath: string };

function collectAgentEntries(dir: string): AgentCatalogEntry[] {
	const results: AgentCatalogEntry[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectAgentEntries(full));
		} else if (entry.name === "agent.ts") {
			results.push({ kind: "typed", filePath: full });
		} else if (entry.name === "agent.md") {
			results.push({ kind: "markdown", filePath: full });
		}
	}
	return results.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

interface LoadOne {
	def: AgentDefinition | null;
	error: RegistryError | null;
}

async function importTypedAgent(
	agentFilePath: string,
): Promise<TypedAgentDefinition> {
	const imported = await import(pathToFileURL(agentFilePath).href);
	const candidate = imported.default ?? imported.agent;
	if (!isTypedAgentDefinition(candidate)) {
		throw new Error(`agent.ts must default-export defineAgent(...): ${agentFilePath}`);
	}
	return candidate;
}

function isPromptDocument(value: unknown): value is PromptDocument {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { kind?: unknown }).kind === "prompt"
	);
}

async function loadTypedOne(agentFilePath: string): Promise<LoadOne> {
	const agentDir = dirname(agentFilePath);
	const contextFileAbs = join(agentDir, "context.ts");
	const toolsFileAbs = join(agentDir, "tools.ts");
	try {
		const typed = await importTypedAgent(agentFilePath);
		const variables = typed.variables ?? {};
		const promptValidation = isPromptDocument(typed.prompt)
			? validatePrompt(typed.prompt, {
					declaredVariables: Object.keys(variables),
				})
			: { ok: true, diagnostics: [] };
		const errors = promptValidation.diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		);
		if (errors.length > 0) {
			return {
				def: null,
				error: new RegistryError(
					agentFilePath,
					errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
				),
			};
		}

		const privateTools = typed.tools ?? null;
		const privateToolNames = privateTools
			? await harvestPrivateToolNamesFromRegister(privateTools)
			: [];
		const coreTools = typed.coreTools ?? [];
		const tools = [...new Set([...coreTools, ...privateToolNames])];
		const body = isPromptDocument(typed.prompt)
			? renderXmlMarkdown(typed.prompt)
			: typed.prompt;
		const parsed = {
			frontmatter: {
				name: typed.name,
				description: typed.description,
				model: typed.model,
				tools,
				disallowed_tools: typed.disallowedTools ?? [],
				extensions: typed.extensions ?? true,
				can_spawn_subagent: typed.canSpawnSubagent ?? false,
				variables,
				max_turns: typed.maxTurns,
				run_in_background: typed.runInBackground ?? false,
				thinking: typed.thinking,
			},
			body,
		};
		const result = validateVariables(parsed.body, parsed.frontmatter.variables);

		if (result.missingDeclarations.length > 0) {
			const violations = result.missingDeclarations.map(
				(v) => `undeclared variable reference: {{${v}}}`,
			);
			return { def: null, error: new RegistryError(agentFilePath, violations) };
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
				name: typed.name,
				parsed,
				source: "typed",
				typedDefinition: typed,
				contextResolver: typed.context ?? null,
				contextModulePath: existsSync(contextFileAbs) ? contextFileAbs : null,
				toolsModulePath: existsSync(toolsFileAbs) ? toolsFileAbs : null,
				indexModulePath: null,
				privateTools,
				privateToolNames,
				coreTools,
				agentFile: agentFilePath,
				warnings,
			},
			error: null,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { def: null, error: new RegistryError(agentFilePath, [msg]) };
	}
}

async function loadMarkdownOne(agentFilePath: string): Promise<LoadOne> {
	const agentDir = dirname(agentFilePath);
	const contextFileAbs = join(agentDir, "context.ts");
	const indexFileAbs = join(agentDir, "index.ts");
	try {
		const parsed = parseAgentFile(agentFilePath, agentDir);
		const result = validateVariables(parsed.body, parsed.frontmatter.variables);

		if (result.missingDeclarations.length > 0) {
			const violations = result.missingDeclarations.map(
				(v) => `undeclared variable reference: {{${v}}}`,
			);
			return { def: null, error: new RegistryError(agentFilePath, violations) };
		}

		const contextModulePath = existsSync(contextFileAbs) ? contextFileAbs : null;
		const indexModulePath = existsSync(indexFileAbs) ? indexFileAbs : null;

		if (indexModulePath) {
			const registered = await harvestPrivateToolNamesFromPath(indexModulePath);
			const declared = new Set(parsed.frontmatter.tools ?? []);
			const undeclared = registered.filter((n) => !declared.has(n));
			if (undeclared.length > 0) {
				const violations = undeclared.map(
					(n) =>
						`private tool '${n}' registered by index.ts but not declared in frontmatter tools:`,
				);
				return { def: null, error: new RegistryError(agentFilePath, violations) };
			}
		}

		const warnings = result.unusedDeclarations.map(
			(v) => `unused variable declaration: ${v}`,
		);

		return {
			def: {
				name: parsed.frontmatter.name,
				parsed,
				source: "markdown",
				typedDefinition: null,
				contextResolver: null,
				contextModulePath,
				toolsModulePath: null,
				indexModulePath,
				privateTools: null,
				privateToolNames: [],
				coreTools: parsed.frontmatter.tools ?? [],
				agentFile: agentFilePath,
				warnings,
			},
			error: null,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { def: null, error: new RegistryError(agentFilePath, [msg]) };
	}
}

async function loadOne(entry: AgentCatalogEntry): Promise<LoadOne> {
	return entry.kind === "typed"
		? loadTypedOne(entry.filePath)
		: loadMarkdownOne(entry.filePath);
}

export interface BuildRegistryOptions {
	catalogRoot: string;
}

export async function buildRegistry(
	opts: BuildRegistryOptions,
): Promise<AgentRegistry> {
	const catalogRootAbs = opts.catalogRoot;
	if (!existsSync(catalogRootAbs)) {
		throw new Error(`agent catalog root not found at ${catalogRootAbs}`);
	}

	const agentFiles = collectAgentEntries(catalogRootAbs);
	const errors: RegistryError[] = [];
	const loaded: AgentDefinition[] = [];

	for (const entry of agentFiles) {
		const { def, error } = await loadOne(entry);
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
			const paths = group.map((d) => d.agentFile).join(", ");
			errors.push(
				new RegistryError(group[0].agentFile, [
					`name collision: '${name}' declared by multiple agent definition files: ${paths}`,
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
		catalogRoot: () => catalogRootAbs,
	};
}

export function catalogDirExists(catalogRoot: string): boolean {
	return existsSync(catalogRoot) && statSync(catalogRoot).isDirectory();
}
