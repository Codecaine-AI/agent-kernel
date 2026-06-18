import type { VariableDeclaration } from "../types";

export type VariableSchema = Record<string, VariableDeclaration>;
export type ResolvedVariables = Record<string, unknown>;

export type AgentVariableErrorCode =
	| "UNKNOWN_VARIABLES"
	| "UNRESOLVED_PLACEHOLDER";

export class AgentVariableError extends Error {
	readonly code: AgentVariableErrorCode;
	readonly unknown?: string[];
	readonly placeholders?: string[];

	constructor(
		message: string,
		opts: {
			code: AgentVariableErrorCode;
			unknown?: string[];
			placeholders?: string[];
		},
	) {
		super(message);
		this.name = "AgentVariableError";
		this.code = opts.code;
		this.unknown = opts.unknown;
		this.placeholders = opts.placeholders;
	}
}

export function resolveVariables(
	schema: VariableSchema,
	callerVars?: Record<string, unknown>,
): ResolvedVariables {
	const resolved: ResolvedVariables = {};

	for (const [key, decl] of Object.entries(schema ?? {})) {
		if (callerVars && callerVars[key] !== undefined) {
			resolved[key] = callerVars[key];
		} else {
			resolved[key] = decl.default;
		}
	}

	if (callerVars) {
		for (const [key, value] of Object.entries(callerVars)) {
			if (!(key in resolved)) {
				resolved[key] = value;
			}
		}
	}

	return resolved;
}
