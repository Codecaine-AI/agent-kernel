/**
 * prompt-edit-client — typed fetch helpers for the kernel's annotation
 * sidecar routes (catalog-annotations-api.ts) and prompt-edit session routes
 * (prompt-edit-session-api.ts), plus a fetch-stream SSE subscriber.
 *
 * Conventions follow catalog-client.ts: every helper takes an injectable
 * `fetchImpl` (defaulting to global `fetch`) — that is the whole mocking
 * strategy — and HTTP-level failures come back as typed result objects, never
 * thrown. Only transport errors (fetch rejection) propagate.
 *
 * The SSE subscriber is fetch-stream based rather than EventSource: the
 * kernel's stream is plain `data: <json>\n\n` frames, a fetch reader works
 * against an in-process Elysia `app.handle` Response in tests, and browsers
 * stream fetch bodies natively. No auto-reconnect (dev-harness surface); the
 * `onError` callback surfaces transport drops so a host can resubscribe.
 */
import {
	KERNEL_CATALOG_PATHS,
	KERNEL_PROMPT_EDIT_SESSION_PATHS,
	type CatalogAgentDetail,
	type CatalogAnnotationAddRequest,
	type CatalogAnnotationMutationSuccess,
	type CatalogAnnotationReplyRequest,
	type CatalogAnnotationResolveRequest,
	type CatalogAnnotationsResponse,
	type PromptEditSessionAcceptSuccess,
	type PromptEditSessionAddRequestBody,
	type PromptEditSessionCreateFailure,
	type PromptEditSessionCreateRequest,
	type PromptEditSessionEventDto,
	type PromptEditSessionRejectSuccess,
	type PromptEditSessionReviewFailure,
	type PromptEditSessionStateDto,
	type PromptEditSessionUndoSuccess,
} from "@agent-kernel/viewer-core";

type PromptEditFetch = (
	input: string,
	init?: RequestInit,
) => Promise<Response>;

/** Uniform HTTP-level failure for every mutation helper. */
export interface PromptEditClientFailure {
	ok: false;
	status: number;
	/** Human-readable messages (server `errors`, `error`, or a fallback). */
	errors: string[];
	/** Present on the 409 stale-hash idiom (annotations + session saves). */
	currentHash?: string | null;
	/**
	 * Present on session review conflicts (accept/reject/undo 4xx bodies) and
	 * on the create route's 409s (agent-busy / empty-scope). Review failures
	 * are discriminated by `kind`, create failures by `reason`.
	 */
	failure?: PromptEditSessionReviewFailure | PromptEditSessionCreateFailure;
}

export type PromptEditClientResult<T> = T | PromptEditClientFailure;

export function isPromptEditClientFailure<T>(
	result: PromptEditClientResult<T>,
): result is PromptEditClientFailure {
	return (
		typeof result === "object" &&
		result !== null &&
		"ok" in result &&
		(result as { ok: unknown }).ok === false &&
		"status" in result
	);
}

/**
 * The client surface the lab container consumes, scoped to one agent on one
 * kernel origin. Kept as an interface so container/controller tests fake it
 * wholesale without any fetch plumbing.
 */
export interface PromptEditClient {
	loadAgentDetail(): Promise<CatalogAgentDetail>;
	listAnnotations(): Promise<CatalogAnnotationsResponse>;
	addAnnotation(
		input: CatalogAnnotationAddRequest,
	): Promise<PromptEditClientResult<CatalogAnnotationMutationSuccess>>;
	replyToAnnotation(
		annotationId: string,
		input: CatalogAnnotationReplyRequest,
	): Promise<PromptEditClientResult<CatalogAnnotationMutationSuccess>>;
	resolveAnnotation(
		annotationId: string,
		input: CatalogAnnotationResolveRequest,
	): Promise<PromptEditClientResult<CatalogAnnotationMutationSuccess>>;
	createSession(
		input?: PromptEditSessionCreateRequest,
	): Promise<PromptEditClientResult<{ state: PromptEditSessionStateDto }>>;
	getSession(
		sessionId: string,
	): Promise<PromptEditClientResult<{ state: PromptEditSessionStateDto }>>;
	addSessionRequest(
		sessionId: string,
		input: PromptEditSessionAddRequestBody,
	): Promise<PromptEditClientResult<{ ok: true }>>;
	replyToSessionRequest(
		sessionId: string,
		alias: string,
		body: string,
	): Promise<PromptEditClientResult<{ ok: true }>>;
	acceptProposal(
		sessionId: string,
		alias: string,
	): Promise<PromptEditClientResult<PromptEditSessionAcceptSuccess>>;
	rejectProposal(
		sessionId: string,
		alias: string,
		note?: string,
	): Promise<PromptEditClientResult<PromptEditSessionRejectSuccess>>;
	undoProposal(
		sessionId: string,
		alias: string,
	): Promise<PromptEditClientResult<PromptEditSessionUndoSuccess>>;
	disposeSession(
		sessionId: string,
	): Promise<PromptEditClientResult<{ ok: true }>>;
	/**
	 * Subscribes to the session SSE stream. Events arrive parsed; the stream
	 * opens with `session-state` and ends after `session-disposed`. Returns an
	 * unsubscribe that aborts the underlying request.
	 */
	subscribeSessionEvents(
		sessionId: string,
		onEvent: (event: PromptEditSessionEventDto) => void,
		onError?: (error: Error) => void,
	): () => void;
}

export interface CreatePromptEditClientOptions {
	/** Kernel API origin, e.g. "http://localhost:4477" or "/api/agent". */
	origin: string;
	agentName: string;
	fetchImpl?: PromptEditFetch;
}

/**
 * Incremental SSE frame parser: feed raw text chunks, get back the unparsed
 * remainder; `data:` payloads are JSON-parsed and emitted. Exported for tests.
 */
export function feedSseChunk(
	buffer: string,
	emit: (event: PromptEditSessionEventDto) => void,
): string {
	let rest = buffer;
	for (;;) {
		const frameEnd = rest.indexOf("\n\n");
		if (frameEnd === -1) return rest;
		const frame = rest.slice(0, frameEnd);
		rest = rest.slice(frameEnd + 2);
		const data = frame
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (!data) continue;
		try {
			emit(JSON.parse(data) as PromptEditSessionEventDto);
		} catch {
			// Malformed frame: skip — the stream stays alive.
		}
	}
}

async function toFailure(response: Response): Promise<PromptEditClientFailure> {
	let body: Record<string, unknown> = {};
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		// Non-JSON body: fall through to the status fallback.
	}
	const errors: string[] = [];
	if (Array.isArray(body.errors)) {
		errors.push(...body.errors.filter((e): e is string => typeof e === "string"));
	}
	if (typeof body.error === "string") errors.push(body.error);
	if (errors.length === 0) errors.push(`Request failed (${response.status})`);
	const failure: PromptEditClientFailure = {
		ok: false,
		status: response.status,
		errors,
	};
	if ("currentHash" in body) {
		failure.currentHash = body.currentHash as string | null;
	}
	if (body.failure && typeof body.failure === "object") {
		failure.failure = body.failure as
			| PromptEditSessionReviewFailure
			| PromptEditSessionCreateFailure;
	}
	return failure;
}

export function createPromptEditClient(
	options: CreatePromptEditClientOptions,
): PromptEditClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const origin = options.origin.endsWith("/")
		? options.origin.slice(0, -1)
		: options.origin;
	const agent = options.agentName;

	const url = (path: string) => `${origin}${path}`;

	async function request<T>(
		path: string,
		init?: RequestInit,
	): Promise<PromptEditClientResult<T>> {
		const response = await fetchImpl(url(path), init);
		if (!response.ok) return toFailure(response);
		return (await response.json()) as T;
	}

	const post = <T>(path: string, body?: unknown) =>
		request<T>(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {}),
		});

	return {
		async loadAgentDetail() {
			const response = await fetchImpl(
				url(KERNEL_CATALOG_PATHS.agentDetail(agent)),
			);
			if (!response.ok) {
				throw new Error(`agent request failed (${response.status})`);
			}
			return (await response.json()) as CatalogAgentDetail;
		},

		async listAnnotations() {
			const response = await fetchImpl(
				url(KERNEL_CATALOG_PATHS.agentAnnotations(agent)),
			);
			if (!response.ok) {
				throw new Error(`annotations request failed (${response.status})`);
			}
			return (await response.json()) as CatalogAnnotationsResponse;
		},

		addAnnotation(input) {
			return post<CatalogAnnotationMutationSuccess>(
				KERNEL_CATALOG_PATHS.agentAnnotations(agent),
				input,
			);
		},

		replyToAnnotation(annotationId, input) {
			return post<CatalogAnnotationMutationSuccess>(
				KERNEL_CATALOG_PATHS.agentAnnotationReplies(agent, annotationId),
				input,
			);
		},

		resolveAnnotation(annotationId, input) {
			return post<CatalogAnnotationMutationSuccess>(
				KERNEL_CATALOG_PATHS.agentAnnotationResolve(agent, annotationId),
				input,
			);
		},

		createSession(input) {
			return post<{ state: PromptEditSessionStateDto }>(
				KERNEL_CATALOG_PATHS.agentEditSessions(agent),
				input ?? {},
			);
		},

		getSession(sessionId) {
			return request<{ state: PromptEditSessionStateDto }>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.session(sessionId),
			);
		},

		addSessionRequest(sessionId, input) {
			return post<{ ok: true }>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.requests(sessionId),
				input,
			);
		},

		replyToSessionRequest(sessionId, alias, body) {
			return post<{ ok: true }>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.replies(sessionId, alias),
				{ body },
			);
		},

		acceptProposal(sessionId, alias) {
			return post<PromptEditSessionAcceptSuccess>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.accept(sessionId, alias),
			);
		},

		rejectProposal(sessionId, alias, note) {
			return post<PromptEditSessionRejectSuccess>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.reject(sessionId, alias),
				note === undefined ? {} : { note },
			);
		},

		undoProposal(sessionId, alias) {
			return post<PromptEditSessionUndoSuccess>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.undo(sessionId, alias),
			);
		},

		disposeSession(sessionId) {
			return request<{ ok: true }>(
				KERNEL_PROMPT_EDIT_SESSION_PATHS.session(sessionId),
				{ method: "DELETE" },
			);
		},

		subscribeSessionEvents(sessionId, onEvent, onError) {
			const controller = new AbortController();
			let closed = false;
			(async () => {
				try {
					const response = await fetchImpl(
						url(KERNEL_PROMPT_EDIT_SESSION_PATHS.events(sessionId)),
						{ signal: controller.signal },
					);
					if (!response.ok || !response.body) {
						throw new Error(`event stream failed (${response.status})`);
					}
					const reader = response.body.getReader();
					const decoder = new TextDecoder();
					let buffer = "";
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						buffer = feedSseChunk(buffer, (event) => {
							if (!closed) onEvent(event);
						});
					}
				} catch (cause) {
					if (closed || controller.signal.aborted) return;
					onError?.(
						cause instanceof Error ? cause : new Error(String(cause)),
					);
				}
			})();
			return () => {
				closed = true;
				controller.abort();
			};
		},
	};
}
