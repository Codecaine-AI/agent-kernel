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
import type {
	PromptEditSession as LabSession,
	PromptRequestFiling,
} from "@codecaine-ai/prompt-kit/ui/lab";
import type {
	CatalogAnnotationMutationSuccess,
	PromptEditSessionCreateRequest,
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
	/**
	 * Creates a session over EVERY open agent-request (the header strip's
	 * "Apply N notes"). Unscoped — the pre-gesture behavior.
	 */
	startSession(instruction?: string): Promise<void>;
	/**
	 * A composer submit with its disposition (run now / batch / global). All
	 * three persist the same way — one open agent-request annotation — and the
	 * lab follows a run-now filing with `runRequest`.
	 */
	fileRequest(filing: PromptRequestFiling): Promise<void>;
	/**
	 * RUN NOW: a session scoped to one annotation, started immediately. The
	 * agent stages a proposal for just that request; the human iterates with
	 * `rerunRequest` and settles with accept/reject. Accepts the lab-minted
	 * filing handle as well as a real sidecar id.
	 */
	runRequest(annotationId: string, instruction?: string): Promise<void>;
	/**
	 * APPLY: one session over the queued batch. Same lifecycle as run-now, one
	 * proposal per request, accepted in staging order.
	 */
	applyQueue(annotationIds: readonly string[], instruction?: string): Promise<void>;
	/**
	 * RE-RUN: reply on a live request's thread, which makes the server run
	 * another agent turn that REPLACES that request's staged proposal. Falls
	 * back to a plain sidecar reply when no session covers the annotation.
	 */
	rerunRequest(annotationId: string, replyText: string): Promise<void>;
	/** Dismiss a queued note: resolve its sidecar annotation as dismissed. */
	dismissRequest(annotationId: string): Promise<void>;
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
	if (typed && "reason" in typed) {
		// Create-route conflicts (409): discriminated by `reason`.
		switch (typed.reason) {
			case "agent-busy":
				return "Another prompt-edit session is already open for this agent — end it first.";
			case "empty-scope":
				return "That note is no longer an open request.";
		}
	}
	if (typed && "kind" in typed) {
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
	): Promise<CatalogAnnotationMutationSuccess | null> {
		let result = await run(annotationsHash ?? undefined);
		if (isPromptEditClientFailure(result) && result.status === 409) {
			await reloadAnnotations();
			result = await run(annotationsHash ?? undefined);
		}
		if (isPromptEditClientFailure(result)) {
			annotationsError = failureMessage(result);
			return null;
		}
		annotations = result.annotations.annotations;
		annotationsHash = result.hash;
		annotationsError = undefined;
		return result;
	}

	/**
	 * Files one annotate-mode request onto the sidecar and answers the id the
	 * KERNEL assigned it. The lab mints its own id when it files, so run-now and
	 * apply have to translate through `filings` below — the kernel's annotation
	 * POST does not take a caller-supplied id.
	 */
	async function addSidecarRequest(
		target: PromptAnnotationTarget | null,
		body: string,
	): Promise<string | null> {
		const result = await annotationMutation((expectedHash) =>
			client.addAnnotation({
				target: toAnnotationTarget(target, options.docId()),
				body,
				intent: "agent-request",
				author,
				...(expectedHash !== undefined ? { expectedHash } : {}),
			}),
		);
		return result?.annotation.id ?? null;
	}

	/**
	 * Lab-minted filing id → the sidecar id it became.
	 *
	 * The lab mints an id, calls `onFileRequest` WITHOUT awaiting it, then calls
	 * `onRunRequest(thatId)` in the same tick. The kernel assigns its own id on
	 * POST, so run-now/apply must wait for the in-flight filing and swap the id
	 * before they can scope a session to it. Ids the lab never minted (every
	 * request that came back from the sidecar) pass straight through.
	 */
	const filings = new Map<string, Promise<string | null>>();

	/**
	 * Annotation ids launched through `runRequest` — the session DTO carries no
	 * disposition, so this is the only record that a session request is a
	 * run-now (inline at the section) rather than a queue card. Lost on a page
	 * reload mid-run: the card then degrades to the queue until disposed.
	 */
	const runNowAnnotationIds = new Set<string>();

	/** Resolves a lab-facing request handle to a sidecar annotation id. */
	async function resolveAnnotationId(handle: string): Promise<string | null> {
		const pending = filings.get(handle);
		return pending === undefined ? handle : await pending;
	}

	function stopStream(): void {
		unsubscribeStream?.();
		unsubscribeStream = null;
	}

	/**
	 * A session whose every request is disposed and every proposal settled has
	 * nothing left to say — dispose it so the kernel's one-session-per-agent
	 * slot frees up (otherwise the NEXT run-now/Apply create silently refuses).
	 */
	function releaseSettledSession(): void {
		if (session === null) return;
		if (session.status !== "completed") return;
		if (session.agent.running || session.agent.rerunPending) return;
		const requestsDisposed = session.requests.every(
			(request) => request.status === "done" || request.status === "declined",
		);
		const proposalsSettled = session.proposals.every(
			(proposal) =>
				proposal.review === "applied" || proposal.review === "rejected",
		);
		if (requestsDisposed && proposalsSettled) void api.endSession();
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
		releaseSettledSession();
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
		releaseSettledSession();
		return true;
	}

	/**
	 * The one create path behind all three filing gestures — they differ only
	 * in the `requestIds` scope on the body (none = every open request, one =
	 * run now, many = apply the batch). Only one session may be live at a time
	 * (the kernel enforces the same rule per target agent), so a create while
	 * one is open is a no-op rather than a busy error the user did not ask for.
	 */
	async function beginSession(
		input: PromptEditSessionCreateRequest,
	): Promise<void> {
		if (session !== null || sessionStarting) return;
		sessionStarting = true;
		sessionError = undefined;
		notify();
		try {
			const result = await client.createSession(input);
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
	}

	async function refreshSessionState(sessionId: string): Promise<void> {
		const state = await client.getSession(sessionId);
		if (!isPromptEditClientFailure(state) && session !== null) {
			session = state.state;
		}
	}

	const api: PromptLabSessionController = {
		async load() {
			// Re-arm after dispose: the host memoizes the controller across
			// remounts (React StrictMode mounts, disposes, and mounts again with
			// the SAME instance), and a permanently-disposed controller would
			// silently drop every session event.
			disposed = false;
			await reloadAnnotations();
			notify();
		},

		startSession(instruction) {
			return beginSession(instruction !== undefined ? { instruction } : {});
		},

		async runRequest(annotationId, instruction) {
			// RUN NOW: scope the session to this one annotation so the agent's
			// <requests> block holds exactly it (server-side scoping). The id may
			// still be the lab-minted handle of a filing that is mid-POST.
			const resolved = await resolveAnnotationId(annotationId);
			if (resolved === null) {
				sessionError = annotationsError ?? "The note could not be filed.";
				notify();
				return;
			}
			runNowAnnotationIds.add(resolved);
			await beginSession({
				requestIds: [resolved],
				...(instruction !== undefined ? { instruction } : {}),
			});
		},

		async applyQueue(annotationIds, instruction) {
			if (annotationIds.length === 0) return;
			const resolved = (
				await Promise.all(annotationIds.map(resolveAnnotationId))
			).filter((id): id is string => id !== null);
			if (resolved.length === 0) return;
			await beginSession({
				requestIds: resolved,
				...(instruction !== undefined ? { instruction } : {}),
			});
		},

		async dismissRequest(annotationId) {
			// A queued note nobody ran: resolve the sidecar annotation as
			// dismissed — it leaves the open queue on the next annotations echo.
			const resolved = await resolveAnnotationId(annotationId);
			if (resolved === null) return;
			runNowAnnotationIds.delete(resolved);
			await annotationMutation((expectedHash) =>
				client.resolveAnnotation(resolved, {
					status: "resolved",
					resolution: "dismissed",
					...(expectedHash !== undefined ? { expectedHash } : {}),
				}),
			);
			notify();
		},

		async rerunRequest(annotationId, replyText) {
			const trimmed = replyText.trim();
			if (trimmed === "") return;
			// The lab keys re-runs by `requestRunId`: the annotation id when it
			// has one, else the alias — so match on both.
			const alias = session?.requests.find(
				(request) =>
					request.annotationId === annotationId ||
					request.alias === annotationId,
			)?.alias;
			if (alias !== undefined) {
				// The session reply is what triggers the server-side re-run turn:
				// the agent re-proposes, REPLACING the staged proposal.
				await api.replyToRequest(alias, trimmed);
				return;
			}
			// No live session covers this annotation — degrade to a sidecar reply
			// so the note is not lost; the next run picks it up as thread context.
			await annotationMutation((expectedHash) =>
				client.replyToAnnotation(annotationId, {
					author,
					body: trimmed,
					...(expectedHash !== undefined ? { expectedHash } : {}),
				}),
			);
			notify();
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
			await addSidecarRequest(target, trimmed);
			notify();
		},

		fileRequest(filing) {
			const trimmed = filing.body.trim();
			if (trimmed === "") return Promise.resolve();
			if (session !== null) {
				// Mid-session filing joins the live queue instead of the sidecar,
				// same as the disposition-blind onSendRequest path.
				return api.sendRequest(filing.target, trimmed);
			}
			// All three dispositions persist identically: one open agent-request
			// annotation. What differs is what happens NEXT — run-now follows with
			// onRunRequest, batch/global sit in the queue until Apply. A `global`
			// filing carries a null target, which maps to the document target.
			const pending = addSidecarRequest(filing.target, trimmed);
			// Registered BEFORE the await so the onRunRequest that fires in this
			// same tick finds it and waits rather than racing the POST.
			filings.set(filing.annotationId, pending);
			return pending.then(() => {
				notify();
			});
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
				// The filing gestures. onFileRequest persists ALL three
				// dispositions (the lab prefers it over onSendRequest when both
				// are present); run/apply/rerun are keyed by annotation id, not
				// alias, because they happen before a session (and its aliases)
				// exists.
				onFileRequest: (filing) => api.fileRequest(filing),
				onRunRequest: (annotationId) => api.runRequest(annotationId),
				onDismissRequest: (annotationId) => api.dismissRequest(annotationId),
				onApplyQueue: (annotationIds) => api.applyQueue(annotationIds),
				onRerunRequest: (annotationId, replyText) =>
					api.rerunRequest(annotationId, replyText),
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
			if (session !== null) {
				const data = toLabSessionData(session, options.docId());
				// Stamp run-now dispositions (the DTO has none) so those loops
				// render inline at the section instead of as queue cards.
				const requests = data.requests.map((request) =>
					request.annotationId !== undefined &&
					runNowAnnotationIds.has(request.annotationId)
						? { ...request, disposition: "run-now" as const }
						: request,
				);
				// Sidecar notes the session does not cover keep their queue cards —
				// a run-now scoped to one annotation must not blank the batch.
				const covered = new Set(
					requests
						.map((request) => request.annotationId)
						.filter((id): id is string => id !== undefined),
				);
				const leftovers = annotationsToLabRequests(annotations)
					.filter(
						(request) =>
							request.annotationId !== undefined &&
							!covered.has(request.annotationId),
					)
					.map((request, index) => ({
						...request,
						alias: `R${requests.length + index + 1}`,
					}));
				labSessionCache = {
					...data,
					requests: [...requests, ...leftovers],
					...callbacks,
				};
			} else {
				labSessionCache = {
					requests: annotationsToLabRequests(annotations),
					proposals: [],
					...callbacks,
				};
			}
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
