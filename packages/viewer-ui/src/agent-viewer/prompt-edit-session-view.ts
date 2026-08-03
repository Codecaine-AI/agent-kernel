/**
 * prompt-edit-session-view — pure mapping between the kernel's prompt-edit
 * session wire contract (viewer-core DTOs) and the lab's `promptEditSession`
 * prop contract (prompt-kit ui/lab prompt-edit-session.ts). No fetching, no
 * React: the container/controller feeds DTO state (kept fresh via SSE) in and
 * gets lab props out.
 *
 * The three mapping decisions this module owns:
 *
 * - STATUS. The service serves request status (open | proposal-ready | done |
 *   declined) + a review overlay (pending | applied | rejected | undone) +
 *   waitingOnHuman; the lab wants ONE enum (open | working | waiting | ready |
 *   applied | declined | resolved). Review wins over agent status (applied /
 *   rejected are review outcomes; undone re-stages, hence "ready"), waiting
 *   wins over open/working, and a bare "open" reads "working" while a live
 *   agent run is attached.
 * - AUTHOR. Service vocabulary human | agent | system → lab "you" | "agent"
 *   (system speaks with the agent's voice in the UI).
 * - PROPOSAL WINDOW. The service keeps accepted proposals in the staged list
 *   (staging order, `nextAcceptAlias` marks the consumption point); the lab
 *   wants only the not-yet-accepted tail, front == the only acceptable one.
 *
 * The event reducer mirrors the service's documented invariants: accepts
 * consume in staging order, so applied proposals form a prefix of the staged
 * list — `nextAcceptAlias` / `undoableAlias` are recomputed from that prefix
 * after every structural event rather than tracked statefully.
 */
import type {
	PromptAnnotation,
	PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";
import type {
	PromptEditProposal as LabProposal,
	PromptEditRequest as LabRequest,
	PromptEditRequestStatus as LabRequestStatus,
	PromptEditSession as LabSession,
	PromptEditThreadMessage,
} from "@codecaine-ai/prompt-kit/ui/lab";
import type {
	PromptEditSessionAuthor,
	PromptEditSessionEventDto,
	PromptEditSessionProposalDto,
	PromptEditSessionRequestDto,
	PromptEditSessionStateDto,
	PromptEditSessionTarget,
} from "@agent-kernel/viewer-core";

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

/** Session target → lab annotation target. `doc` is the lab's `null`. */
export function toLabTarget(
	target: PromptEditSessionTarget,
	docId: string,
): PromptAnnotationTarget | null {
	switch (target.kind) {
		case "doc":
			return null;
		case "node":
			return { kind: "prompt-node", docId, nodeId: target.nodeId };
		case "range":
			return {
				kind: "prompt-range",
				docId,
				nodeId: target.nodeId,
				start: target.start,
				end: target.end,
				// The lab schema requires the drift-detection quote; the session
				// target keeps it optional. An empty quote reads "unknown".
				quote: target.quote ?? "",
			};
	}
}

/** Lab annotation target → session target. `null` and nodeId===docId are
 * both the whole-document request (the session's explicit `doc`). */
export function toSessionTarget(
	target: PromptAnnotationTarget | null,
): PromptEditSessionTarget {
	if (target === null) return { kind: "doc" };
	if (target.kind === "prompt-range") {
		return {
			kind: "range",
			nodeId: target.nodeId,
			start: target.start,
			end: target.end,
			...(target.quote !== undefined ? { quote: target.quote } : {}),
		};
	}
	if (target.nodeId === target.docId) return { kind: "doc" };
	return { kind: "node", nodeId: target.nodeId };
}

/** Lab target (or null) → sidecar annotation target for the POST body. The
 * sidecar schema has no `doc` kind: whole-document is nodeId === docId. */
export function toAnnotationTarget(
	target: PromptAnnotationTarget | null,
	docId: string,
): PromptAnnotationTarget {
	if (target !== null) return target;
	return { kind: "prompt-node", docId, nodeId: docId };
}

/* ------------------------------------------------------------------ */
/* Authors & status                                                    */
/* ------------------------------------------------------------------ */

/** Service author role → lab voice. `system` reads as the agent. */
export function toLabAuthor(
	author: PromptEditSessionAuthor,
): "you" | "agent" {
	return author === "human" ? "you" : "agent";
}

/** Free-form sidecar author name → lab voice (pre-session request cards).
 * Mirrors the kernel's from-annotations role adapter: the literal role
 * strings map through, every other name is the human. */
export function annotationAuthorToLabAuthor(author: string): "you" | "agent" {
	return author === "agent" || author === "system" ? "agent" : "you";
}

/**
 * THE status matrix (service → lab). Review overlay first, then disposal,
 * then the waiting flag, then staging state:
 *
 *   review applied                        → applied
 *   review rejected                       → declined
 *   review undone                         → ready     (re-staged, next up)
 *   status declined                       → declined
 *   status done, has proposalId           → ready     (staged, awaiting review)
 *   status done, no proposalId            → resolved  (closed without an edit)
 *   waitingOnHuman                        → waiting
 *   status proposal-ready                 → ready
 *   status open, live agent run           → working
 *   status open, no live run              → open
 */
export function toLabRequestStatus(
	request: Pick<
		PromptEditSessionRequestDto,
		"status" | "review" | "waitingOnHuman" | "proposalId"
	>,
	agentActive: boolean,
): LabRequestStatus {
	switch (request.review) {
		case "applied":
			return "applied";
		case "rejected":
			return "declined";
		case "undone":
			return "ready";
		case "pending":
			break;
	}
	if (request.status === "declined") return "declined";
	if (request.status === "done") {
		return request.proposalId !== undefined ? "ready" : "resolved";
	}
	if (request.waitingOnHuman) return "waiting";
	if (request.status === "proposal-ready") return "ready";
	return agentActive ? "working" : "open";
}

/** Whether a live agent run is working the session (drives open→working). */
export function isAgentActive(
	state: Pick<PromptEditSessionStateDto, "status" | "agent">,
): boolean {
	return (
		state.status === "running" &&
		state.agent.spawned &&
		state.agent.error === undefined
	);
}

/* ------------------------------------------------------------------ */
/* DTO state → lab props                                               */
/* ------------------------------------------------------------------ */

function toThread(
	request: PromptEditSessionRequestDto,
): PromptEditThreadMessage[] | undefined {
	if (request.replies.length === 0) return undefined;
	return request.replies.map((reply) => ({
		author: toLabAuthor(reply.author),
		body: reply.body,
	}));
}

export function toLabRequest(
	request: PromptEditSessionRequestDto,
	docId: string,
	agentActive: boolean,
): LabRequest {
	const thread = toThread(request);
	return {
		alias: request.alias,
		annotationId: request.annotationId,
		author: toLabAuthor(request.author),
		status: toLabRequestStatus(request, agentActive),
		body: request.body,
		target: toLabTarget(request.target, docId),
		...(thread !== undefined ? { thread } : {}),
	};
}

/**
 * The lab's proposal window: accepted proposals removed, the rest in staging
 * order — element 0 is the only acceptable one. `nextAcceptAlias` is the
 * service's authoritative cut point (null → everything staged is consumed).
 */
export function windowProposals(
	state: Pick<PromptEditSessionStateDto, "proposals" | "nextAcceptAlias">,
): PromptEditSessionProposalDto[] {
	if (state.nextAcceptAlias === null) return [];
	const index = state.proposals.findIndex(
		(proposal) => proposal.requestAlias === state.nextAcceptAlias,
	);
	if (index === -1) return [];
	return state.proposals.slice(index);
}

export function toLabProposal(
	proposal: PromptEditSessionProposalDto,
	requests: readonly PromptEditSessionRequestDto[],
): LabProposal {
	const request = requests.find(
		(candidate) => candidate.alias === proposal.requestAlias,
	);
	return {
		requestAlias: proposal.requestAlias,
		...(request !== undefined ? { annotationId: request.annotationId } : {}),
		transactionId: proposal.transactionId,
		changedIds: proposal.changedIds,
		summary: proposal.summary,
		renderedBefore: proposal.renderedBefore,
		renderedAfter: proposal.renderedAfter,
		steps: proposal.steps,
	};
}

/** Data half of the lab's `promptEditSession` prop (callbacks are the
 * controller's). */
export type LabSessionData = Pick<
	LabSession,
	"requests" | "proposals" | "undoableAlias"
>;

export function toLabSessionData(
	state: PromptEditSessionStateDto,
	docId: string,
): LabSessionData {
	const agentActive = isAgentActive(state);
	return {
		requests: state.requests.map((request) =>
			toLabRequest(request, docId, agentActive),
		),
		proposals: windowProposals(state).map((proposal) =>
			toLabProposal(proposal, state.requests),
		),
		...(state.undoableAlias !== null
			? { undoableAlias: state.undoableAlias }
			: {}),
	};
}

/* ------------------------------------------------------------------ */
/* Pre-session: sidecar annotations → lab request cards                */
/* ------------------------------------------------------------------ */

/**
 * Before a session exists the rail shows the sidecar's OPEN agent-request
 * annotations as request cards, aliased R1… in sidecar (creation) order —
 * the same aliases the session will assign when launched, so the cards keep
 * their identity across the create. Other intents/statuses are history or
 * ambient context and stay off the rail.
 */
export function annotationsToLabRequests(
	annotations: readonly PromptAnnotation[],
): LabRequest[] {
	const requests: LabRequest[] = [];
	for (const annotation of annotations) {
		if (annotation.status !== "open") continue;
		if (annotation.intent !== "agent-request") continue;
		const thread = (annotation.replies ?? []).map((reply) => ({
			author: annotationAuthorToLabAuthor(reply.author),
			body: reply.body,
		}));
		requests.push({
			alias: `R${requests.length + 1}`,
			annotationId: annotation.id,
			author: annotationAuthorToLabAuthor(annotation.author),
			status: "open",
			body: annotation.body,
			target: annotation.target,
			...(thread.length > 0 ? { thread } : {}),
		});
	}
	return requests;
}

/* ------------------------------------------------------------------ */
/* Event reducer                                                       */
/* ------------------------------------------------------------------ */

function recomputePointers(
	state: PromptEditSessionStateDto,
): PromptEditSessionStateDto {
	// Accepts consume in staging order → applied proposals are a prefix.
	let undoableAlias: string | null = null;
	let nextAcceptAlias: string | null = null;
	for (const proposal of state.proposals) {
		if (proposal.review === "applied") {
			undoableAlias = proposal.requestAlias;
			continue;
		}
		nextAcceptAlias = proposal.requestAlias;
		break;
	}
	return { ...state, nextAcceptAlias, undoableAlias };
}

function replaceRequest(
	state: PromptEditSessionStateDto,
	request: PromptEditSessionRequestDto,
): PromptEditSessionStateDto {
	const index = state.requests.findIndex(
		(candidate) => candidate.alias === request.alias,
	);
	const requests =
		index === -1
			? [...state.requests, request]
			: state.requests.map((candidate, i) =>
					i === index ? request : candidate,
				);
	return { ...state, requests };
}

function patchRequest(
	state: PromptEditSessionStateDto,
	alias: string,
	patch: Partial<PromptEditSessionRequestDto>,
): PromptEditSessionStateDto {
	return {
		...state,
		requests: state.requests.map((request) =>
			request.alias === alias ? { ...request, ...patch } : request,
		),
	};
}

function patchProposal(
	state: PromptEditSessionStateDto,
	alias: string,
	patch: Partial<PromptEditSessionProposalDto>,
): PromptEditSessionStateDto {
	return {
		...state,
		proposals: state.proposals.map((proposal) =>
			proposal.requestAlias === alias ? { ...proposal, ...patch } : proposal,
		),
	};
}

/**
 * Applies one SSE event to a session-state mirror. Pure and idempotent —
 * review mutations are reduced locally from the HTTP response AND arrive as
 * stream events; applying both leaves the same state. `session-disposed`
 * returns the state unchanged (session teardown is the caller's).
 */
export function applySessionEvent(
	state: PromptEditSessionStateDto,
	event: PromptEditSessionEventDto,
): PromptEditSessionStateDto {
	switch (event.type) {
		case "session-state":
			return event.state;
		case "request-updated":
		case "thread-updated":
			return replaceRequest(state, event.request);
		case "proposal-staged": {
			const index = state.proposals.findIndex(
				(proposal) => proposal.requestAlias === event.proposal.requestAlias,
			);
			// Re-proposing replaces (only the latest may be re-staged); a new
			// alias appends in staging order.
			const proposals =
				index === -1
					? [...state.proposals, event.proposal]
					: state.proposals.map((proposal, i) =>
							i === index ? event.proposal : proposal,
						);
			return recomputePointers({ ...state, proposals });
		}
		case "session-status":
			return { ...state, status: event.status };
		case "proposal-applied": {
			let next = patchRequest(state, event.alias, { review: "applied" });
			next = patchProposal(next, event.alias, { review: "applied" });
			return recomputePointers({ ...next, currentHash: event.hash });
		}
		case "proposal-rejected": {
			let next = patchRequest(state, event.alias, {
				review: "rejected",
				status: "declined",
				...(event.note !== undefined ? { note: event.note } : {}),
			});
			next = {
				...next,
				proposals: next.proposals.filter(
					(proposal) => proposal.requestAlias !== event.alias,
				),
			};
			return recomputePointers(next);
		}
		case "proposal-undone": {
			let next = patchRequest(state, event.alias, { review: "undone" });
			next = patchProposal(next, event.alias, { review: "undone" });
			return recomputePointers({ ...next, currentHash: event.hash });
		}
		case "session-disposed":
			return state;
	}
}
