import type { VariableDeclaration } from "../parsing/types";

export interface ValidationResult {
	missingDeclarations: string[];
	unusedDeclarations: string[];
}

const VAR_REF = /\{\{(\w+)\}\}/g;

export function validateVariables(
	body: string,
	declarations: Record<string, VariableDeclaration>,
): ValidationResult {
	const refs = new Set<string>();
	for (const m of body.matchAll(VAR_REF)) refs.add(m[1]);

	const declared = new Set(Object.keys(declarations));

	const missing: string[] = [];
	for (const ref of refs) if (!declared.has(ref)) missing.push(ref);

	const unused: string[] = [];
	for (const name of declared) if (!refs.has(name)) unused.push(name);

	return {
		missingDeclarations: missing.sort(),
		unusedDeclarations: unused.sort(),
	};
}
