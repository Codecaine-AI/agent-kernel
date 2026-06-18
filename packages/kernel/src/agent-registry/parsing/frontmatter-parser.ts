/**
 * Frontmatter parser for agent .md files.
 *
 * Extracts the `---`-fenced YAML block, validates required fields,
 * normalizes optional entries, and returns a typed ParsedAgent.
 */

import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AgentFrontmatter,
	ParsedAgent,
	VariableDeclaration,
} from "./types";

function extractFrontmatterBlock(content: string): { yaml: string; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		throw new Error("No frontmatter block found - agent files must start with ---");
	}
	return { yaml: match[1], body: match[2].trim() };
}

function parseVariables(raw: unknown): Record<string, VariableDeclaration> {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Frontmatter `variables` must be a mapping of name -> { default, description? }");
	}
	const out: Record<string, VariableDeclaration> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`Frontmatter variable '${key}' must be an object with a \`default\` key`);
		}
		const entry = value as Record<string, unknown>;
		if (!("default" in entry)) {
			throw new Error(`Frontmatter variable '${key}' missing required \`default\` key`);
		}
		const decl: VariableDeclaration = { default: entry.default };
		if (entry.description !== undefined) {
			decl.description = String(entry.description);
		}
		out[key] = decl;
	}
	return out;
}

export function parseFrontmatter(content: string): ParsedAgent {
	const { yaml: yamlBlock, body } = extractFrontmatterBlock(content);
	const raw = load(yamlBlock) as Record<string, unknown>;

	const required = ["name", "description", "model", "tools"] as const;
	for (const field of required) {
		if (raw[field] === undefined || raw[field] === null) {
			throw new Error(`Frontmatter missing required field: ${field}`);
		}
	}

	const rawExtensions = raw.extensions;
	let extensions: true | string[] | false = true;
	if (rawExtensions === false || rawExtensions === "false") {
		extensions = false;
	} else if (Array.isArray(rawExtensions)) {
		extensions = rawExtensions.map(String);
	}

	const frontmatter: AgentFrontmatter = {
		name: String(raw.name),
		description: String(raw.description),
		model: String(raw.model),
		tools: (raw.tools as string[]) ?? [],
		disallowed_tools: (raw.disallowed_tools as string[]) ?? [],
		extensions,
		can_spawn_subagent: Boolean(raw.can_spawn_subagent ?? false),
		variables: parseVariables(raw.variables),
		max_turns: raw.max_turns != null ? Number(raw.max_turns) : undefined,
		run_in_background: Boolean(raw.run_in_background ?? false),
		thinking: raw.thinking != null ? String(raw.thinking) : undefined,
	};

	return { frontmatter, body };
}

export function parseAgentFile(filePath: string, cwd: string): ParsedAgent {
	const fullPath = resolve(cwd, filePath);
	const content = readFileSync(fullPath, "utf-8");
	return parseFrontmatter(content);
}
