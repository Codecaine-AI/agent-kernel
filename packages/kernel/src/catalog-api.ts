/**
 * Kernel catalog API (Phase 5) — an Elysia route factory over a
 * KernelCatalogService. Serves the KERNEL_CATALOG_PATHS contract (see
 * @agent-kernel/viewer-core api.ts — the paths are duplicated here because
 * the kernel does not depend on the viewer):
 *
 *   GET  <prefix>/catalog/agents                       registry listing
 *   GET  <prefix>/catalog/agents/:name                 manifest + prompt + validation
 *   PUT  <prefix>/catalog/agents/:name/prompt          body: PromptDocument
 *   PUT  <prefix>/catalog/agents/:name/manifest        body: { description?, model? }
 *   GET  <prefix>/catalog/agents/:name/revisions       history (hash, source, date)
 *   GET  <prefix>/catalog/agents/:name/revisions/:hash/stats
 *
 * The PUT mutates catalog files on disk, so it answers 403 unless writes are
 * enabled (local-dev trust model): production harnesses ship read-only
 * catalogs and never pass allowWrites.
 */
import { Elysia } from "elysia";

import type { KernelCatalogService } from "./catalog-service";

export interface CreateKernelCatalogApiOptions {
	prefix?: string;
	/** Overrides the service's write gate when provided. */
	allowWrites?: boolean;
}

function normalizePrefix(prefix: string): string {
	if (prefix === "/") return "";
	return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

export function createKernelCatalogApi(
	service: KernelCatalogService,
	options: CreateKernelCatalogApiOptions = {},
) {
	const prefix = normalizePrefix(options.prefix ?? "/kernel");
	const allowWrites = options.allowWrites ?? service.allowWrites;

	return new Elysia()
		.get(`${prefix}/catalog/agents`, async ({ set }) => {
			try {
				return { agents: await service.listAgents() };
			} catch (error) {
				console.error("Error listing kernel catalog agents:", error);
				set.status = 500;
				return { error: "Failed to list kernel catalog agents" };
			}
		})
		.get(`${prefix}/catalog/agents/:name`, async ({ params, set }) => {
			try {
				const detail = await service.getAgentDetail(params.name);
				if (!detail) {
					set.status = 404;
					return { error: `Agent ${params.name} not found in catalog` };
				}
				return detail;
			} catch (error) {
				console.error("Error fetching kernel catalog agent:", error);
				set.status = 500;
				return { error: "Failed to fetch kernel catalog agent" };
			}
		})
		.put(`${prefix}/catalog/agents/:name/prompt`, async ({ params, body, set }) => {
			if (!allowWrites) {
				set.status = 403;
				return {
					error:
						"Catalog writes are disabled — the kernel is not running in dev mode",
				};
			}
			try {
				const result = await service.savePrompt(params.name, body);
				if (result === null) {
					set.status = 404;
					return { error: `Agent ${params.name} not found in catalog` };
				}
				if (!result.ok) {
					set.status = 400;
					return { errors: result.errors };
				}
				return { hash: result.hash };
			} catch (error) {
				console.error("Error saving kernel catalog prompt:", error);
				set.status = 500;
				return { error: "Failed to save kernel catalog prompt" };
			}
		})
		.put(`${prefix}/catalog/agents/:name/manifest`, async ({ params, body, set }) => {
			if (!allowWrites) {
				set.status = 403;
				return {
					error:
						"Catalog writes are disabled — the kernel is not running in dev mode",
				};
			}
			try {
				const result = await service.saveManifest(params.name, body);
				if (result === null) {
					set.status = 404;
					return { error: `Agent ${params.name} not found in catalog` };
				}
				if (!result.ok) {
					set.status = 400;
					return { errors: result.errors };
				}
				return { manifest: result.manifest };
			} catch (error) {
				console.error("Error saving kernel catalog manifest:", error);
				set.status = 500;
				return { error: "Failed to save kernel catalog manifest" };
			}
		})
		.get(`${prefix}/catalog/agents/:name/revisions`, async ({ params, set }) => {
			try {
				const revisions = await service.listRevisions(params.name);
				if (revisions === null) {
					set.status = 404;
					return { error: `Agent ${params.name} not found in catalog` };
				}
				return { revisions };
			} catch (error) {
				console.error("Error listing kernel prompt revisions:", error);
				set.status = 500;
				return { error: "Failed to list kernel prompt revisions" };
			}
		})
		.get(
			`${prefix}/catalog/agents/:name/revisions/:hash/stats`,
			async ({ params, set }) => {
				try {
					const stats = await service.getRevisionStats(params.name, params.hash);
					if (stats === null) {
						set.status = 404;
						return { error: `Agent ${params.name} not found in catalog` };
					}
					return stats;
				} catch (error) {
					console.error("Error fetching kernel prompt revision stats:", error);
					set.status = 500;
					return { error: "Failed to fetch kernel prompt revision stats" };
				}
			},
		);
}
