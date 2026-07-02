import type { RuntimeState } from "../../context";
import type { AgentFrontmatter, ParsedAgent } from "../types";
import {
	AgentVariableError,
	type ResolvedVariables,
	resolveVariables,
} from "./resolve-variables";

export interface ResolvedAgent {
	parsed: ParsedAgent;
	frontmatter: AgentFrontmatter;
	resolvedBody: string;
	systemPrompt: string;
	variables: ResolvedVariables;
	/** Content address of the canonical prompt.json this prompt renders (D72). */
	promptHash?: string;
}

export interface ResolveAgentInput {
	parsed: ParsedAgent;
	callerVariables?: Record<string, unknown>;
	runtime: RuntimeState;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function stringifyVars(vars: ResolvedVariables): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, val] of Object.entries(vars)) {
		out[key] = val == null ? "" : String(val);
	}
	return out;
}

function substituteBody(text: string, map: Record<string, string>): string {
	return text.replace(PLACEHOLDER, (full, key) =>
		key in map ? map[key] : full,
	);
}

function collectUnresolvedPlaceholders(
	text: string,
	allowedKeys: Set<string>,
): string[] {
	const leftovers = new Set<string>();
	for (const m of text.matchAll(PLACEHOLDER)) {
		if (!allowedKeys.has(m[1])) leftovers.add(m[1]);
	}
	return [...leftovers].sort();
}

export function resolveSystemPrompt(input: ResolveAgentInput): ResolvedAgent {
	const { parsed, runtime } = input;
	const variables = resolveVariables(
		parsed.frontmatter.variables ?? {},
		input.callerVariables,
	);

	const substitutionMap: Record<string, string> = {
		cwd: runtime.cwd,
		platform: runtime.platform ?? process.platform,
		...stringifyVars(variables),
	};

	const substitutedBody = substituteBody(parsed.body, substitutionMap);

	const allowed = new Set(Object.keys(substitutionMap));
	const leftovers = collectUnresolvedPlaceholders(substitutedBody, allowed);
	if (leftovers.length > 0) {
		throw new AgentVariableError(
			`Unresolved placeholders in agent body: ${leftovers.join(", ")}`,
			{ code: "UNRESOLVED_PLACEHOLDER", placeholders: leftovers },
		);
	}

	const systemPrompt = substitutedBody.trim();

	return {
		parsed: { ...parsed, body: substitutedBody },
		frontmatter: parsed.frontmatter,
		resolvedBody: substitutedBody,
		systemPrompt,
		variables,
		promptHash: parsed.promptHash,
	};
}
