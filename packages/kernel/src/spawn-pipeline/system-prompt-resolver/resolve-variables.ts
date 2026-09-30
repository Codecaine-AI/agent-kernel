import type { VariableDeclaration } from "../types";

export type VariableSchema = Record<string, VariableDeclaration>;
export type ResolvedVariables = Record<string, unknown>;

export type AgentVariableErrorCode =
	| "UNKNOWN_VARIABLES"
	| "UNRESOLVED_PLACEHOLDER"
	| "MISSING_REQUIRED_VARIABLES";

export class AgentVariableError extends Error {
	readonly code: AgentVariableErrorCode;
	readonly unknown?: string[];
	readonly placeholders?: string[];
	readonly missing?: string[];

	constructor(
		message: string,
		opts: {
			code: AgentVariableErrorCode;
			unknown?: string[];
			placeholders?: string[];
			missing?: string[];
		},
	) {
		super(message);
		this.name = "AgentVariableError";
		this.code = opts.code;
		this.unknown = opts.unknown;
		this.placeholders = opts.placeholders;
		this.missing = opts.missing;
	}
}

/**
 * Resolve declared variables against caller values: a caller value wins, then
 * the declared `default`. A variable declared `required: true` that resolves
 * to undefined or null throws MISSING_REQUIRED_VARIABLES (a `default`
 * satisfies it). Every other variable may resolve to undefined, which renders
 * as the empty string; `optional` is a documentation flag for that default.
 */
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

	const missing = Object.entries(schema ?? {})
		.filter(([key, decl]) => decl.required === true && resolved[key] == null)
		.map(([key]) => key)
		.sort();
	if (missing.length > 0) {
		throw new AgentVariableError(
			`Missing required variables: ${missing.join(", ")}`,
			{ code: "MISSING_REQUIRED_VARIABLES", missing },
		);
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
