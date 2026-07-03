/**
 * Kernel trace read API — an Elysia route factory over an app-provided read
 * service. Container-first: GET /kernel/containers/:containerId/trace is the
 * primary route. The trace-sessions routes are container-backed — a "trace
 * session" is a container of kind "session", so the detail route delegates to
 * the container trace and the list route lists session containers.
 *
 * Payload shapes stay app-provided (the viewer defines what a trace detail
 * looks like); the kernel only owns the routing + query normalization.
 */
import { Elysia } from "elysia";

export interface KernelTraceReadQuery {
	after?: string | null;
	limit?: number;
}

export interface KernelTraceReadService<TDetail = unknown, TList = unknown> {
	/** Primary read: the full trace for one container subtree. */
	getContainerTrace: (
		containerId: string,
		query: KernelTraceReadQuery,
	) => Promise<TDetail | null | undefined>;
	/**
	 * Optional list support: containers of kind "session" for the
	 * trace-sessions index. When absent the list route answers 404.
	 */
	listSessionContainers?: (query: KernelTraceReadQuery) => Promise<TList>;
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

export function createKernelTraceReadApi<TDetail = unknown, TList = unknown>(
	service: KernelTraceReadService<TDetail, TList>,
	options: CreateKernelTraceReadApiOptions = {},
) {
	const prefix = normalizePrefix(options.prefix ?? "/kernel");
	const defaultLimit = options.defaultLimit ?? 5000;
	const maxLimit = options.maxLimit ?? 10000;

	const makeQuery = (query: Record<string, string | undefined>): KernelTraceReadQuery => ({
		after: query.after ?? null,
		limit: parseKernelTraceLimit(query.limit, { fallback: defaultLimit, max: maxLimit }),
	});

	const serveContainerTrace = async (
		containerId: string,
		query: Record<string, string | undefined>,
		set: { status?: number | string },
	) => {
		try {
			const detail = await service.getContainerTrace(containerId, makeQuery(query));
			if (!detail) {
				set.status = 404;
				return { error: `Kernel container ${containerId} trace not found` };
			}
			return detail;
		} catch (error) {
			console.error("Error fetching kernel container trace:", error);
			set.status = 500;
			return { error: "Failed to fetch kernel container trace" };
		}
	};

	return new Elysia()
		.get(`${prefix}/containers/:containerId/trace`, ({ params, query, set }) =>
			serveContainerTrace(params.containerId, query, set),
		)
		.get(`${prefix}/trace-sessions`, async ({ query, set }) => {
			if (!service.listSessionContainers) {
				set.status = 404;
				return { error: "Kernel session container list is not available" };
			}

			try {
				return await service.listSessionContainers(makeQuery(query));
			} catch (error) {
				console.error("Error listing kernel session containers:", error);
				set.status = 500;
				return { error: "Failed to list kernel session containers" };
			}
		})
		.get(`${prefix}/trace-sessions/:id`, ({ params, query, set }) =>
			// Container-backed: a trace session is a container of kind "session".
			serveContainerTrace(params.id, query, set),
		);
}
