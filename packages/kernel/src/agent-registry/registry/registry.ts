import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAgentFile } from "../parsing/frontmatter-parser";
import { harvestPrivateToolNamesFromPath } from "./harvest-private-tool-names";
import type { AgentDefinition, AgentRegistry } from "./types";
import { RegistryError } from "./types";
import { validateVariables } from "./validate-variables";

function collectAgentFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectAgentFiles(full));
		} else if (entry.name === "agent.md") {
			results.push(full);
		}
	}
	return results.sort();
}

interface LoadOne {
	def: AgentDefinition | null;
	error: RegistryError | null;
}

async function loadOne(agentFilePath: string): Promise<LoadOne> {
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
				contextModulePath,
				indexModulePath,
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

	const agentFiles = collectAgentFiles(catalogRootAbs);
	const errors: RegistryError[] = [];
	const loaded: AgentDefinition[] = [];

	for (const filePath of agentFiles) {
		const { def, error } = await loadOne(filePath);
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
					`name collision: '${name}' declared by multiple agent.md files: ${paths}`,
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
