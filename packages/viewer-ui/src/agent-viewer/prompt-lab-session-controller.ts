/**
 * prompt-lab-session-controller — the state half of AgentPromptLabContainer's
 * annotate→session→review wiring, kept framework-free so behavior tests run
 * without a DOM (viewer-ui has no DOM test infra; React components here are
 * SSR-string tested only).
 *
 * Owns:
 * - the sidecar annotation mirror (GET on load, POSTs from the lab composer /
 *   rail — the container passes `onSendRequest`, so the lab's in-memory store
 *   fallback is never written);
 * - the session lifecycle: create → SSE subscribe → event reduction into a
 *   local `PromptEditSessionStateDto` mirror → review calls
 *   (accept/reject/undo) reduced locally AND idempotently re-applied when the
 *   stream echoes them;
 * - the lab `promptEditSession` prop: DTO state mapped through
 *   prompt-edit-session-view with the controller's callbacks bound.
 *
 * Prompt refreshes: every applied/undone hash (HTTP response or stream event)
 * funnels through one `refreshPrompt(hash)` that dedupes on the hash, so the
 * container refetches the agent detail exactly once per revision move.
 *
 * Annotation mutations carry the tracked sidecar hash as `expectedHash` and
 * retry ONCE on the 409 { currentHash } idiom after re-listing — the lab is
 * single-user, so a conflict means our mirror was stale, not a lost race.
 */
import type {
	PromptAnnotation,
	PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";
import type { PromptEditSession as LabSession } from "@codecaine-ai/prompt-kit/ui/lab";
import type {
	CatalogAnnotationMutationSuccess,
	PromptEditSessionEventDto,
	PromptEditSessionStateDto,
} from "@agent-kernel/viewer-core";

import {
	isPromptEditClientFailure,
	type PromptEditClient,
	type PromptEditClientFailure,
	type PromptEditClientResult,
} from "./prompt-edit-client";
import {
	annotationsToLabRequests,
	applySessionEvent,
	toAnnotationTarget,
	toLabSessionData,
	toSessionTarget,
} from "./prompt-edit-session-view";

export interface PromptLabSessionSnapshot {
	annotationsLoaded: boolean;
	annotations: readonly PromptAnnotation[];
	annotationsHash: string | null;
	/** Open agent-request annotations — the "Apply N notes" count. */
	openRequestCount: number;
	annotationsError?: string;
	session: PromptEditSessionStateDto | null;
	sessionStarting: boolean;
	/** Last review/session mutation problem, cleared by the next success. */
	sessionError?: string;
	/** SSE transport drop (the session may still be live server-side). */
	streamError?: string;
}

export interface PromptLabSessionControllerOptions {
	client: PromptEditClient;
	/** Current prompt document id (target mapping). Read lazily — the
	 * container's detail loads async. */
	docId: () => string;
	/**
	 * Called once per revision move (accept/undo hash), so the host refetches
	 * the agent detail: new prompt document + promptHash + savedHash, letting
	 * accepted text render as normal rows.
	 */
	onPromptRefresh: (hash: string) => void | Promise<void>;
	/** Author recorded on sidecar annotations/replies created here. */
	annotationAuthor?: string;
}

export interface PromptLabSessionController {
	/** Loads the sidecar annotations. Call once on mount. */
	load(): Promise<void>;
	startSession(instruction?: string): Promise<void>;
	/** DELETEs the session server-side and drops the local mirror. */
	endSession(): Promise<void>;
	accept(alias: string): Promise<void>;
	reject(alias: string, note?: string): Promise<void>;
	undo(alias: string): Promise<void>;
	acceptAll(): Promise<void>;
	sendRequest(
		target: PromptAnnotationTarget | null,
		body: string,
	): Promise<void>;
	replyToRequest(alias: string, body: string): Promise<void>;
	/** The lab's `promptEditSession` prop for the current state (stable
	 * identity until the state changes). Null before annotations load. */
	labSession(): LabSession | null;
	getSnapshot(): PromptLabSessionSnapshot;
	subscribe(listener: () => void): () => void;
	/** Drops the SSE subscription and listeners. The server-side session (and
	 * any live agent run) is left alone — ending it is `endSession`. */
	dispose(): void;
}

function failureMessage(failure: PromptEditClientFailure): string {
	const typed = failure.failure;
	if (typed) {
		switch (typed.kind) {
			case "writes_disabled":
				return "Catalog writes are disabled on this kernel.";
			case "out_of_order":
				return `Accept ${typed.nextAlias} first — accepts apply in staging order.`;
			case "proposal_not_latest":
				return `Only the latest staged proposal (${typed.latestAlias}) can be rejected.`;
			case "not_latest_applied":
				return `Undo ${typed.lastAppliedAlias} first — only the most recent applied change can be undone.`;
			case "stale_base":
				return "The saved prompt moved since this session's last write — further accepts need a fresh session.";
			case "already_applied":
				return `${typed.alias} is already applied.`;
			case "no_staged_proposal":
				return `${typed.alias} has no staged proposal.`;
			case "not_applied":
				return `${typed.alias} is not applied.`;
			case "unknown_request":
				return `Request ${typed.alias} not found.`;
			case "save_failed":
				return typed.errors.join("; ");
			case "discard_failed":
				return typed.message;
		}
	}
	return failure.errors.join("; ");
}

export function createPromptLabSessionController(
	options: PromptLabSessionControllerOptions,
): PromptLabSessionController {
	const { client } = options;
	const author = options.annotationAuthor ?? "human";
	const listeners = new Set<() => void>();

	let annotationsLoaded = false;
	let annotations: readonly PromptAnnotation[] = [];
	let annotationsHash: string | null = null;
	let annotationsError: string | undefined;
	let session: PromptEditSessionStateDto | null = null;
	let sessionStarting = false;
	let sessionError: string | undefined;
	let streamError: string | undefined;
	let unsubscribeStream: (() => void) | null = null;
	let lastRefreshedHash: string | null = null;
	let disposed = false;

	let snapshotCache: PromptLabSessionSnapshot | null = null;
	let labSessionCache: LabSession | null = null;
	let labSessionDirty = true;

	function notify(): void {
		snapshotCache = null;
		labSessionDirty = true;
		for (const listener of [...listeners]) listener();
	}

	async function refreshPrompt(hash: string): Promise<void> {
		if (hash === lastRefreshedHash) return;
		lastRefreshedHash = hash;
		await options.onPromptRefresh(hash);
	}

	async function reloadAnnotations(): Promise<void> {
		try {
			const listed = await client.listAnnotations();
			annotations = listed.annotations.annotations;
			annotationsHash = listed.hash;
			annotationsLoaded = true;
			annotationsError = undefined;
		} catch (cause) {
			annotationsError =
				cause instanceof Error ? cause.message : "annotations unavailable";
		}
	}

	/** Runs an annotation mutation with the tracked hash; on the 409 idiom
	 * re-lists once and retries against the fresh hash. */
	async function annotationMutation(
		run: (
			expectedHash: string | undefined,
		) => Promise<PromptEditClientResult<CatalogAnnotationMutationSuccess>>,
	): Promise<void> {
		let result = await run(annotationsHash ?? undefined);
		if (isPromptEditClientFailure(result) && result.status === 409) {
			await reloadAnnotations();
			result = await run(annotationsHash ?? undefined);
		}
		if (isPromptEditClientFailure(result)) {
			annotationsError = failureMessage(result);
			return;
		}
		annotations = result.annotations.annotations;
		annotationsHash = result.hash;
		annotationsError = undefined;
	}

	function stopStream(): void {
		unsubscribeStream?.();
		unsubscribeStream = null;
	}

	function handleEvent(event: PromptEditSessionEventDto): void {
		if (disposed) return;
		if (event.type === "session-disposed") {
			stopStream();
			session = null;
			notify();
			void reloadAnnotations().then(notify);
			return;
		}
		if (session === null) return;
		session = applySessionEvent(session, event);
		notify();
		if (event.type === "proposal-applied" || event.type === "proposal-undone") {
			void refreshPrompt(event.hash).then(notify);
		}
		if (event.type === "proposal-applied") {
			// The accept resolved the sidecar annotation server-side.
			void reloadAnnotations().then(notify);
		}
	}

	function subscribeStream(sessionId: string): void {
		stopStream();
		streamError = undefined;
		unsubscribeStream = client.subscribeSessionEvents(
			sessionId,
			handleEvent,
			(error) => {
				streamError = error.message;
				notify();
			},
		);
	}

	/** Shared review-mutation shape: run the call, surface typed failures,
	 * reduce the success into the local mirror (idempotent with the stream's
	 * echo of the same event). Returns success. */
	async function reviewCall<T extends { ok: true }>(
		run: () => Promise<PromptEditClientResult<T>>,
		reduce: (result: T) => PromptEditSessionEventDto,
	): Promise<boolean> {
		if (session === null) return false;
		const result = await run();
		if (isPromptEditClientFailure(result)) {
			sessionError = failureMessage(result);
			notify();
			return false;
		}
		sessionError = undefined;
		if (session !== null) {
			session = applySessionEvent(session, reduce(result));
		}
		notify();
		return true;
	}

	async function refreshSessionState(sessionId: string): Promise<void> {
		const state = await client.getSession(sessionId);
		if (!isPromptEditClientFailure(state) && session !== null) {
			session = state.state;
		}
	}

	const api: PromptLabSessionController = {
		async load() {
			await reloadAnnotations();
			notify();
		},

		async startSession(instruction) {
			if (session !== null || sessionStarting) return;
			sessionStarting = true;
			sessionError = undefined;
			notify();
			try {
				const result = await client.createSession(
					instruction !== undefined ? { instruction } : {},
				);
				if (isPromptEditClientFailure(result)) {
					sessionError = failureMessage(result);
					return;
				}
				session = result.state;
				lastRefreshedHash = result.state.currentHash;
				subscribeStream(result.state.sessionId);
			} catch (cause) {
				sessionError =
					cause instanceof Error ? cause.message : "session create failed";
			} finally {
				sessionStarting = false;
				notify();
			}
		},

		async endSession() {
			if (session === null) return;
			const sessionId = session.sessionId;
			stopStream();
			session = null;
			notify();
			const result = await client.disposeSession(sessionId);
			if (isPromptEditClientFailure(result) && result.status !== 404) {
				sessionError = failureMessage(result);
			}
			await reloadAnnotations();
			notify();
		},

		async accept(alias) {
			if (session === null) return;
			const sessionId = session.sessionId;
			const ok = await reviewCall(
				() => client.acceptProposal(sessionId, alias),
				(result) => ({
					type: "proposal-applied",
					sessionId,
					alias,
					transactionId: result.transactionId,
					hash: result.hash,
				}),
			);
			if (!ok) return;
			if (session !== null) await refreshPrompt(session.currentHash);
			await reloadAnnotations();
			notify();
		},

		async reject(alias, note) {
			if (session === null) return;
			const sessionId = session.sessionId;
			const ok = await reviewCall(
				() => client.rejectProposal(sessionId, alias, note),
				(result) => ({
					type: "proposal-rejected",
					sessionId,
					alias,
					transactionId: result.transactionId,
					...(note !== undefined ? { note } : {}),
				}),
			);
			if (!ok) return;
			await reloadAnnotations();
			notify();
		},

		async undo(alias) {
			if (session === null) return;
			const sessionId = session.sessionId;
			const ok = await reviewCall(
				() => client.undoProposal(sessionId, alias),
				(result) => ({
					type: "proposal-undone",
					sessionId,
					alias,
					transactionId: result.transactionId,
					hash: result.hash,
				}),
			);
			if (!ok) return;
			if (session !== null) await refreshPrompt(session.currentHash);
			notify();
		},

		async acceptAll() {
			// Sequential by contract: accepts consume in staging order, every
			// accept is its own revision.
			for (;;) {
				const alias = session?.nextAcceptAlias ?? null;
				if (alias === null) return;
				await api.accept(alias);
				if (session === null || sessionError !== undefined) return;
				if (session.nextAcceptAlias === alias) return; // no progress
			}
		},

		async sendRequest(target, body) {
			const trimmed = body.trim();
			if (trimmed === "") return;
			if (session !== null) {
				const sessionId = session.sessionId;
				const result = await client.addSessionRequest(sessionId, {
					target: toSessionTarget(target),
					body: trimmed,
				});
				if (isPromptEditClientFailure(result)) {
					sessionError = failureMessage(result);
					notify();
					return;
				}
				sessionError = undefined;
				// The add answers { ok, request }; re-snapshot rather than
				// relying on a stream echo for host-side adds.
				await refreshSessionState(sessionId);
				notify();
				return;
			}
			await annotationMutation((expectedHash) =>
				client.addAnnotation({
					target: toAnnotationTarget(target, options.docId()),
					body: trimmed,
					intent: "agent-request",
					author,
					...(expectedHash !== undefined ? { expectedHash } : {}),
				}),
			);
			notify();
		},

		async replyToRequest(alias, body) {
			const trimmed = body.trim();
			if (trimmed === "") return;
			if (session !== null) {
				const sessionId = session.sessionId;
				const result = await client.replyToSessionRequest(
					sessionId,
					alias,
					trimmed,
				);
				if (isPromptEditClientFailure(result)) {
					sessionError = failureMessage(result);
				} else {
					sessionError = undefined;
					await refreshSessionState(sessionId);
				}
				notify();
				return;
			}
			const request = annotationsToLabRequests(annotations).find(
				(candidate) => candidate.alias === alias,
			);
			if (request?.annotationId === undefined) return;
			const annotationId = request.annotationId;
			await annotationMutation((expectedHash) =>
				client.replyToAnnotation(annotationId, {
					author,
					body: trimmed,
					...(expectedHash !== undefined ? { expectedHash } : {}),
				}),
			);
			notify();
		},

		labSession() {
			if (!labSessionDirty && labSessionCache !== null) {
				return labSessionCache;
			}
			labSessionDirty = false;
			if (!annotationsLoaded && session === null) {
				labSessionCache = null;
				return null;
			}
			const callbacks: Partial<LabSession> = {
				onSendRequest: (target, body) => api.sendRequest(target, body),
				onReplyToRequest: (alias, body) => api.replyToRequest(alias, body),
				...(session !== null
					? {
							onAccept: (alias: string) => api.accept(alias),
							onReject: (alias: string, note?: string) =>
								api.reject(alias, note),
							onUndo: (alias: string) => api.undo(alias),
							onAcceptAll: () => api.acceptAll(),
						}
					: {}),
			};
			labSessionCache =
				session !== null
					? { ...toLabSessionData(session, options.docId()), ...callbacks }
					: {
							requests: annotationsToLabRequests(annotations),
							proposals: [],
							...callbacks,
						};
			return labSessionCache;
		},

		getSnapshot() {
			if (snapshotCache !== null) return snapshotCache;
			snapshotCache = {
				annotationsLoaded,
				annotations,
				annotationsHash,
				openRequestCount: annotations.filter(
					(annotation) =>
						annotation.status === "open" &&
						annotation.intent === "agent-request",
				).length,
				...(annotationsError !== undefined ? { annotationsError } : {}),
				session,
				sessionStarting,
				...(sessionError !== undefined ? { sessionError } : {}),
				...(streamError !== undefined ? { streamError } : {}),
			};
			return snapshotCache;
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		dispose() {
			disposed = true;
			stopStream();
			listeners.clear();
		},
	};

	return api;
}
