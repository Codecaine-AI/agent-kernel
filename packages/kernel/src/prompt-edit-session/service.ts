/**
 * prompt-edit-session/service — the host-side session lifecycle service
 * (Phase 2 apply path, plan items 6 + 9 server half).
 *
 * An in-memory manager keyed by session id. `createSession` runs
 * `launchPromptEditSession` (annotations → request queue → session) and hands
 * the launch to ONE injectable `spawnAgent` function — the host wires it to
 * the kernel's run machinery (`kernel.spawnAgent(launch.spawn.agentName, …)`
 * plus the `sharedTools` binding documented in launch.ts). Without a spawn
 * function the session is fully operable headless: tests and host code drive
 * the underlying `PromptEditSession` directly via `getSession`.
 *
 * The apply path (chosen semantics, documented decisions):
 *
 * - ACCEPTS CONSUME IN STAGING ORDER. Proposals chain on the session's
 *   working document, so proposal k+1's steps only make sense on a saved doc
 *   equal to base + proposals 1..k. `acceptProposal` enforces the order with
 *   a typed `out_of_order` failure naming the next acceptable alias.
 * - EVERY ACCEPT IS ITS OWN REVISION (write-through): applySteps on the
 *   service's view of the current saved document → savePrompt with
 *   expectedHash (the 409/stale-base idiom guards concurrent lab saves;
 *   nothing is half-applied on conflict) → prompt_revisions source
 *   "agent-run" → registry hot-swap. Accept-all is therefore n revisions,
 *   not a squash — revisit at the "Accept-all" interactive gate.
 * - UNDO IS ITSELF A WRITE-THROUGH SAVE, NOT HISTORY SURGERY: revertSteps of
 *   the applied transaction against the current saved doc, saved as a normal
 *   revision. History stays linear/append-only. Because revisions are
 *   content-addressed and immutable (upsertPromptRevision is idempotent on
 *   hash), an undo that restores prior content re-points disk + registry at
 *   the prior hash; the revision row for that hash already exists and keeps
 *   its original source/createdAt. Only the MOST RECENTLY applied proposal is
 *   undoable (chain symmetry with staging order); an undone proposal becomes
 *   the next acceptable one again.
 * - SIDECAR ON ACCEPT: attach the agentRun ({sessionId, patchId =
 *   transactionId, summary, changedIds}) AND resolve the annotation. The
 *   shared annotation schema only knows open|resolved today — the proper
 *   `applied` status is Phase 3. TODO(plan item 10): once the shared engine
 *   schema gains author + `applied`, write `applied` here instead of
 *   resolving outright. Requests whose id is not in the sidecar
 *   (extraRequests, agent add_note entries) skip both ops cleanly.
 * - STALE-BASE INTERACTION: savePrompt's hot-swap moves the registry hash,
 *   so after the first accept the session's own stale-base guard blocks any
 *   FURTHER agent proposals (detection-only; rebase is an open gate). Accept
 *   after the agent finished staging, or expect later proposals to bounce.
 *
 * Review state ("pending" | "applied" | "rejected" | "undone") is a service-
 * level overlay per request alias — the session's own request status stays
 * whatever the agent left it at (accepting does not forge an agent
 * resolution; rejecting DOES close the entry via session.discardProposal,
 * because the discard must revert the working document).
 *
 * ---------------------------------------------------------------------------
 * Three additions for the lab's filing gestures (run now / add to batch /
 * apply), each a documented decision:
 *
 * - REQUEST SCOPE. `createSession` takes `requestIds`: the explicit set of
 *   annotation ids the session works. "Run now" is a session scoped to one id,
 *   "Apply" is one scoped to the queued set, and omitting it keeps the original
 *   whole-sidecar behavior. Scoping happens at the launch layer, so it governs
 *   BOTH what the session tracks and what the agent sees — the prompt-editor
 *   bundle renders `sessionData.requestQueue` verbatim into its `<requests>`
 *   block, so a scoped queue is a scoped context with no bundle change.
 *
 * - RE-RUN ON REPLY. A human reply into a request thread starts ANOTHER agent
 *   turn on the SAME session (`relaunchPromptEditSession` + the injected
 *   spawnAgent), which is how "iterate on the staged diff by replying" works:
 *   re-proposing on an alias replaces its staged proposal, so the old diff is
 *   swapped for the revised one in place. Turns never overlap — a reply while a
 *   turn is running is coalesced into ONE follow-up turn kicked off when the
 *   current one settles (the running agent may well pick the reply up itself
 *   via read_prompt; the follow-up turn guarantees it either way). Sessions
 *   without a spawn function (headless/tests) just record the reply.
 *
 * - ONE LIVE SESSION PER TARGET AGENT. Creating a session for an agent that
 *   already has one is refused with `{ reason: "agent-busy", sessionId }`
 *   rather than queued. Reason: sessions are base-hash pinned. Two live
 *   sessions would both stage against the same base, and the first accept moves
 *   the registry hash — so the second session's proposals would bounce on the
 *   stale-base guard AFTER its agent had already done the work. Refusing up
 *   front is strictly cheaper than discovering the conflict at accept time, and
 *   it gives the UI a signal it can show ("finish or end that session first").
 *   Serial launch queuing and rebasing are deliberately NOT built — the escape
 *   hatch is `dispose(sessionId)`. Sessions on DIFFERENT agents are
 *   independent (separate documents, separate hashes) and never conflict.
 */
import { PROMPT_REVISION_SOURCE } from "@agent-kernel/db";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	applySteps,
	revertSteps,
	type PromptStep,
} from "@codecaine-ai/prompt-kit/ui";

import type { AgentRegistry } from "../agent-registry";
import type { KernelCatalogService } from "../catalog-service";
import type { SkippedAnnotation } from "./from-annotations";
import {
	launchPromptEditSession,
	promptEditRerunKickoff,
	relaunchPromptEditSession,
	type LaunchedPromptEditSession,
	type LaunchPromptEditSessionFailure,
} from "./launch";
import type { PromptEditSession } from "./session";
import type {
	PromptEditProposal,
	PromptEditRequestEntry,
	PromptEditRequestInput,
	PromptEditSessionEvent,
	PromptEditSessionStatus,
	PromptEditTarget,
	PromptEditThreadReply,
} from "./types";

// ---------------------------------------------------------------------------
// State shapes (the Phase 2 contract the lab UI consumes — mirrored
// structurally in @agent-kernel/viewer-core catalog-types.ts, no viewer dep)
// ---------------------------------------------------------------------------

/** Human-review disposition of one request, overlaid on the session entry. */
export type PromptEditReviewStatus =
	| "pending"
	| "applied"
	| "rejected"
	| "undone";

/** One request entry as served to the review UI: session entry + review overlay. */
export interface PromptEditSessionRequestState {
	alias: string;
	annotationId: string;
	target: PromptEditTarget;
	body: string;
	author: PromptEditRequestEntry["author"];
	replies: PromptEditThreadReply[];
	status: PromptEditRequestEntry["status"];
	waitingOnHuman: boolean;
	note?: string;
	proposalId?: string;
	review: PromptEditReviewStatus;
}

/** One staged proposal as served to the review UI (diff-ready renders). */
export interface PromptEditSessionProposalState {
	transactionId: string;
	requestAlias: string;
	baseHash: string;
	steps: PromptStep[];
	changedIds: string[];
	summary: string;
	renderedBefore: string;
	renderedAfter: string;
	createdAt: string;
	review: PromptEditReviewStatus;
}

/** Whether a live agent run is attached to the session. */
export interface PromptEditSessionAgentState {
	/** True when a spawn function was invoked for this session. */
	spawned: boolean;
	/** Set when the spawn function threw/rejected; the session stays usable. */
	error?: string;
	/** An agent turn is in flight right now (the lab's "working…" state). */
	running: boolean;
	/** Turns started so far: 1 is the session's own spawn, 2+ are reply re-runs. */
	turns: number;
	/** A reply arrived mid-turn and a follow-up turn is already scheduled. */
	rerunPending: boolean;
}

/** Full session state snapshot (GET session / SSE hello event). */
export interface PromptEditSessionState {
	sessionId: string;
	targetAgent: string;
	/** Hash the session's proposals were staged against. */
	baseHash: string;
	/** The service's view of the currently saved revision (moves with accept/undo). */
	currentHash: string;
	status: PromptEditSessionStatus;
	instruction?: string;
	createdAt: string;
	/** Annotation ids this session was scoped to, or null when it works every
	 * open agent-request on the sidecar. */
	scope: string[] | null;
	requests: PromptEditSessionRequestState[];
	proposals: PromptEditSessionProposalState[];
	/** Staging-order pointer: the only alias acceptProposal will take next. */
	nextAcceptAlias: string | null;
	/** The only alias undoAccepted will take (most recently applied), if any. */
	undoableAlias: string | null;
	skipped: SkippedAnnotation[];
	agent: PromptEditSessionAgentState;
}

/** One row of the session listing. */
export interface PromptEditSessionSummary {
	sessionId: string;
	targetAgent: string;
	status: PromptEditSessionStatus;
	createdAt: string;
	baseHash: string;
	currentHash: string;
	requestCount: number;
	proposalCount: number;
	appliedCount: number;
	scope: string[] | null;
}

/** Everything the SSE stream carries: session events, service review events,
 * the hello snapshot, and the terminal dispose marker. */
export type PromptEditSessionStreamEvent =
	| PromptEditSessionEvent
	| { type: "session-state"; sessionId: string; state: PromptEditSessionState }
	| { type: "session-disposed"; sessionId: string };

export type PromptEditSessionStreamListener = (
	event: PromptEditSessionStreamEvent,
) => void;

// ---------------------------------------------------------------------------
// Typed results
// ---------------------------------------------------------------------------

/** Sidecar outcome piggybacked on accept/reject: the prompt write already
 * landed, so sidecar trouble is reported, never rolled back into a failure. */
export interface PromptEditAnnotationOutcome {
	annotationId: string;
	/** agentRun attached (accept only; reject never attaches). */
	attached: boolean;
	/** Annotation resolved in the sidecar. */
	resolved: boolean;
	/** "not-in-sidecar" for extraRequests/agent notes, or an error detail. */
	detail?: string;
}

export type AcceptPromptEditProposalFailure =
	| { kind: "writes_disabled" }
	| { kind: "unknown_request"; alias: string }
	| { kind: "no_staged_proposal"; alias: string }
	| { kind: "already_applied"; alias: string }
	| {
			/** Accepts must consume proposals in staging order. */
			kind: "out_of_order";
			alias: string;
			nextAlias: string;
	  }
	| {
			/** savePrompt saw a different live hash — the saved prompt moved
			 * (lab save / out-of-band edit) since this session's last write.
			 * Nothing was applied. */
			kind: "stale_base";
			expectedHash: string;
			currentHash: string;
	  }
	| { kind: "save_failed"; errors: string[] };

export type AcceptPromptEditProposalResult =
	| {
			ok: true;
			alias: string;
			transactionId: string;
			/** Canonical hash of the new revision. */
			hash: string;
			annotation: PromptEditAnnotationOutcome;
	  }
	| { ok: false; failure: AcceptPromptEditProposalFailure };

export type RejectPromptEditProposalFailure =
	| { kind: "writes_disabled" }
	| { kind: "unknown_request"; alias: string }
	| { kind: "no_staged_proposal"; alias: string }
	| { kind: "already_applied"; alias: string }
	| {
			/** Rejecting a non-latest staged proposal would require rebasing the
			 * proposals staged after it — refused under sequential staging.
			 * Reject latest-first, or accept through and undo. */
			kind: "proposal_not_latest";
			alias: string;
			latestAlias: string;
	  }
	| { kind: "discard_failed"; message: string };

export type RejectPromptEditProposalResult =
	| {
			ok: true;
			alias: string;
			transactionId: string;
			request: PromptEditRequestEntry;
			annotation: PromptEditAnnotationOutcome;
	  }
	| { ok: false; failure: RejectPromptEditProposalFailure };

export type UndoAcceptedProposalFailure =
	| { kind: "writes_disabled" }
	| { kind: "unknown_request"; alias: string }
	| { kind: "not_applied"; alias: string }
	| {
			/** Only the most recently applied proposal is undoable (chain
			 * symmetry with staging-order accepts). */
			kind: "not_latest_applied";
			alias: string;
			lastAppliedAlias: string;
	  }
	| { kind: "stale_base"; expectedHash: string; currentHash: string }
	| { kind: "save_failed"; errors: string[] };

export type UndoAcceptedProposalResult =
	| { ok: true; alias: string; transactionId: string; hash: string }
	| { ok: false; failure: UndoAcceptedProposalFailure };

/**
 * Everything that can stop a session from being created: the launch failures
 * plus the service-level concurrency refusal (see the header — one live
 * session per target agent, no queuing).
 */
export type CreatePromptEditSessionFailure =
	| LaunchPromptEditSessionFailure
	| {
			ok: false;
			reason: "agent-busy";
			targetAgent: string;
			/** The session already holding this agent — end it or wait for it. */
			sessionId: string;
	  };

export type CreatePromptEditSessionResult =
	| { ok: true; state: PromptEditSessionState }
	| CreatePromptEditSessionFailure;

export type PromptEditSimpleResult =
	| { ok: true; request: PromptEditRequestEntry }
	| { ok: false; message: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CreatePromptEditSessionInput {
	instruction?: string;
	/**
	 * Scope the session to these annotation ids — one id for "run now", the
	 * queued set for "apply". Omitted: every open agent-request on the sidecar
	 * (unchanged pre-scope behavior). An id that is not an actionable request
	 * fails the create with `reason: "empty-scope"` when NOTHING in the scope
	 * lands, and is reported in `skipped` otherwise.
	 */
	requestIds?: readonly string[];
	extraRequests?: PromptEditRequestInput[];
	sessionId?: string;
	/** Skip the spawn function for this session (headless) — for its whole
	 * life, replies included. Default: spawn when a spawn function is
	 * configured. */
	spawn?: boolean;
}

export interface PromptEditSessionService {
	/** Disk-write gate mirrored from the catalog service convention. */
	readonly allowWrites: boolean;
	createSession(
		targetAgent: string,
		input?: CreatePromptEditSessionInput,
	): Promise<CreatePromptEditSessionResult>;
	/** null when the session id is unknown/disposed (routes answer 404). */
	getState(sessionId: string): PromptEditSessionState | null;
	list(): PromptEditSessionSummary[];
	/** The underlying session (tools binding, tests, host-side driving). */
	getSession(sessionId: string): PromptEditSession | null;
	/** Launch payload for hosts that spawn out-of-band. */
	getLaunch(sessionId: string): LaunchedPromptEditSession | null;
	/** Forwarded session events + service review events. null: unknown session. */
	subscribe(
		sessionId: string,
		listener: PromptEditSessionStreamListener,
	): (() => void) | null;
	acceptProposal(
		sessionId: string,
		requestAlias: string,
	): Promise<AcceptPromptEditProposalResult | null>;
	rejectProposal(
		sessionId: string,
		requestAlias: string,
		note?: string,
	): Promise<RejectPromptEditProposalResult | null>;
	undoAccepted(
		sessionId: string,
		requestAlias: string,
	): Promise<UndoAcceptedProposalResult | null>;
	/** Human answer into a request thread (appendHumanReply passthrough). */
	replyToRequest(
		sessionId: string,
		requestAlias: string,
		body: string,
	): PromptEditSimpleResult | null;
	/** Host-side mid-session request add. Generates an id when none given —
	 * such requests have no sidecar annotation and skip sidecar ops on
	 * accept/reject. */
	addHumanRequest(
		sessionId: string,
		input: {
			id?: string;
			target: PromptEditTarget;
			body: string;
			author?: PromptEditRequestEntry["author"];
		},
	): PromptEditSimpleResult | null;
	/** Emits session-disposed to stream listeners, then forgets the session.
	 * Returns false for an unknown id. */
	dispose(sessionId: string): boolean;
	/** Dispose every session (host shutdown). */
	disposeAll(): void;
}

export interface CreatePromptEditSessionServiceOptions {
	/** The kernel's agent registry (built lazily, hence the accessor). */
	registry: () => Promise<AgentRegistry>;
	/** The catalog service: annotation listing for launch, savePrompt for the
	 * apply path, sidecar agent-run/resolve ops. */
	catalog: Pick<
		KernelCatalogService,
		| "listAnnotations"
		| "savePrompt"
		| "attachAnnotationAgentRun"
		| "resolveAnnotation"
	>;
	/**
	 * Spawns the prompt-editor agent for a launched session — THE one
	 * injectable seam between the manager and the kernel's run machinery.
	 * The host's real implementation is the launch.ts header's spawn line
	 * (`kernel.spawnAgent(launch.spawn.agentName, launch.spawn.prompt, null,
	 * {sessionData})` with `launch.tools` bound via `sharedTools`).
	 * Errors are captured onto the session's agent state, never thrown to the
	 * caller. Omitted: sessions run headless.
	 */
	spawnAgent?: (launch: LaunchedPromptEditSession) => void | Promise<void>;
	/** Enable the accept/undo disk writes. Default false (read-only). */
	allowWrites?: boolean;
	now?: () => string;
}

interface AppliedProposalRecord {
	alias: string;
	transactionId: string;
	steps: PromptStep[];
	summary: string;
	changedIds: string[];
	annotationId: string;
}

interface ManagedSession {
	session: PromptEditSession;
	launch: LaunchedPromptEditSession;
	targetAgent: string;
	createdAt: string;
	/** The service's view of the saved prompt: base + accepted proposals. */
	currentDocument: PromptDocument;
	currentHash: string;
	/** Proposals consumed from session.proposals() in staging order. */
	acceptedCount: number;
	applied: AppliedProposalRecord[];
	review: Map<string, PromptEditReviewStatus>;
	listeners: Set<PromptEditSessionStreamListener>;
	unsubscribeSession: () => void;
	agent: PromptEditSessionAgentState;
	/** False when the session was created with `spawn: false` — it stays
	 * headless for its whole life, replies included. */
	spawnEnabled: boolean;
	/** Aliases replied to while a turn was running, coalesced into the next
	 * follow-up turn (insertion-ordered, deduplicated). */
	pendingRerunAliases: Set<string>;
	/** True once dispose() ran — stops a settling turn from scheduling more. */
	disposed: boolean;
}

export function createPromptEditSessionService(
	opts: CreatePromptEditSessionServiceOptions,
): PromptEditSessionService {
	const allowWrites = opts.allowWrites ?? false;
	const now = opts.now ?? (() => new Date().toISOString());
	const sessions = new Map<string, ManagedSession>();

	function emit(m: ManagedSession, event: PromptEditSessionStreamEvent): void {
		for (const listener of [...m.listeners]) listener(event);
	}

	function requestState(
		m: ManagedSession,
		entry: PromptEditRequestEntry,
	): PromptEditSessionRequestState {
		return {
			alias: entry.alias,
			annotationId: entry.annotationId,
			target: entry.target,
			body: entry.body,
			author: entry.author,
			replies: [...entry.replies],
			status: entry.status,
			waitingOnHuman: entry.waitingOnHuman,
			...(entry.note !== undefined ? { note: entry.note } : {}),
			...(entry.proposalId !== undefined
				? { proposalId: entry.proposalId }
				: {}),
			review: m.review.get(entry.alias) ?? "pending",
		};
	}

	function proposalState(
		m: ManagedSession,
		proposal: PromptEditProposal,
	): PromptEditSessionProposalState {
		const review = m.review.get(proposal.requestAlias) ?? "pending";
		return {
			transactionId: proposal.transactionId,
			requestAlias: proposal.requestAlias,
			baseHash: proposal.baseHash,
			steps: proposal.steps,
			changedIds: proposal.changedIds,
			summary: proposal.summary,
			renderedBefore: proposal.renderedBefore,
			renderedAfter: proposal.renderedAfter,
			createdAt: proposal.createdAt,
			review,
		};
	}

	/**
	 * Runs ONE agent turn on a session and settles the turn bookkeeping. Turn 1
	 * is the session's own launch; later turns are reply re-runs built with
	 * `relaunchPromptEditSession` off live session state.
	 *
	 * Turns never overlap: a request to run while one is in flight only records
	 * the aliases, and the settling turn drains them into exactly one follow-up.
	 * Detached by design — spawn failures land on the session's agent state,
	 * never on the caller (the human's reply/create already succeeded).
	 */
	function runAgentTurn(
		m: ManagedSession,
		launch: LaunchedPromptEditSession,
		aliases: string[],
	): void {
		if (!opts.spawnAgent || !m.spawnEnabled || m.disposed) return;
		if (m.agent.running) {
			for (const alias of aliases) m.pendingRerunAliases.add(alias);
			m.agent.rerunPending = m.pendingRerunAliases.size > 0;
			return;
		}
		m.agent.spawned = true;
		m.agent.running = true;
		m.agent.turns += 1;
		const turn = m.agent.turns;
		emit(m, {
			type: "agent-turn",
			sessionId: m.session.id,
			phase: "started",
			turn,
			aliases: [...aliases],
		});
		Promise.resolve()
			.then(() => opts.spawnAgent?.(launch))
			.then(
				() => undefined,
				(error: unknown) => {
					m.agent.error =
						error instanceof Error ? error.message : String(error);
					return m.agent.error;
				},
			)
			.then((error) => {
				m.agent.running = false;
				emit(m, {
					type: "agent-turn",
					sessionId: m.session.id,
					phase: error === undefined ? "finished" : "failed",
					turn,
					aliases: [...aliases],
					...(error !== undefined ? { error } : {}),
				});
				const pending = [...m.pendingRerunAliases];
				m.pendingRerunAliases.clear();
				m.agent.rerunPending = false;
				if (pending.length === 0 || m.disposed) return;
				runAgentTurn(
					m,
					relaunchPromptEditSession(m.launch, promptEditRerunKickoff(pending)),
					pending,
				);
			});
	}

	function snapshot(m: ManagedSession): PromptEditSessionState {
		const proposals = m.session.proposals();
		return {
			sessionId: m.session.id,
			targetAgent: m.targetAgent,
			baseHash: m.session.baseHash,
			currentHash: m.currentHash,
			status: m.session.status(),
			...(m.session.instruction !== undefined
				? { instruction: m.session.instruction }
				: {}),
			createdAt: m.createdAt,
			scope: m.launch.scope === null ? null : [...m.launch.scope],
			requests: m.session.requests().map((entry) => requestState(m, entry)),
			proposals: proposals.map((proposal) => proposalState(m, proposal)),
			nextAcceptAlias: proposals[m.acceptedCount]?.requestAlias ?? null,
			undoableAlias: m.applied[m.applied.length - 1]?.alias ?? null,
			skipped: m.launch.skipped,
			agent: { ...m.agent },
		};
	}

	/** Attach the agentRun + resolve the annotation after an accept, or just
	 * resolve after a reject. Tolerates ids that are not in the sidecar
	 * (extraRequests, agent add_note entries) and reports — never throws. */
	async function settleSidecar(
		m: ManagedSession,
		entry: PromptEditRequestEntry,
		options: {
			attach?: { transactionId: string; summary: string; changedIds: string[] };
			resolution: string;
		},
	): Promise<PromptEditAnnotationOutcome> {
		const outcome: PromptEditAnnotationOutcome = {
			annotationId: entry.annotationId,
			attached: false,
			resolved: false,
		};
		try {
			if (options.attach) {
				const attached = await opts.catalog.attachAnnotationAgentRun(
					m.targetAgent,
					entry.annotationId,
					{
						sessionId: m.session.id,
						patchId: options.attach.transactionId,
						summary: options.attach.summary,
						changedIds: options.attach.changedIds,
					},
				);
				if (attached === null) {
					outcome.detail = "agent no longer in catalog";
					return outcome;
				}
				if (!attached.ok) {
					if ("annotationNotFound" in attached) {
						outcome.detail = "not-in-sidecar";
						return outcome;
					}
					outcome.detail =
						"errors" in attached
							? attached.errors.join("; ")
							: `sidecar conflict (hash ${attached.currentHash ?? "unknown"})`;
					return outcome;
				}
				outcome.attached = true;
			}
			// KNOWN CONSTRAINT: the shared annotation schema statuses are only
			// open|resolved, so an accepted edit resolves the annotation outright.
			// TODO(plan item 10 / Phase 3): write status "applied" once the shared
			// engine schema gains it, instead of resolving here.
			const resolved = await opts.catalog.resolveAnnotation(
				m.targetAgent,
				entry.annotationId,
				{ resolution: options.resolution },
			);
			if (resolved === null) {
				outcome.detail = "agent no longer in catalog";
				return outcome;
			}
			if (!resolved.ok) {
				if ("annotationNotFound" in resolved) {
					outcome.detail = outcome.detail ?? "not-in-sidecar";
					return outcome;
				}
				outcome.detail =
					"errors" in resolved
						? resolved.errors.join("; ")
						: `sidecar conflict (hash ${resolved.currentHash ?? "unknown"})`;
				return outcome;
			}
			outcome.resolved = true;
			return outcome;
		} catch (error) {
			outcome.detail = error instanceof Error ? error.message : String(error);
			return outcome;
		}
	}

	return {
		allowWrites,

		async createSession(targetAgent, input = {}) {
			// CONCURRENCY POLICY (header): one live session per target agent.
			// Sessions are base-hash pinned, so a second one would stage against
			// a base the first invalidates on its first accept — refusing here is
			// cheaper than bouncing the agent's work later. dispose() is the
			// escape hatch; other agents are unaffected.
			const busy = [...sessions.values()].find(
				(candidate) => candidate.targetAgent === targetAgent,
			);
			if (busy) {
				return {
					ok: false,
					reason: "agent-busy",
					targetAgent,
					sessionId: busy.session.id,
				};
			}

			const registry = await opts.registry();
			const launch = await launchPromptEditSession({
				registry,
				annotationOps: opts.catalog,
				targetAgent,
				...(input.instruction !== undefined
					? { instruction: input.instruction }
					: {}),
				...(input.requestIds !== undefined
					? { requestIds: input.requestIds }
					: {}),
				...(input.extraRequests !== undefined
					? { extraRequests: input.extraRequests }
					: {}),
				...(input.sessionId !== undefined
					? { sessionId: input.sessionId }
					: {}),
			});
			if (!launch.ok) return launch;

			const m: ManagedSession = {
				session: launch.session,
				launch,
				targetAgent,
				createdAt: now(),
				// Nothing is staged at creation, so workingDocument() IS the base.
				currentDocument: launch.session.workingDocument(),
				currentHash: launch.session.baseHash,
				acceptedCount: 0,
				applied: [],
				review: new Map(),
				listeners: new Set(),
				unsubscribeSession: () => {},
				agent: {
					spawned: false,
					running: false,
					turns: 0,
					rerunPending: false,
				},
				spawnEnabled: input.spawn !== false,
				pendingRerunAliases: new Set(),
				disposed: false,
			};
			// Forward session events enriched with the review overlay, so the
			// wire always carries DTO-shaped requests/proposals.
			m.unsubscribeSession = launch.session.subscribe((event) => {
				switch (event.type) {
					case "request-updated":
					case "thread-updated":
						emit(m, { ...event, request: requestState(m, event.request) });
						return;
					case "proposal-staged":
						emit(m, {
							...event,
							proposal: {
								...event.proposal,
								review:
									m.review.get(event.proposal.requestAlias) ?? "pending",
							} as PromptEditProposal,
						});
						return;
					default:
						emit(m, event);
				}
			});
			sessions.set(launch.session.id, m);

			// Turn 1 works the whole (scoped) queue, hence no aliases. Detached:
			// the agent run outlives this call; failures land on the session's
			// agent state instead of failing creation. A no-op when the session
			// is headless (no spawn function, or `spawn: false`).
			runAgentTurn(m, launch, []);

			return { ok: true, state: snapshot(m) };
		},

		getState(sessionId) {
			const m = sessions.get(sessionId);
			return m ? snapshot(m) : null;
		},

		list() {
			return [...sessions.values()].map((m) => ({
				sessionId: m.session.id,
				targetAgent: m.targetAgent,
				status: m.session.status(),
				createdAt: m.createdAt,
				baseHash: m.session.baseHash,
				currentHash: m.currentHash,
				requestCount: m.session.requests().length,
				proposalCount: m.session.proposals().length,
				appliedCount: m.applied.length,
				scope: m.launch.scope === null ? null : [...m.launch.scope],
			}));
		},

		getSession(sessionId) {
			return sessions.get(sessionId)?.session ?? null;
		},

		getLaunch(sessionId) {
			return sessions.get(sessionId)?.launch ?? null;
		},

		subscribe(sessionId, listener) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			m.listeners.add(listener);
			return () => m.listeners.delete(listener);
		},

		async acceptProposal(sessionId, requestAlias) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			const alias = requestAlias.trim();
			if (!allowWrites) {
				return { ok: false, failure: { kind: "writes_disabled" } };
			}
			const entry = m.session
				.requests()
				.find((candidate) => candidate.alias === alias);
			if (!entry) {
				return { ok: false, failure: { kind: "unknown_request", alias } };
			}
			if (m.review.get(alias) === "applied") {
				return { ok: false, failure: { kind: "already_applied", alias } };
			}
			const proposals = m.session.proposals();
			const index = proposals.findIndex(
				(proposal) => proposal.requestAlias === alias,
			);
			if (index === -1) {
				return { ok: false, failure: { kind: "no_staged_proposal", alias } };
			}
			if (index !== m.acceptedCount) {
				// index < acceptedCount cannot happen without review === "applied"
				// (accepted proposals stay in the staged list), so this is the
				// out-of-order case: something earlier is still unconsumed.
				const nextAlias = proposals[m.acceptedCount]?.requestAlias ?? alias;
				return {
					ok: false,
					failure: { kind: "out_of_order", alias, nextAlias },
				};
			}
			const proposal = proposals[index]!;

			// Apply on the CURRENT saved document (base + accepted so far), save
			// with optimistic concurrency. savePrompt canonicalizes, writes disk,
			// upserts the revision (source "agent-run") and hot-swaps the registry.
			const nextDocument = applySteps(m.currentDocument, proposal.steps);
			const saved = await opts.catalog.savePrompt(
				m.targetAgent,
				nextDocument,
				m.currentHash,
				PROMPT_REVISION_SOURCE.AGENT_RUN,
			);
			if (saved === null) {
				return {
					ok: false,
					failure: {
						kind: "save_failed",
						errors: [`agent ${m.targetAgent} no longer in catalog`],
					},
				};
			}
			if (!saved.ok) {
				if ("currentHash" in saved) {
					return {
						ok: false,
						failure: {
							kind: "stale_base",
							expectedHash: m.currentHash,
							currentHash: saved.currentHash,
						},
					};
				}
				return {
					ok: false,
					failure: { kind: "save_failed", errors: saved.errors },
				};
			}

			m.currentDocument = nextDocument;
			m.currentHash = saved.hash;
			m.acceptedCount += 1;
			m.applied.push({
				alias,
				transactionId: proposal.transactionId,
				steps: proposal.steps,
				summary: proposal.summary,
				changedIds: proposal.changedIds,
				annotationId: entry.annotationId,
			});
			m.review.set(alias, "applied");

			const annotation = await settleSidecar(m, entry, {
				attach: {
					transactionId: proposal.transactionId,
					summary: proposal.summary,
					changedIds: proposal.changedIds,
				},
				resolution: proposal.summary,
			});

			emit(m, {
				type: "proposal-applied",
				sessionId: m.session.id,
				alias,
				transactionId: proposal.transactionId,
				hash: saved.hash,
			});

			return {
				ok: true,
				alias,
				transactionId: proposal.transactionId,
				hash: saved.hash,
				annotation,
			};
		},

		async rejectProposal(sessionId, requestAlias, note) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			const alias = requestAlias.trim();
			if (!allowWrites) {
				return { ok: false, failure: { kind: "writes_disabled" } };
			}
			const entry = m.session
				.requests()
				.find((candidate) => candidate.alias === alias);
			if (!entry) {
				return { ok: false, failure: { kind: "unknown_request", alias } };
			}
			if (m.review.get(alias) === "applied") {
				// Applied proposals are past review — the undo path owns them.
				return { ok: false, failure: { kind: "already_applied", alias } };
			}
			const proposals = m.session.proposals();
			const index = proposals.findIndex(
				(proposal) => proposal.requestAlias === alias,
			);
			if (index === -1) {
				return { ok: false, failure: { kind: "no_staged_proposal", alias } };
			}
			if (index !== proposals.length - 1) {
				// Sequential staging: later proposals compiled against a working
				// document that includes this one — discarding it would invalidate
				// them. Rebase is Phase 2+'s open gate; until then the refusal is
				// typed and the UI should offer latest-first rejection.
				return {
					ok: false,
					failure: {
						kind: "proposal_not_latest",
						alias,
						latestAlias: proposals[proposals.length - 1]!.requestAlias,
					},
				};
			}
			const proposal = proposals[index]!;
			const closingNote = note?.trim() ? note.trim() : "Rejected in review.";
			const discarded = m.session.discardProposal(alias, closingNote);
			if (!discarded.ok) {
				return {
					ok: false,
					failure: { kind: "discard_failed", message: discarded.message },
				};
			}
			m.review.set(alias, "rejected");

			const annotation = await settleSidecar(m, entry, {
				resolution: closingNote,
			});

			emit(m, {
				type: "proposal-rejected",
				sessionId: m.session.id,
				alias,
				transactionId: proposal.transactionId,
				note: closingNote,
			});

			return {
				ok: true,
				alias,
				transactionId: proposal.transactionId,
				request: discarded.request,
				annotation,
			};
		},

		async undoAccepted(sessionId, requestAlias) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			const alias = requestAlias.trim();
			if (!allowWrites) {
				return { ok: false, failure: { kind: "writes_disabled" } };
			}
			if (
				!m.session.requests().some((candidate) => candidate.alias === alias)
			) {
				return { ok: false, failure: { kind: "unknown_request", alias } };
			}
			if (m.review.get(alias) !== "applied") {
				return { ok: false, failure: { kind: "not_applied", alias } };
			}
			const top = m.applied[m.applied.length - 1];
			if (!top || top.alias !== alias) {
				return {
					ok: false,
					failure: {
						kind: "not_latest_applied",
						alias,
						lastAppliedAlias: top?.alias ?? alias,
					},
				};
			}

			const revertedDocument = revertSteps(m.currentDocument, top.steps);
			const saved = await opts.catalog.savePrompt(
				m.targetAgent,
				revertedDocument,
				m.currentHash,
				PROMPT_REVISION_SOURCE.AGENT_RUN,
			);
			if (saved === null) {
				return {
					ok: false,
					failure: {
						kind: "save_failed",
						errors: [`agent ${m.targetAgent} no longer in catalog`],
					},
				};
			}
			if (!saved.ok) {
				if ("currentHash" in saved) {
					return {
						ok: false,
						failure: {
							kind: "stale_base",
							expectedHash: m.currentHash,
							currentHash: saved.currentHash,
						},
					};
				}
				return {
					ok: false,
					failure: { kind: "save_failed", errors: saved.errors },
				};
			}

			m.currentDocument = revertedDocument;
			m.currentHash = saved.hash;
			m.applied.pop();
			m.acceptedCount -= 1;
			// The proposal is staged again from the service's point of view: it
			// becomes the next acceptable alias (chain symmetry).
			m.review.set(alias, "undone");

			emit(m, {
				type: "proposal-undone",
				sessionId: m.session.id,
				alias,
				transactionId: top.transactionId,
				hash: saved.hash,
			});

			return {
				ok: true,
				alias,
				transactionId: top.transactionId,
				hash: saved.hash,
			};
		},

		replyToRequest(sessionId, requestAlias, body) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			// RE-RUN ON REPLY includes a request the agent already resolved
			// `done`: while its staged proposal awaits review, a human reply
			// REOPENS the loop (the next turn re-proposes, replacing the staged
			// proposal). Once the review settled it (applied/rejected), the
			// thread is genuinely closed and appendHumanReply refuses below.
			const entry = m.session
				.requests()
				.find((candidate) => candidate.alias === requestAlias.trim());
			const review = entry && m.review.get(entry.alias);
			if (
				entry !== undefined &&
				entry.status === "done" &&
				(review === undefined || review === "undone")
			) {
				const reopened = m.session.reopenForRerun(entry.alias);
				if (!reopened.ok) return reopened;
			}
			const result = m.session.appendHumanReply(requestAlias, body);
			if (!result.ok) return result;
			// RE-RUN ON REPLY (header): the reply is now on the thread, so a new
			// turn re-proposes for this request — replacing its staged proposal
			// rather than stacking a second one. Detached and coalesced; a
			// headless session (no spawn function) just keeps the reply.
			runAgentTurn(
				m,
				relaunchPromptEditSession(
					m.launch,
					promptEditRerunKickoff([result.request.alias]),
				),
				[result.request.alias],
			);
			return result;
		},

		addHumanRequest(sessionId, input) {
			const m = sessions.get(sessionId);
			if (!m) return null;
			const id =
				input.id?.trim() ||
				`${m.session.id}-host-req-${m.session.requests().length + 1}-${Date.now().toString(36)}`;
			return m.session.addRequest({
				id,
				target: input.target,
				body: input.body,
				...(input.author !== undefined ? { author: input.author } : {}),
			});
		},

		dispose(sessionId) {
			const m = sessions.get(sessionId);
			if (!m) return false;
			// Stops a settling turn from scheduling a follow-up. A turn already
			// in flight is NOT killed — the service does not own the agent run;
			// its tools keep driving a session nobody is listening to, which is
			// harmless (nothing is written without an accept).
			m.disposed = true;
			m.pendingRerunAliases.clear();
			m.agent.rerunPending = false;
			emit(m, { type: "session-disposed", sessionId: m.session.id });
			m.unsubscribeSession();
			m.listeners.clear();
			sessions.delete(sessionId);
			return true;
		},

		disposeAll() {
			for (const sessionId of [...sessions.keys()]) this.dispose(sessionId);
		},
	};
}
