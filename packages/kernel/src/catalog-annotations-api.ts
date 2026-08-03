/**
 * Kernel catalog annotation routes — the HTTP surface over the annotation
 * sidecar ops on KernelCatalogService. Mounted by createKernelCatalogApi
 * (catalog-api.ts) so the annotation endpoints ride the same prefix:
 *
 *   GET    <prefix>/catalog/agents/:name/annotations
 *   POST   <prefix>/catalog/agents/:name/annotations
 *            body: { target, body, intent, author, expectedHash? }
 *   POST   <prefix>/catalog/agents/:name/annotations/prune
 *            body: { resolvedOlderThan?, expectedHash? }   (live-only compaction)
 *   POST   <prefix>/catalog/agents/:name/annotations/:id/replies
 *            body: { author, body, expectedHash? }
 *   POST   <prefix>/catalog/agents/:name/annotations/:id/resolve
 *            body: { status?, resolution?, expectedHash? }
 *   POST   <prefix>/catalog/agents/:name/annotations/:id/agent-run
 *            body: { sessionId, patchId, summary, changedIds?, expectedHash? }
 *   DELETE <prefix>/catalog/agents/:name/annotations/:id?expectedHash=...
 *
 * Conventions mirror the prompt save flow: mutations answer 403 unless
 * writes are enabled (local-dev trust model), 404 for an unknown agent or
 * annotation id, 409 + { currentHash } on a stale expectedHash, and 400 +
 * { errors } for invalid input (including a target that does not resolve
 * against the current prompt). A corrupt sidecar answers 422.
 */
import { Elysia } from "elysia";

import type {
	KernelCatalogAnnotationPruneResult,
	KernelCatalogAnnotationRemoveResult,
	KernelCatalogAnnotationWriteResult,
	KernelCatalogService,
} from "./catalog-service";

export interface CreateKernelCatalogAnnotationsApiOptions {
	prefix?: string;
	/** Overrides the service's write gate when provided. */
	allowWrites?: boolean;
}

function normalizePrefix(prefix: string): string {
	if (prefix === "/") return "";
	return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

type MutationResult =
	| KernelCatalogAnnotationWriteResult
	| KernelCatalogAnnotationRemoveResult
	| KernelCatalogAnnotationPruneResult;

/** Shared failure mapping for every annotation mutation route. */
function answerMutation(
	result: MutationResult | null,
	agentName: string,
	set: { status?: number | string },
): unknown {
	if (result === null) {
		set.status = 404;
		return { error: `Agent ${agentName} not found in catalog` };
	}
	if (result.ok) return result;
	if ("currentHash" in result) {
		set.status = 409;
		return { currentHash: result.currentHash };
	}
	if ("annotationNotFound" in result) {
		set.status = 404;
		return { error: `Annotation ${result.annotationNotFound} not found` };
	}
	set.status = 400;
	return { errors: result.errors };
}

export function createKernelCatalogAnnotationsApi(
	service: KernelCatalogService,
	options: CreateKernelCatalogAnnotationsApiOptions = {},
) {
	const prefix = normalizePrefix(options.prefix ?? "/kernel");
	const allowWrites = options.allowWrites ?? service.allowWrites;

	const readOnly = (set: { status?: number | string }) => {
		set.status = 403;
		return {
			error: "Catalog writes are disabled — the kernel is not running in dev mode",
		};
	};

	return new Elysia()
		.get(`${prefix}/catalog/agents/:name/annotations`, async ({ params, set }) => {
			try {
				const result = await service.listAnnotations(params.name);
				if (result === null) {
					set.status = 404;
					return { error: `Agent ${params.name} not found in catalog` };
				}
				if (!result.ok) {
					set.status = 422;
					return { errors: result.errors };
				}
				return {
					annotations: result.annotations,
					hash: result.hash,
					dangling: result.dangling,
				};
			} catch (error) {
				console.error("Error listing catalog annotations:", error);
				set.status = 500;
				return { error: "Failed to list catalog annotations" };
			}
		})
		.post(`${prefix}/catalog/agents/:name/annotations`, async ({ params, body, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				return answerMutation(
					await service.addAnnotation(params.name, body),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error adding catalog annotation:", error);
				set.status = 500;
				return { error: "Failed to add catalog annotation" };
			}
		})
		.post(`${prefix}/catalog/agents/:name/annotations/prune`, async ({ params, body, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				return answerMutation(
					await service.pruneAnnotations(params.name, body),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error pruning catalog annotations:", error);
				set.status = 500;
				return { error: "Failed to prune catalog annotations" };
			}
		})
		.post(`${prefix}/catalog/agents/:name/annotations/:id/replies`, async ({ params, body, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				return answerMutation(
					await service.addAnnotationReply(params.name, params.id, body),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error adding catalog annotation reply:", error);
				set.status = 500;
				return { error: "Failed to add catalog annotation reply" };
			}
		})
		.post(`${prefix}/catalog/agents/:name/annotations/:id/resolve`, async ({ params, body, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				return answerMutation(
					await service.resolveAnnotation(params.name, params.id, body),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error resolving catalog annotation:", error);
				set.status = 500;
				return { error: "Failed to resolve catalog annotation" };
			}
		})
		.post(`${prefix}/catalog/agents/:name/annotations/:id/agent-run`, async ({ params, body, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				return answerMutation(
					await service.attachAnnotationAgentRun(params.name, params.id, body),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error attaching catalog annotation agent run:", error);
				set.status = 500;
				return { error: "Failed to attach catalog annotation agent run" };
			}
		})
		.delete(`${prefix}/catalog/agents/:name/annotations/:id`, async ({ params, query, set }) => {
			if (!allowWrites) return readOnly(set);
			try {
				const expectedHash =
					typeof query.expectedHash === "string" ? query.expectedHash : undefined;
				return answerMutation(
					await service.removeAnnotation(params.name, params.id, expectedHash),
					params.name,
					set,
				);
			} catch (error) {
				console.error("Error removing catalog annotation:", error);
				set.status = 500;
				return { error: "Failed to remove catalog annotation" };
			}
		});
}
