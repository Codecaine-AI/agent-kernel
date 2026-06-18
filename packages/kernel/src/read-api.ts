import { Elysia } from "elysia";

import type {
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
} from "@agent-kernel/viewer-core";

export interface KernelTraceReadQuery {
	after?: string | null;
	limit?: number;
}

export interface KernelTraceReadService {
	listTraceSessions?: (
		query: KernelTraceReadQuery,
	) => Promise<KernelTraceSessionListResponse>;
	getTraceSessionDetail: (
		id: string,
		query: KernelTraceReadQuery,
	) => Promise<KernelTraceSessionDetail | null | undefined>;
	getContainerTrace?: (
		containerId: string,
		query: KernelTraceReadQuery,
	) => Promise<KernelTraceSessionDetail | null | undefined>;
}

export interface CreateKernelTraceReadApiOptions {
	prefix?: string;
	maxLimit?: number;
	defaultLimit?: number;
}

export function parseKernelTraceLimit(
	value: string | number | null | undefined,
	opts: { fallback?: number; max?: number } = {},
): number {
	const fallback = opts.fallback ?? 5000;
	const max = opts.max ?? 10000;
	const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(1, Math.min(Math.floor(parsed), max));
}

function normalizePrefix(prefix: string): string {
	if (prefix === "/") return "";
	return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

export function createKernelTraceReadApi(
	service: KernelTraceReadService,
	options: CreateKernelTraceReadApiOptions = {},
) {
	const prefix = normalizePrefix(options.prefix ?? "/kernel");
	const defaultLimit = options.defaultLimit ?? 5000;
	const maxLimit = options.maxLimit ?? 10000;

	const makeQuery = (query: Record<string, string | undefined>): KernelTraceReadQuery => ({
		after: query.after ?? null,
		limit: parseKernelTraceLimit(query.limit, { fallback: defaultLimit, max: maxLimit }),
	});

	return new Elysia()
		.get(`${prefix}/trace-sessions`, async ({ query, set }) => {
			if (!service.listTraceSessions) {
				set.status = 404;
				return { error: "Kernel trace session list is not available" };
			}

			try {
				return await service.listTraceSessions(makeQuery(query));
			} catch (error) {
				console.error("Error listing kernel trace sessions:", error);
				set.status = 500;
				return { error: "Failed to list kernel trace sessions" };
			}
		})
		.get(`${prefix}/trace-sessions/:id`, async ({ params, query, set }) => {
			try {
				const detail = await service.getTraceSessionDetail(params.id, makeQuery(query));
				if (!detail) {
					set.status = 404;
					return { error: `Kernel trace session ${params.id} not found` };
				}
				return detail;
			} catch (error) {
				console.error("Error fetching kernel trace session detail:", error);
				set.status = 500;
				return { error: "Failed to fetch kernel trace session detail" };
			}
		})
		.get(`${prefix}/containers/:containerId/trace`, async ({ params, query, set }) => {
			try {
				const detail = await (service.getContainerTrace ?? service.getTraceSessionDetail)(
					params.containerId,
					makeQuery(query),
				);
				if (!detail) {
					set.status = 404;
					return { error: `Kernel container ${params.containerId} trace not found` };
				}
				return detail;
			} catch (error) {
				console.error("Error fetching kernel container trace:", error);
				set.status = 500;
				return { error: "Failed to fetch kernel container trace" };
			}
		});
}
