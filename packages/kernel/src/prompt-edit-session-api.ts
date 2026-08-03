/**
 * Kernel prompt-edit session routes — the HTTP surface over the Phase 2
 * session lifecycle service (prompt-edit-session/service.ts). Mounted by
 * createKernelCatalogApi when a session service is provided (one-line .use()
 * wiring, like the annotation routes), or used standalone:
 *
 *   POST   <prefix>/catalog/agents/:name/edit-sessions
 *            body: { instruction?, extraRequests?, sessionId?, spawn? }
 *   GET    <prefix>/prompt-edit-sessions                      listing
 *   GET    <prefix>/prompt-edit-sessions/:id                  state snapshot
 *   GET    <prefix>/prompt-edit-sessions/:id/events           SSE stream
 *   POST   <prefix>/prompt-edit-sessions/:id/requests         add human request
 *   POST   <prefix>/prompt-edit-sessions/:id/requests/:alias/accept
 *   POST   <prefix>/prompt-edit-sessions/:id/requests/:alias/reject
 *            body: { note? }
 *   POST   <prefix>/prompt-edit-sessions/:id/requests/:alias/undo
 *   POST   <prefix>/prompt-edit-sessions/:id/requests/:alias/replies
 *            body: { body }
 *   DELETE <prefix>/prompt-edit-sessions/:id                  dispose
 *
 * Conventions mirror the catalog routes: every mutation answers 403 unless
 * writes are enabled (local-dev trust model), 404 for an unknown agent /
 * session / request alias, 409 for review-order conflicts (stale base with
 * { currentHash } — the savePrompt idiom — plus out-of-order accepts,
 * non-latest rejects/undos, already-applied), and 400 + { errors } for
 * invalid input.
 *
 * The SSE stream sends one `session-state` snapshot event on connect, then
 * forwards EVERY service stream event (session events + review events) as
 * `data: <json>\n\n` frames, ending after `session-disposed`.
 */
import { Elysia } from "elysia";

import type {
	AcceptPromptEditProposalResult,
	PromptEditSessionService,
	RejectPromptEditProposalResult,
	UndoAcceptedProposalResult,
} from "./prompt-edit-session/service";

export interface CreateKernelPromptEditSessionApiOptions {
	prefix?: string;
	/** Overrides the service's write gate when provided. */
	allowWrites?: boolean;
}

function normalizePrefix(prefix: string): string {
	if (prefix === "/") return "";
	return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ReviewResult =
	| AcceptPromptEditProposalResult
	| RejectPromptEditProposalResult
	| UndoAcceptedProposalResult;

/** Shared failure mapping for accept/reject/undo. */
function answerReview(
	result: ReviewResult | null,
	sessionId: string,
	set: { status?: number | string },
): unknown {
	if (result === null) {
		set.status = 404;
		return { error: `Prompt-edit session ${sessionId} not found` };
	}
	if (result.ok) return result;
	const failure = result.failure;
	switch (failure.kind) {
		case "writes_disabled":
			set.status = 403;
			return {
				error:
					"Catalog writes are disabled — the kernel is not running in dev mode",
			};
		case "unknown_request":
			set.status = 404;
			return { error: `Request ${failure.alias} not found`, failure };
		case "save_failed":
			set.status = 400;
			return { errors: failure.errors, failure };
		case "stale_base":
			// The savePrompt 409 idiom: the live prompt moved under the session.
			set.status = 409;
			return { currentHash: failure.currentHash, failure };
		default:
			// Review-order conflicts: out_of_order, no_staged_proposal,
			// already_applied, proposal_not_latest, not_applied,
			// not_latest_applied, discard_failed.
			set.status = 409;
			return { failure };
	}
}

export function createKernelPromptEditSessionApi(
	sessions: PromptEditSessionService,
	options: CreateKernelPromptEditSessionApiOptions = {},
) {
	const prefix = normalizePrefix(options.prefix ?? "/kernel");
	const allowWrites = options.allowWrites ?? sessions.allowWrites;

	const readOnly = (set: { status?: number | string }) => {
		set.status = 403;
		return {
			error: "Catalog writes are disabled — the kernel is not running in dev mode",
		};
	};

	const notFound = (sessionId: string, set: { status?: number | string }) => {
		set.status = 404;
		return { error: `Prompt-edit session ${sessionId} not found` };
	};

	return new Elysia()
		.post(
			`${prefix}/catalog/agents/:name/edit-sessions`,
			async ({ params, body, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					const input = body === undefined || body === null ? {} : body;
					if (!isPlainObject(input)) {
						set.status = 400;
						return { errors: ["edit-session: expected an object body"] };
					}
					const errors: string[] = [];
					if (
						input.instruction !== undefined &&
						typeof input.instruction !== "string"
					) {
						errors.push("instruction: expected a string");
					}
					if (
						input.sessionId !== undefined &&
						typeof input.sessionId !== "string"
					) {
						errors.push("sessionId: expected a string");
					}
					if (input.spawn !== undefined && typeof input.spawn !== "boolean") {
						errors.push("spawn: expected a boolean");
					}
					if (
						input.extraRequests !== undefined &&
						!Array.isArray(input.extraRequests)
					) {
						errors.push("extraRequests: expected an array");
					}
					if (errors.length > 0) {
						set.status = 400;
						return { errors };
					}
					const result = await sessions.createSession(params.name, {
						instruction: input.instruction as string | undefined,
						sessionId: input.sessionId as string | undefined,
						spawn: input.spawn as boolean | undefined,
						// Request-shape problems surface as typed session/launch
						// failures; the wire check above stays structural.
						extraRequests: input.extraRequests as never,
					});
					if (!result.ok) {
						if (result.reason === "unknown-agent") {
							set.status = 404;
							return { error: `Agent ${params.name} not found in catalog` };
						}
						set.status = 422;
						return { errors: result.errors };
					}
					set.status = 201;
					return { state: result.state };
				} catch (error) {
					console.error("Error creating prompt-edit session:", error);
					set.status = 500;
					return { error: "Failed to create prompt-edit session" };
				}
			},
		)
		.get(`${prefix}/prompt-edit-sessions`, () => ({
			sessions: sessions.list(),
		}))
		.get(`${prefix}/prompt-edit-sessions/:id`, ({ params, set }) => {
			const state = sessions.getState(params.id);
			if (!state) return notFound(params.id, set);
			return { state };
		})
		.get(`${prefix}/prompt-edit-sessions/:id/events`, ({ params, set }) => {
			const state = sessions.getState(params.id);
			if (!state) return notFound(params.id, set);

			const encoder = new TextEncoder();
			let unsubscribe: (() => void) | null = null;
			let closed = false;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const close = () => {
						if (closed) return;
						closed = true;
						unsubscribe?.();
						unsubscribe = null;
						try {
							controller.close();
						} catch {
							// Already closed by the consumer.
						}
					};
					const send = (event: unknown) => {
						if (closed) return;
						try {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
							);
						} catch {
							close();
						}
					};
					send({
						type: "session-state",
						sessionId: params.id,
						state,
					});
					unsubscribe = sessions.subscribe(params.id, (event) => {
						send(event);
						if (event.type === "session-disposed") close();
					});
					if (!unsubscribe) close();
				},
				cancel() {
					closed = true;
					unsubscribe?.();
					unsubscribe = null;
				},
			});
			return new Response(stream, {
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
				},
			});
		})
		.post(
			`${prefix}/prompt-edit-sessions/:id/requests`,
			({ params, body, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					if (!isPlainObject(body)) {
						set.status = 400;
						return { errors: ["request: expected an object body"] };
					}
					if (typeof body.body !== "string" || body.body.trim() === "") {
						set.status = 400;
						return { errors: ["body: expected a non-empty string"] };
					}
					if (body.target === undefined) {
						set.status = 400;
						return { errors: ["target: required"] };
					}
					const result = sessions.addHumanRequest(params.id, {
						id: typeof body.id === "string" ? body.id : undefined,
						target: body.target as never,
						body: body.body,
						author: body.author as never,
					});
					if (result === null) return notFound(params.id, set);
					if (!result.ok) {
						set.status = 400;
						return { errors: [result.message] };
					}
					return result;
				} catch (error) {
					console.error("Error adding prompt-edit session request:", error);
					set.status = 500;
					return { error: "Failed to add prompt-edit session request" };
				}
			},
		)
		.post(
			`${prefix}/prompt-edit-sessions/:id/requests/:alias/accept`,
			async ({ params, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					return answerReview(
						await sessions.acceptProposal(params.id, params.alias),
						params.id,
						set,
					);
				} catch (error) {
					console.error("Error accepting prompt-edit proposal:", error);
					set.status = 500;
					return { error: "Failed to accept prompt-edit proposal" };
				}
			},
		)
		.post(
			`${prefix}/prompt-edit-sessions/:id/requests/:alias/reject`,
			async ({ params, body, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					const input = body === undefined || body === null ? {} : body;
					if (!isPlainObject(input)) {
						set.status = 400;
						return { errors: ["reject: expected an object body"] };
					}
					if (input.note !== undefined && typeof input.note !== "string") {
						set.status = 400;
						return { errors: ["note: expected a string"] };
					}
					return answerReview(
						await sessions.rejectProposal(params.id, params.alias, input.note),
						params.id,
						set,
					);
				} catch (error) {
					console.error("Error rejecting prompt-edit proposal:", error);
					set.status = 500;
					return { error: "Failed to reject prompt-edit proposal" };
				}
			},
		)
		.post(
			`${prefix}/prompt-edit-sessions/:id/requests/:alias/undo`,
			async ({ params, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					return answerReview(
						await sessions.undoAccepted(params.id, params.alias),
						params.id,
						set,
					);
				} catch (error) {
					console.error("Error undoing prompt-edit proposal:", error);
					set.status = 500;
					return { error: "Failed to undo prompt-edit proposal" };
				}
			},
		)
		.post(
			`${prefix}/prompt-edit-sessions/:id/requests/:alias/replies`,
			({ params, body, set }) => {
				if (!allowWrites) return readOnly(set);
				try {
					if (
						!isPlainObject(body) ||
						typeof body.body !== "string" ||
						body.body.trim() === ""
					) {
						set.status = 400;
						return { errors: ["body: expected a non-empty string"] };
					}
					const result = sessions.replyToRequest(
						params.id,
						params.alias,
						body.body,
					);
					if (result === null) return notFound(params.id, set);
					if (!result.ok) {
						set.status = 400;
						return { errors: [result.message] };
					}
					return result;
				} catch (error) {
					console.error("Error replying to prompt-edit request:", error);
					set.status = 500;
					return { error: "Failed to reply to prompt-edit request" };
				}
			},
		)
		.delete(`${prefix}/prompt-edit-sessions/:id`, ({ params, set }) => {
			if (!allowWrites) return readOnly(set);
			if (!sessions.dispose(params.id)) return notFound(params.id, set);
			return { ok: true };
		});
}
