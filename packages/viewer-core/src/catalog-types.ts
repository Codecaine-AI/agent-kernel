import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	DanglingTarget,
	PromptAnnotation,
	PromptAnnotationIntent,
	PromptAnnotationsDocument,
	PromptAnnotationStatus,
	PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";

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

/** One resolved context input within `CatalogContextPreview.inputs`. */
export interface CatalogContextInput {
	loaderKind: string;
	inputRef: string;
	status: "ok" | "empty" | "error";
	bytes: number;
}

/** Assembled context preview carried on `GET /kernel/catalog/agents/:name`. */
export interface CatalogContextPreview {
	modulePath: string | null;
	inputs: CatalogContextInput[];
	/** Null when no preview could be assembled. */
	renderedContext: string | null;
}

/** Response of `GET /kernel/catalog/agents/:name`. */
export interface CatalogAgentDetail {
	manifest: Record<string, unknown>;
	prompt: PromptDocument;
	promptHash: string;
	rendered: string;
	declaredVariables: string[];
	/** Model alias keys (models.aliases config) — datalist suggestions for the model field. */
	modelAliases: string[];
	/**
	 * Assembled context preview — null when the agent has no context module.
	 * Optional so payloads from kernels that omit the field still typecheck.
	 */
	context?: CatalogContextPreview | null;
}

/** Body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestPatch {
	description?: string;
	model?: string;
}

/** 200 body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestSaveSuccess {
	manifest: Record<string, unknown>;
}

/** 400 body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestSaveFailure {
	errors: string[];
}

export type CatalogManifestSaveResult =
	| CatalogManifestSaveSuccess
	| CatalogManifestSaveFailure;

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

/** Response of `GET /kernel/catalog/agents/:name/revisions/:hash/document`. */
export interface PromptRevisionDocumentResponse {
	hash: string;
	createdAt: string;
	document: PromptDocument;
}

/** Response of `GET /kernel/catalog/agents/:name/revisions/:hash/stats`. */
export interface PromptRevisionStats {
	runs: number;
	totalTokens: number;
	avgTokens: number;
	cost: number | null;
	failures: number;
}

// ---------------------------------------------------------------------------
// Annotation sidecar (live-only annotations.json beside the bundle's prompt)
// ---------------------------------------------------------------------------

/** Response of `GET /kernel/catalog/agents/:name/annotations`. */
export interface CatalogAnnotationsResponse {
	annotations: PromptAnnotationsDocument;
	/** SHA-256 of the sidecar bytes; null when no sidecar exists yet. */
	hash: string | null;
	/** Advisory: entries whose targets no longer resolve on the current prompt. */
	dangling: DanglingTarget[];
}

/** Body of `POST /kernel/catalog/agents/:name/annotations`. */
export interface CatalogAnnotationAddRequest {
	target: PromptAnnotationTarget;
	body: string;
	intent: PromptAnnotationIntent;
	author: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/replies`. */
export interface CatalogAnnotationReplyRequest {
	author: string;
	body: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/resolve`. */
export interface CatalogAnnotationResolveRequest {
	/** Defaults to "resolved"; pass "open" to re-open. */
	status?: PromptAnnotationStatus;
	/** Optional resolution note persisted on the annotation. */
	resolution?: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/agent-run`. */
export interface CatalogAnnotationAgentRunRequest {
	sessionId: string;
	patchId: string;
	summary: string;
	changedIds?: string[];
	expectedHash?: string;
}

/** Body of `POST .../annotations/prune` (live-only compaction of resolved entries). */
export interface CatalogAnnotationPruneRequest {
	/** ISO cutoff: only resolved entries created before this are pruned. */
	resolvedOlderThan?: string;
	expectedHash?: string;
}

/** 200 body of the add/reply/resolve/agent-run annotation mutations. */
export interface CatalogAnnotationMutationSuccess {
	ok: true;
	annotation: PromptAnnotation;
	annotations: PromptAnnotationsDocument;
	hash: string;
}

/** 200 body of `DELETE .../annotations/:id`. */
export interface CatalogAnnotationRemoveSuccess {
	ok: true;
	annotations: PromptAnnotationsDocument;
	hash: string;
}

/** 200 body of `POST .../annotations/prune`. */
export interface CatalogAnnotationPruneSuccess {
	ok: true;
	removed: number;
	annotations: PromptAnnotationsDocument;
	hash: string | null;
}

/** 409 body of any annotation mutation (stale expectedHash). */
export interface CatalogAnnotationConflict {
	currentHash: string | null;
}

/** 400/422 body of any annotation mutation (invalid input or corrupt sidecar). */
export interface CatalogAnnotationFailure {
	errors: string[];
}
