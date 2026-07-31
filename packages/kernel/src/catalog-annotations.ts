/**
 * Catalog annotation ops — the KernelCatalogService surface over the
 * per-bundle annotation sidecar (agent-registry/annotation-sidecar.ts).
 * Spread into createKernelCatalogService so the catalog service exposes
 * annotation CRUD beside the prompt save flow, with the same conventions:
 *
 *   - null when the agent is not in the registry (routes answer 404);
 *   - wire inputs arrive as `unknown` and are shape-checked here, answering
 *     `{ ok: false, errors }` (routes answer 400/422);
 *   - optimistic concurrency via expectedHash in / `{ ok: false,
 *     currentHash }` out (routes answer 409), like savePrompt;
 *   - write gating stays at the route layer (allowWrites), like the PUT
 *     prompt/manifest routes.
 *
 * Every op syncs the prompt from disk first so target validation and the
 * advisory dangling report run against the CURRENT prompt, not the one
 * cached at boot.
 */
import type { KernelDatabase } from "@agent-kernel/db";
import type {
	DanglingTarget,
	PromptAnnotation,
	PromptAnnotationIntent,
	PromptAnnotationsDocument,
	PromptAnnotationStatus,
} from "@codecaine-ai/prompt-kit/annotations";

import { syncAgentPromptFromDisk, type AgentRegistry } from "./agent-registry";
import {
	addAnnotation,
	addAnnotationReply,
	attachAgentRunToAnnotation,
	listAnnotations,
	pruneAnnotations,
	removeAnnotation,
	setAnnotationStatus,
	type AnnotationSidecarFailure,
	type AnnotationSidecarMutationResult,
} from "./agent-registry/annotation-sidecar";

/** 200 body of `GET .../catalog/agents/:name/annotations`. */
export type KernelCatalogAnnotationsListResult =
	| {
			ok: true;
			annotations: PromptAnnotationsDocument;
			/** Null when no sidecar exists yet. */
			hash: string | null;
			/** Advisory: entries whose targets no longer resolve on the current prompt. */
			dangling: DanglingTarget[];
	  }
	| { ok: false; errors: string[] };

export type KernelCatalogAnnotationWriteResult =
	| {
			ok: true;
			annotation: PromptAnnotation;
			annotations: PromptAnnotationsDocument;
			hash: string;
	  }
	| { ok: false; currentHash: string | null }
	| { ok: false; errors: string[] }
	| { ok: false; annotationNotFound: string };

export type KernelCatalogAnnotationRemoveResult =
	| { ok: true; annotations: PromptAnnotationsDocument; hash: string }
	| { ok: false; currentHash: string | null }
	| { ok: false; errors: string[] }
	| { ok: false; annotationNotFound: string };

export type KernelCatalogAnnotationPruneResult =
	| {
			ok: true;
			removed: number;
			annotations: PromptAnnotationsDocument;
			hash: string | null;
	  }
	| { ok: false; currentHash: string | null }
	| { ok: false; errors: string[] }
	| { ok: false; annotationNotFound: string };

/** Annotation methods mixed into KernelCatalogService (all additive). */
export interface KernelCatalogAnnotationOps {
	/** null when the agent is not in the registry. */
	listAnnotations(name: string): Promise<KernelCatalogAnnotationsListResult | null>;
	/** null when the agent is not in the registry. */
	addAnnotation(
		name: string,
		input: unknown,
	): Promise<KernelCatalogAnnotationWriteResult | null>;
	/** null when the agent is not in the registry. */
	addAnnotationReply(
		name: string,
		annotationId: string,
		input: unknown,
	): Promise<KernelCatalogAnnotationWriteResult | null>;
	/** Resolve (or re-open) an annotation. null when the agent is not in the registry. */
	resolveAnnotation(
		name: string,
		annotationId: string,
		input: unknown,
	): Promise<KernelCatalogAnnotationWriteResult | null>;
	/** null when the agent is not in the registry. */
	attachAnnotationAgentRun(
		name: string,
		annotationId: string,
		input: unknown,
	): Promise<KernelCatalogAnnotationWriteResult | null>;
	/** null when the agent is not in the registry. */
	removeAnnotation(
		name: string,
		annotationId: string,
		expectedHash?: string,
	): Promise<KernelCatalogAnnotationRemoveResult | null>;
	/** Live-only compaction: drop resolved entries. null when the agent is unknown. */
	pruneAnnotations(
		name: string,
		input: unknown,
	): Promise<KernelCatalogAnnotationPruneResult | null>;
}

export interface CreateCatalogAnnotationOpsOptions {
	registry: () => Promise<AgentRegistry>;
	db: () => KernelDatabase;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional-string field check shared by every wire parser here. */
function optionalString(
	record: Record<string, unknown>,
	key: string,
	errors: string[],
): string | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		errors.push(`${key}: expected a string`);
		return undefined;
	}
	return value;
}

function requiredString(
	record: Record<string, unknown>,
	key: string,
	errors: string[],
): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		errors.push(`${key}: expected a non-empty string`);
		return "";
	}
	return value;
}

/** Maps a sidecar failure to the catalog wire result. */
function mapFailure(
	failure: AnnotationSidecarFailure,
):
	| { ok: false; currentHash: string | null }
	| { ok: false; errors: string[] }
	| { ok: false; annotationNotFound: string } {
	switch (failure.reason) {
		case "conflict":
			return { ok: false, currentHash: failure.currentHash };
		case "annotation-not-found":
			return { ok: false, annotationNotFound: failure.annotationId };
		case "invalid":
			return { ok: false, errors: failure.errors };
	}
}

function mapMutation(
	result: AnnotationSidecarMutationResult,
): KernelCatalogAnnotationWriteResult {
	return result.ok
		? {
				ok: true,
				annotation: result.annotation,
				annotations: result.annotations,
				hash: result.hash,
			}
		: mapFailure(result);
}

export function createCatalogAnnotationOps(
	opts: CreateCatalogAnnotationOpsOptions,
): KernelCatalogAnnotationOps {
	function tryDb(): KernelDatabase | null {
		try {
			return opts.db();
		} catch {
			return null;
		}
	}

	/** Registry lookup + disk-fresh prompt sync; null when the agent is unknown. */
	async function freshDef(name: string) {
		const registry = await opts.registry();
		if (!registry.tryGet(name)) return null;
		return syncAgentPromptFromDisk(tryDb(), registry, name);
	}

	return {
		async listAnnotations(name) {
			const def = await freshDef(name);
			if (!def) return null;
			const result = await listAnnotations(def.bundleLayout.dir, def.promptDocument);
			if (!result.ok) return { ok: false, errors: result.errors };
			return {
				ok: true,
				annotations: result.annotations,
				hash: result.hash,
				dangling: result.dangling,
			};
		},

		async addAnnotation(name, input) {
			const def = await freshDef(name);
			if (!def) return null;
			if (!isPlainObject(input)) {
				return { ok: false, errors: ["annotation: expected an object"] };
			}
			const errors: string[] = [];
			const body = requiredString(input, "body", errors);
			const author = requiredString(input, "author", errors);
			const intent = input.intent;
			if (intent !== "note" && intent !== "agent-request") {
				errors.push('intent: expected "note" or "agent-request"');
			}
			const expectedHash = optionalString(input, "expectedHash", errors);
			if (input.target === undefined) errors.push("target: required");
			if (errors.length > 0) return { ok: false, errors };

			return mapMutation(
				await addAnnotation(def.bundleLayout.dir, def.promptDocument, {
					target: input.target,
					body,
					author,
					intent: intent as PromptAnnotationIntent,
					expectedHash,
				}),
			);
		},

		async addAnnotationReply(name, annotationId, input) {
			const def = await freshDef(name);
			if (!def) return null;
			if (!isPlainObject(input)) {
				return { ok: false, errors: ["reply: expected an object"] };
			}
			const errors: string[] = [];
			const body = requiredString(input, "body", errors);
			const author = requiredString(input, "author", errors);
			const expectedHash = optionalString(input, "expectedHash", errors);
			if (errors.length > 0) return { ok: false, errors };

			return mapMutation(
				await addAnnotationReply(def.bundleLayout.dir, annotationId, {
					body,
					author,
					expectedHash,
				}),
			);
		},

		async resolveAnnotation(name, annotationId, input) {
			const def = await freshDef(name);
			if (!def) return null;
			// Body is optional: a bare resolve carries no note.
			const record = input === undefined || input === null ? {} : input;
			if (!isPlainObject(record)) {
				return { ok: false, errors: ["resolve: expected an object"] };
			}
			const errors: string[] = [];
			const resolution = optionalString(record, "resolution", errors);
			const expectedHash = optionalString(record, "expectedHash", errors);
			let status: PromptAnnotationStatus = "resolved";
			if (record.status !== undefined) {
				if (record.status !== "open" && record.status !== "resolved") {
					errors.push('status: expected "open" or "resolved"');
				} else {
					status = record.status;
				}
			}
			if (errors.length > 0) return { ok: false, errors };

			return mapMutation(
				await setAnnotationStatus(def.bundleLayout.dir, annotationId, {
					status,
					resolution,
					expectedHash,
				}),
			);
		},

		async attachAnnotationAgentRun(name, annotationId, input) {
			const def = await freshDef(name);
			if (!def) return null;
			if (!isPlainObject(input)) {
				return { ok: false, errors: ["agentRun: expected an object"] };
			}
			const errors: string[] = [];
			const sessionId = requiredString(input, "sessionId", errors);
			const patchId = requiredString(input, "patchId", errors);
			const summary = requiredString(input, "summary", errors);
			const expectedHash = optionalString(input, "expectedHash", errors);
			let changedIds: string[] | undefined;
			if (input.changedIds !== undefined) {
				if (
					!Array.isArray(input.changedIds) ||
					!input.changedIds.every((value) => typeof value === "string")
				) {
					errors.push("changedIds: expected an array of strings");
				} else {
					changedIds = input.changedIds;
				}
			}
			if (errors.length > 0) return { ok: false, errors };

			return mapMutation(
				await attachAgentRunToAnnotation(def.bundleLayout.dir, annotationId, {
					sessionId,
					patchId,
					summary,
					changedIds,
					expectedHash,
				}),
			);
		},

		async removeAnnotation(name, annotationId, expectedHash) {
			const def = await freshDef(name);
			if (!def) return null;
			const result = await removeAnnotation(
				def.bundleLayout.dir,
				annotationId,
				expectedHash,
			);
			if (!result.ok) return mapFailure(result);
			return { ok: true, annotations: result.annotations, hash: result.hash };
		},

		async pruneAnnotations(name, input) {
			const def = await freshDef(name);
			if (!def) return null;
			const record = input === undefined || input === null ? {} : input;
			if (!isPlainObject(record)) {
				return { ok: false, errors: ["prune: expected an object"] };
			}
			const errors: string[] = [];
			const resolvedOlderThan = optionalString(record, "resolvedOlderThan", errors);
			const expectedHash = optionalString(record, "expectedHash", errors);
			if (errors.length > 0) return { ok: false, errors };

			const result = await pruneAnnotations(def.bundleLayout.dir, {
				resolvedOlderThan,
				expectedHash,
			});
			if (!result.ok) return mapFailure(result);
			return {
				ok: true,
				removed: result.removed,
				annotations: result.annotations,
				hash: result.hash,
			};
		},
	};
}
