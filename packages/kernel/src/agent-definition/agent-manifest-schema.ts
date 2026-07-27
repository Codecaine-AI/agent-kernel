/**
 * agent.json manifest schema (D76 — manifest as data).
 *
 * The agent manifest is a pure-data JSON file validated at registry boot.
 * `agentManifestJsonSchema` is the shareable JSON Schema document;
 * `validateAgentManifestShape` is the dependency-free structural check kept in
 * lockstep with it (same style as prompt-kit's validate-shape) so callers do
 * not need a JSON Schema runtime.
 */

export const AGENT_MANIFEST_SCHEMA_ID = "agent-kernel/agent-v1";

export interface AgentManifestShapeResult {
	valid: boolean;
	errors: string[];
}

const TOP_LEVEL_KEYS = new Set([
	"$schema",
	"name",
	"description",
	"model",
	"thinking",
	"maxTurns",
	"coreTools",
	"disallowedTools",
	"extensions",
	"runInBackground",
	"toolProfiles",
	"variables",
	"variants",
	"state",
]);

const VARIABLE_KEYS = new Set(["default", "description", "optional", "required"]);

const STATE_KEYS = new Set(["window"]);

const WINDOW_KEYS = new Set([
	"strategy",
	"maxTurns",
	"maxTokens",
	"charsPerToken",
	"imageTokens",
	"maxImages",
	"elisionMarker",
]);

const WINDOW_STRATEGIES = new Set(["turns", "token-budget"]);

const VARIANT_KEYS = new Set([
	"model",
	"thinking",
	"maxTurns",
	"runInBackground",
	"displayLabel",
]);

/** Shareable JSON Schema for the agent.json manifest. */
export const agentManifestJsonSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: AGENT_MANIFEST_SCHEMA_ID,
	type: "object",
	additionalProperties: false,
	required: ["name", "description", "model"],
	properties: {
		$schema: { type: "string", const: AGENT_MANIFEST_SCHEMA_ID },
		name: { type: "string", minLength: 1 },
		description: { type: "string" },
		model: { type: "string", minLength: 1 },
		thinking: { type: "string" },
		maxTurns: { type: "number" },
		coreTools: { type: "array", items: { type: "string" } },
		disallowedTools: { type: "array", items: { type: "string" } },
		extensions: {
			oneOf: [
				{ type: "boolean" },
				{ type: "array", items: { type: "string" } },
			],
		},
		runInBackground: { type: "boolean" },
		toolProfiles: { type: "array", items: { type: "string" } },
		variables: {
			type: "object",
			additionalProperties: {
				type: "object",
				additionalProperties: false,
				properties: {
					default: {},
					description: { type: "string" },
					optional: { type: "boolean" },
					required: { type: "boolean" },
				},
			},
		},
		variants: {
			type: "object",
			additionalProperties: {
				type: "object",
				additionalProperties: false,
				properties: {
					model: { type: "string" },
					thinking: { type: "string" },
					maxTurns: { type: "number" },
					runInBackground: { type: "boolean" },
					displayLabel: { type: "string" },
				},
			},
		},
		state: {
			type: "object",
			additionalProperties: false,
			properties: {
				window: {
					type: "object",
					additionalProperties: false,
					properties: {
						strategy: { type: "string", enum: ["turns", "token-budget"] },
						maxTurns: { type: "number" },
						maxTokens: { type: "number" },
						charsPerToken: { type: "number" },
						imageTokens: { type: "number" },
						maxImages: { type: "number" },
						elisionMarker: { type: "boolean" },
					},
				},
			},
		},
	},
} as const;

/**
 * Structural validation of an untrusted value against the semantics of
 * `agentManifestJsonSchema`. Keep in lockstep with the schema.
 */
export function validateAgentManifestShape(
	value: unknown,
): AgentManifestShapeResult {
	const errors: string[] = [];

	if (!isPlainObject(value)) {
		errors.push("manifest: expected an object");
		return { valid: false, errors };
	}

	for (const key of Object.keys(value)) {
		if (!TOP_LEVEL_KEYS.has(key)) {
			errors.push(`manifest.${key}: unknown field`);
		}
	}

	if (value.$schema !== undefined && value.$schema !== AGENT_MANIFEST_SCHEMA_ID) {
		errors.push(
			`manifest.$schema: expected "${AGENT_MANIFEST_SCHEMA_ID}", got ${describe(value.$schema)}`,
		);
	}

	checkRequiredString(value, "name", errors);
	if (typeof value.description !== "string") {
		errors.push(
			`manifest.description: expected a string, got ${describe(value.description)}`,
		);
	}
	checkRequiredString(value, "model", errors);

	checkOptionalString(value, "thinking", errors);
	checkOptionalNumber(value, "maxTurns", errors);
	checkOptionalBoolean(value, "runInBackground", errors);
	checkOptionalStringArray(value, "coreTools", errors);
	checkOptionalStringArray(value, "disallowedTools", errors);
	checkOptionalStringArray(value, "toolProfiles", errors);

	if (value.extensions !== undefined) {
		const ext = value.extensions;
		const validExtensions =
			typeof ext === "boolean" ||
			(Array.isArray(ext) && ext.every((item) => typeof item === "string"));
		if (!validExtensions) {
			errors.push(
				`manifest.extensions: expected true, false, or an array of strings, got ${describe(ext)}`,
			);
		}
	}

	if (value.variables !== undefined) {
		if (!isPlainObject(value.variables)) {
			errors.push(
				`manifest.variables: expected an object map, got ${describe(value.variables)}`,
			);
		} else {
			for (const [name, decl] of Object.entries(value.variables)) {
				validateVariableDeclaration(decl, `manifest.variables.${name}`, errors);
			}
		}
	}

	if (value.variants !== undefined) {
		if (!isPlainObject(value.variants)) {
			errors.push(
				`manifest.variants: expected an object map, got ${describe(value.variants)}`,
			);
		} else {
			for (const [name, variant] of Object.entries(value.variants)) {
				validateVariantDefinition(variant, `manifest.variants.${name}`, errors);
			}
		}
	}

	if (value.state !== undefined) validateStateConfig(value.state, errors);

	return { valid: errors.length === 0, errors };
}

/**
 * `state.window` is the per-agent window policy (D85). Its presence —
 * with or without a `state.ts` sidecar — is what activates the state
 * extension; a manifest without it keeps the pure pass-through path.
 */
function validateStateConfig(value: unknown, errors: string[]): void {
	const path = "manifest.state";
	if (!isPlainObject(value)) {
		errors.push(`${path}: expected an object, got ${describe(value)}`);
		return;
	}
	for (const key of Object.keys(value)) {
		if (!STATE_KEYS.has(key)) errors.push(`${path}.${key}: unknown field`);
	}
	if (value.window === undefined) return;
	const windowPath = `${path}.window`;
	const windowValue = value.window;
	if (!isPlainObject(windowValue)) {
		errors.push(`${windowPath}: expected an object, got ${describe(windowValue)}`);
		return;
	}
	for (const key of Object.keys(windowValue)) {
		if (!WINDOW_KEYS.has(key)) errors.push(`${windowPath}.${key}: unknown field`);
	}
	if (windowValue.strategy !== undefined) {
		if (
			typeof windowValue.strategy !== "string" ||
			!WINDOW_STRATEGIES.has(windowValue.strategy)
		) {
			errors.push(
				`${windowPath}.strategy: expected "turns" or "token-budget", got ${describe(windowValue.strategy)}`,
			);
		}
	}
	for (const field of [
		"maxTurns",
		"maxTokens",
		"charsPerToken",
		"imageTokens",
		"maxImages",
	] as const) {
		const member = windowValue[field];
		if (member !== undefined && typeof member !== "number") {
			errors.push(
				`${windowPath}.${field}: expected a number, got ${describe(member)}`,
			);
		}
	}
	if (
		windowValue.elisionMarker !== undefined &&
		typeof windowValue.elisionMarker !== "boolean"
	) {
		errors.push(
			`${windowPath}.elisionMarker: expected a boolean, got ${describe(windowValue.elisionMarker)}`,
		);
	}
}

function validateVariableDeclaration(
	value: unknown,
	path: string,
	errors: string[],
): void {
	if (!isPlainObject(value)) {
		errors.push(`${path}: expected an object, got ${describe(value)}`);
		return;
	}
	for (const key of Object.keys(value)) {
		if (!VARIABLE_KEYS.has(key)) errors.push(`${path}.${key}: unknown field`);
	}
	if (value.description !== undefined && typeof value.description !== "string") {
		errors.push(`${path}.description: expected a string, got ${describe(value.description)}`);
	}
	if (value.optional !== undefined && typeof value.optional !== "boolean") {
		errors.push(`${path}.optional: expected a boolean, got ${describe(value.optional)}`);
	}
	if (value.required !== undefined && typeof value.required !== "boolean") {
		errors.push(`${path}.required: expected a boolean, got ${describe(value.required)}`);
	}
}

function validateVariantDefinition(
	value: unknown,
	path: string,
	errors: string[],
): void {
	if (!isPlainObject(value)) {
		errors.push(`${path}: expected an object, got ${describe(value)}`);
		return;
	}
	for (const key of Object.keys(value)) {
		if (!VARIANT_KEYS.has(key)) errors.push(`${path}.${key}: unknown field`);
	}
	if (value.model !== undefined && typeof value.model !== "string") {
		errors.push(`${path}.model: expected a string, got ${describe(value.model)}`);
	}
	if (value.thinking !== undefined && typeof value.thinking !== "string") {
		errors.push(`${path}.thinking: expected a string, got ${describe(value.thinking)}`);
	}
	if (value.maxTurns !== undefined && typeof value.maxTurns !== "number") {
		errors.push(`${path}.maxTurns: expected a number, got ${describe(value.maxTurns)}`);
	}
	if (value.runInBackground !== undefined && typeof value.runInBackground !== "boolean") {
		errors.push(
			`${path}.runInBackground: expected a boolean, got ${describe(value.runInBackground)}`,
		);
	}
	if (value.displayLabel !== undefined && typeof value.displayLabel !== "string") {
		errors.push(`${path}.displayLabel: expected a string, got ${describe(value.displayLabel)}`);
	}
}

function checkRequiredString(
	value: Record<string, unknown>,
	field: string,
	errors: string[],
): void {
	const member = value[field];
	if (typeof member !== "string" || member.length === 0) {
		errors.push(
			`manifest.${field}: expected a non-empty string, got ${describe(member)}`,
		);
	}
}

function checkOptionalString(
	value: Record<string, unknown>,
	field: string,
	errors: string[],
): void {
	const member = value[field];
	if (member !== undefined && typeof member !== "string") {
		errors.push(`manifest.${field}: expected a string, got ${describe(member)}`);
	}
}

function checkOptionalNumber(
	value: Record<string, unknown>,
	field: string,
	errors: string[],
): void {
	const member = value[field];
	if (member !== undefined && typeof member !== "number") {
		errors.push(`manifest.${field}: expected a number, got ${describe(member)}`);
	}
}

function checkOptionalBoolean(
	value: Record<string, unknown>,
	field: string,
	errors: string[],
): void {
	const member = value[field];
	if (member !== undefined && typeof member !== "boolean") {
		errors.push(`manifest.${field}: expected a boolean, got ${describe(member)}`);
	}
}

function checkOptionalStringArray(
	value: Record<string, unknown>,
	field: string,
	errors: string[],
): void {
	const member = value[field];
	if (member === undefined) return;
	if (!Array.isArray(member) || !member.every((item) => typeof item === "string")) {
		errors.push(
			`manifest.${field}: expected an array of strings, got ${describe(member)}`,
		);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return "an array";
	if (typeof value === "object") return "an object";
	return `${typeof value} ${String(value)}`;
}
