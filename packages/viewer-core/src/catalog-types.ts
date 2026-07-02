import type { PromptDocument } from "@codecaine-ai/prompt-kit";

/**
 * Browser-safe DTO types for the kernel catalog API (see KERNEL_CATALOG_PATHS
 * in ./api.ts). These mirror the wire shapes served by the kernel's catalog
 * routes — no db imports, plain JSON payloads only.
 */

/** One row from `GET /kernel/catalog/agents`. */
export interface CatalogAgentSummary {
	name: string;
	description: string;
	model: string;
	promptHash: string;
	valid: boolean;
}

/** Response of `GET /kernel/catalog/agents`. */
export interface CatalogAgentListResponse {
	agents: CatalogAgentSummary[];
}

/** Response of `GET /kernel/catalog/agents/:name`. */
export interface CatalogAgentDetail {
	manifest: Record<string, unknown>;
	prompt: PromptDocument;
	promptHash: string;
	rendered: string;
	declaredVariables: string[];
}

/** 200 body of `PUT /kernel/catalog/agents/:name/prompt`. */
export interface CatalogPromptSaveSuccess {
	hash: string;
}

/** 400 body of `PUT /kernel/catalog/agents/:name/prompt`. */
export interface CatalogPromptSaveFailure {
	errors: string[];
}

export type CatalogPromptSaveResult =
	| CatalogPromptSaveSuccess
	| CatalogPromptSaveFailure;

/** One row from `GET /kernel/catalog/agents/:name/revisions`. */
export interface PromptRevisionSummary {
	hash: string;
	source: string;
	createdAt: string;
}

/** Response of `GET /kernel/catalog/agents/:name/revisions`. */
export interface PromptRevisionListResponse {
	revisions: PromptRevisionSummary[];
}

/** Response of `GET /kernel/catalog/agents/:name/revisions/:hash/stats`. */
export interface PromptRevisionStats {
	runs: number;
	totalTokens: number;
	avgTokens: number;
	cost: number | null;
	failures: number;
}
