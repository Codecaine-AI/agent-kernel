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

/**
 * Blob bytes + serving metadata for the content-addressed blob route. `data`
 * may be a Node Buffer (what the db hands back) or any Uint8Array.
 */
export interface KernelTraceBlobPayload {
	data: Uint8Array | Buffer;
	mimeType: string;
	byteLength: number;
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
	/**
	 * Optional blob support: content-addressed trace blob bytes by hash
	 * ("b1-<sha256hex>"). When absent the blob route answers 404.
	 */
	getBlob?: (hash: string) => Promise<KernelTraceBlobPayload | null | undefined>;
	/**
	 * Optional per-turn request snapshot support: the resolved model context
	 * for one turn of one run (see KernelRunTurnContext in read-service.ts).
	 * When absent the turn-context route answers 404.
	 */
	getRunTurnContext?: (
		runId: string,
		turnNumber: number,
	) => Promise<unknown | null | undefined>;
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

/**
 * Content-address shape for trace blobs ("b1-" + sha256hex). Anything else
 * 404s before reaching the service/db.
 */
const TRACE_BLOB_HASH_RE = /^b1-[0-9a-f]{64}$/;

/** Non-negative integer route param, or null when malformed. */
function parseTurnNumber(value: string): number | null {
	if (!/^\d+$/.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
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
		)
		.get(`${prefix}/blobs/:hash`, async ({ params, set }) => {
			if (!service.getBlob) {
				set.status = 404;
				return { error: "Kernel trace blob store is not available" };
			}

			const hash = params.hash;
			if (!TRACE_BLOB_HASH_RE.test(hash)) {
				set.status = 404;
				return { error: "Kernel trace blob not found" };
			}

			try {
				const blob = await service.getBlob(hash);
				if (!blob) {
					set.status = 404;
					return { error: `Kernel trace blob ${hash} not found` };
				}

				// Copy into a fresh ArrayBuffer-backed Uint8Array — Buffer's
				// SharedArrayBuffer-typed backing store does not satisfy BodyInit.
				const bytes = new Uint8Array(blob.data.byteLength);
				bytes.set(blob.data);
				return new Response(bytes, {
					headers: {
						"content-type": blob.mimeType,
						// Content-addressed by hash, so bytes never change.
						"cache-control": "public, max-age=31536000, immutable",
					},
				});
			} catch (error) {
				console.error("Error fetching kernel trace blob:", error);
				set.status = 500;
				return { error: "Failed to fetch kernel trace blob" };
			}
		})
		.get(`${prefix}/runs/:runId/turns/:turnNumber/context`, async ({ params, set }) => {
			if (!service.getRunTurnContext) {
				set.status = 404;
				return { error: "Kernel run turn context is not available" };
			}

			const turnNumber = parseTurnNumber(params.turnNumber);
			if (turnNumber === null) {
				set.status = 404;
				return {
					error: `Kernel run ${params.runId} turn ${params.turnNumber} context not found`,
				};
			}

			try {
				const context = await service.getRunTurnContext(params.runId, turnNumber);
				if (!context) {
					set.status = 404;
					return {
						error: `Kernel run ${params.runId} turn ${turnNumber} context not found`,
					};
				}
				return context;
			} catch (error) {
				console.error("Error fetching kernel run turn context:", error);
				set.status = 500;
				return { error: "Failed to fetch kernel run turn context" };
			}
		});
}
