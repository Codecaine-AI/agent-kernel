import { resolve } from "node:path";

import type { DomainRule } from "../types";

export type OperationType = "read" | "upsert" | "delete";

export interface DomainCheckResult {
	allowed: boolean;
	reason?: string;
}

const TOOL_OPERATION_MAP: Record<string, OperationType> = {
	read: "read",
	glob: "read",
	grep: "read",
	write: "upsert",
	edit: "upsert",
	notebook_edit: "upsert",
	delete: "delete",
};

export function mapToolToOperation(toolName: string): OperationType | null {
	return TOOL_OPERATION_MAP[toolName] ?? null;
}

export function checkDomainAccess(
	domain: DomainRule[] | undefined,
	filePath: string,
	operation: OperationType,
	cwd: string,
): DomainCheckResult {
	if (!domain || domain.length === 0) {
		return { allowed: true };
	}

	const resolvedPath = resolve(cwd, filePath);

	for (const rule of domain) {
		const resolvedRule = resolve(cwd, rule.path);
		if (resolvedPath === resolvedRule || resolvedPath.startsWith(resolvedRule + "/")) {
			if (rule[operation]) {
				return { allowed: true };
			}
			return {
				allowed: false,
				reason: `Domain guard: '${operation}' not permitted on ${filePath} (matched rule: ${rule.path})`,
			};
		}
	}

	return {
		allowed: false,
		reason: `Domain guard: ${filePath} not in any allowed domain`,
	};
}
