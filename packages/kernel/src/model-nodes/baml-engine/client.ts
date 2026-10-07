/**
 * Reaching into the generated client (plan §4.2): the function names, a
 * runtime-checked member accessor, and the prompt hash over its sources.
 * The client keeps the caller's exact type; nothing here requires an index
 * signature on it.
 */
import { createHash } from "node:crypto";

import { KernelNodeError } from "../types";

export type BamlCallable = (...args: unknown[]) => unknown;

/** `obj[name]` bound to `obj`; throws KernelNodeError("unknown-function") when it is not a function. */
export function callableAt(obj: unknown, name: string): BamlCallable {
	const member =
		obj !== null && (typeof obj === "object" || typeof obj === "function")
			? (obj as Record<string, unknown>)[name]
			: undefined;
	if (typeof member !== "function") {
		throw new KernelNodeError("unknown-function", `"${name}" is not a generated BAML function`);
	}
	return (...args) => (member as BamlCallable).apply(obj, args);
}

/**
 * The generated BAML functions: capitalized own methods of the client's
 * prototype, in declaration order. Getters (`request`, `parse`, `stream`)
 * are never invoked.
 */
export function generatedFunctionNames(client: object): string[] {
	const proto: unknown = Object.getPrototypeOf(client);
	if (proto === null || typeof proto !== "object") return [];
	return Object.getOwnPropertyNames(proto).filter((name) => {
		if (!/^[A-Z]/.test(name)) return false;
		return typeof Object.getOwnPropertyDescriptor(proto, name)?.value === "function";
	});
}

/** Sources that configure clients and code generation, not prompts. */
const NON_PROMPT_SOURCES: ReadonlySet<string> = new Set(["clients.baml", "generators.baml"]);

/**
 * `"baml1-" + sha256` over the sources (`getBamlFiles()`), sorted by path,
 * excluding `clients.baml` and `generators.baml` wherever they sit. Changing
 * a model, key or base URL leaves it unchanged; changing a prompt does not.
 */
export function bamlPromptHash(sources: Record<string, string>): string {
	const entries = Object.entries(sources)
		.filter(([path]) => !NON_PROMPT_SOURCES.has(path.slice(path.lastIndexOf("/") + 1)))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `baml1-${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}
