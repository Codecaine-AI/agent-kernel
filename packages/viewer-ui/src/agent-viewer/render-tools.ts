/**
 * render-tools.ts — the TOOLS view's document builder.
 *
 * Turns an agent's tool previews into the pseudo-XML document the lab's
 * ToolsSurface renders: one `<tool name="…">` element per tool (the shared
 * outline labels rows by the name attribute), a description line, and a
 * compact one-line parameter signature derived from the JSON schema.
 */
import type { CatalogToolPreview } from "@agent-kernel/viewer-core";

type SchemaNode = Record<string, unknown>;

function asNode(value: unknown): SchemaNode | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as SchemaNode)
		: null;
}

/** Compact structural label for one parameter's schema node. */
function typeLabel(value: unknown, depth = 0): string {
	const node = asNode(value);
	if (node === null) return "json";
	if ("const" in node) return JSON.stringify(node.const);
	if (Array.isArray(node.enum)) {
		return node.enum.map((entry) => JSON.stringify(entry)).join(" | ");
	}
	if (Array.isArray(node.anyOf)) {
		return node.anyOf.map((entry) => typeLabel(entry, depth + 1)).join(" | ");
	}
	switch (node.type) {
		case "string":
			return "str";
		case "integer":
			return "int";
		case "number":
			return "num";
		case "boolean":
			return "bool";
		case "null":
			return "null";
		case "array":
			return `${typeLabel(node.items, depth + 1)}[]`;
		case "object": {
			if (depth >= 1) return "object";
			const properties = asNode(node.properties);
			if (properties === null || Object.keys(properties).length === 0) {
				return "object";
			}
			const required = new Set(
				Array.isArray(node.required)
					? node.required.filter(
							(key): key is string => typeof key === "string",
						)
					: [],
			);
			const entries = Object.keys(properties).map(
				(key) =>
					`${key}${required.has(key) ? "" : "?"}: ${typeLabel(properties[key], depth + 1)}`,
			);
			return `{${entries.join(", ")}}`;
		}
		default:
			return "json";
	}
}

/** One-line signature for a tool's parameters object. */
function signatureLine(parameters: Record<string, unknown>): string {
	const properties = asNode(parameters.properties);
	if (properties === null || Object.keys(properties).length === 0) {
		return "(no parameters)";
	}
	const required = new Set(
		Array.isArray(parameters.required)
			? parameters.required.filter(
					(key): key is string => typeof key === "string",
				)
			: [],
	);
	// Required parameters first, in declaration order.
	const keys = Object.keys(properties).sort(
		(a, b) => Number(required.has(b)) - Number(required.has(a)),
	);
	return keys
		.map(
			(key) =>
				`${key}${required.has(key) ? "" : "?"}: ${typeLabel(properties[key])}`,
		)
		.join(" · ");
}

/** The rendered TOOLS document: one `<tool name="…">` element per tool. */
export function renderToolsDocument(
	tools: readonly CatalogToolPreview[],
): string {
	return tools
		.map((tool) =>
			[
				`<tool name="${tool.name}">`,
				`  ${tool.description}`,
				`  ${signatureLine(tool.parameters)}`,
				"</tool>",
			].join("\n"),
		)
		.join("\n");
}
