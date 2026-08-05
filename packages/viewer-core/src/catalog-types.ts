import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	DanglingTarget,
	PromptAnnotation,
	PromptAnnotationIntent,
	PromptAnnotationsDocument,
	PromptAnnotationStatus,
	PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";
import type { PromptStep } from "@codecaine-ai/prompt-kit/ui";

/**
 * Browser-safe DTO types for the kernel catalog API (see KERNEL_CATALOG_PATHS
 * in ./api.ts). These mirror the wire shapes served by the kernel's catalog
 * routes — no db imports, plain JSON payloads only.
 */

/** One row from `GET /kernel/catalog/agents`. */
export interface CatalogAgentSummary {
	name: string;
	description: string;
	model: string;
	promptHash: string;
	valid: boolean;
}

/** Response of `GET /kernel/catalog/agents`. */
export interface CatalogAgentListResponse {
	agents: CatalogAgentSummary[];
}

/** One resolved context input within `CatalogContextPreview.inputs`. */
export interface CatalogContextInput {
	loaderKind: string;
	inputRef: string;
	status: "ok" | "empty" | "error";
	bytes: number;
}

/** Assembled context preview carried on `GET /kernel/catalog/agents/:name`. */
export interface CatalogContextPreview {
	modulePath: string | null;
	inputs: CatalogContextInput[];
	/** Null when no preview could be assembled. */
	renderedContext: string | null;
}

/** One named state fixture (`fixtures/<id>.json` in the agent bundle). */
export interface CatalogFixtureSummary {
	id: string;
	label: string;
}

/**
 * Rendered state document for one agent + fixture — the lab's State view.
 * Response of `GET /kernel/catalog/agents/:name/fixtures/:id/state-preview`.
 */
export interface CatalogStatePreview {
	fixtureId: string;
	/** "state-module" when the bundle's state render produced it; "fallback"
	 * is a pseudo-XML pretty-print of the fixture's state value. */
	source: "state-module" | "fallback";
	renderedState: string;
}

/** Response of `GET /kernel/catalog/agents/:name`. */
export interface CatalogAgentDetail {
	manifest: Record<string, unknown>;
	prompt: PromptDocument;
	promptHash: string;
	rendered: string;
	declaredVariables: string[];
	/** Model alias keys (models.aliases config) — datalist suggestions for the model field. */
	modelAliases: string[];
	/**
	 * Assembled context preview — null when the agent has no context module.
	 * Optional so payloads from kernels that omit the field still typecheck.
	 */
	context?: CatalogContextPreview | null;
	/**
	 * Named state fixtures of the bundle — empty when it ships none. Optional
	 * so payloads from kernels that omit the field still typecheck.
	 */
	fixtures?: CatalogFixtureSummary[];
}

/** Body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestPatch {
	description?: string;
	model?: string;
}

/** 200 body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestSaveSuccess {
	manifest: Record<string, unknown>;
}

/** 400 body of `PUT /kernel/catalog/agents/:name/manifest`. */
export interface CatalogManifestSaveFailure {
	errors: string[];
}

export type CatalogManifestSaveResult =
	| CatalogManifestSaveSuccess
	| CatalogManifestSaveFailure;

/** 200 body of `PUT /kernel/catalog/agents/:name/prompt`. */
export interface CatalogPromptSaveSuccess {
	hash: string;
}

/** 400 body of `PUT /kernel/catalog/agents/:name/prompt`. */
export interface CatalogPromptSaveFailure {
	errors: string[];
}

export type CatalogPromptSaveResult =
	| CatalogPromptSaveSuccess
	| CatalogPromptSaveFailure;

/** One row from `GET /kernel/catalog/agents/:name/revisions`. */
export interface PromptRevisionSummary {
	hash: string;
	source: string;
	createdAt: string;
}

/** Response of `GET /kernel/catalog/agents/:name/revisions`. */
export interface PromptRevisionListResponse {
	revisions: PromptRevisionSummary[];
}

/** Response of `GET /kernel/catalog/agents/:name/revisions/:hash/document`. */
export interface PromptRevisionDocumentResponse {
	hash: string;
	createdAt: string;
	document: PromptDocument;
}

/** Response of `GET /kernel/catalog/agents/:name/revisions/:hash/stats`. */
export interface PromptRevisionStats {
	runs: number;
	totalTokens: number;
	avgTokens: number;
	cost: number | null;
	failures: number;
}

// ---------------------------------------------------------------------------
// Annotation sidecar (live-only annotations.json beside the bundle's prompt)
// ---------------------------------------------------------------------------

/** Response of `GET /kernel/catalog/agents/:name/annotations`. */
export interface CatalogAnnotationsResponse {
	annotations: PromptAnnotationsDocument;
	/** SHA-256 of the sidecar bytes; null when no sidecar exists yet. */
	hash: string | null;
	/** Advisory: entries whose targets no longer resolve on the current prompt. */
	dangling: DanglingTarget[];
}

/** Body of `POST /kernel/catalog/agents/:name/annotations`. */
export interface CatalogAnnotationAddRequest {
	target: PromptAnnotationTarget;
	body: string;
	intent: PromptAnnotationIntent;
	author: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/replies`. */
export interface CatalogAnnotationReplyRequest {
	author: string;
	body: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/resolve`. */
export interface CatalogAnnotationResolveRequest {
	/** Defaults to "resolved"; pass "open" to re-open. */
	status?: PromptAnnotationStatus;
	/** Optional resolution note persisted on the annotation. */
	resolution?: string;
	expectedHash?: string;
}

/** Body of `POST .../annotations/:id/agent-run`. */
export interface CatalogAnnotationAgentRunRequest {
	sessionId: string;
	patchId: string;
	summary: string;
	changedIds?: string[];
	expectedHash?: string;
}

/** Body of `POST .../annotations/prune` (live-only compaction of resolved entries). */
export interface CatalogAnnotationPruneRequest {
	/** ISO cutoff: only resolved entries created before this are pruned. */
	resolvedOlderThan?: string;
	expectedHash?: string;
}

/** 200 body of the add/reply/resolve/agent-run annotation mutations. */
export interface CatalogAnnotationMutationSuccess {
	ok: true;
	annotation: PromptAnnotation;
	annotations: PromptAnnotationsDocument;
	hash: string;
}

/** 200 body of `DELETE .../annotations/:id`. */
export interface CatalogAnnotationRemoveSuccess {
	ok: true;
	annotations: PromptAnnotationsDocument;
	hash: string;
}

/** 200 body of `POST .../annotations/prune`. */
export interface CatalogAnnotationPruneSuccess {
	ok: true;
	removed: number;
	annotations: PromptAnnotationsDocument;
	hash: string | null;
}

/** 409 body of any annotation mutation (stale expectedHash). */
export interface CatalogAnnotationConflict {
	currentHash: string | null;
}

/** 400/422 body of any annotation mutation (invalid input or corrupt sidecar). */
export interface CatalogAnnotationFailure {
	errors: string[];
}

// ---------------------------------------------------------------------------
// Prompt-edit sessions (Phase 2: annotation → agent proposals → human review)
//
// Wire mirror of the kernel's prompt-edit-session service state
// (agent-kernel kernel/src/prompt-edit-session/service.ts) — structurally
// compatible, no kernel dependency. This is the Phase 2 contract the lab UI
// consumes: session state + proposals with renderedBefore/renderedAfter for
// the inline diff, accept/reject/undo endpoints, and a typed SSE event stream.
// ---------------------------------------------------------------------------

/** What a prompt-edit request points at (session-level target vocabulary). */
export type PromptEditSessionTarget =
	| { kind: "doc" }
	| { kind: "node"; nodeId: string }
	| {
			kind: "range";
			nodeId: string;
			start: number;
			end: number;
			quote?: string;
	  };

export type PromptEditSessionAuthor = "human" | "agent" | "system";

/** One reply in a request thread. */
export interface PromptEditSessionReply {
	author: PromptEditSessionAuthor;
	body: string;
	createdAt?: string;
}

/** Agent-side disposition of a request within the session. */
export type PromptEditSessionRequestStatus =
	| "open"
	| "proposal-ready"
	| "done"
	| "declined";

/** Human-review disposition, overlaid on the request by the apply path. */
export type PromptEditReviewStatus =
	| "pending"
	| "applied"
	| "rejected"
	| "undone";

/** One request entry of the session queue as served to the review UI. */
export interface PromptEditSessionRequestDto {
	/** Session-stable alias: R1, R2, … in queue order. */
	alias: string;
	/** The underlying sidecar annotation id (host/agent-generated ids for
	 * requests without a sidecar annotation). */
	annotationId: string;
	target: PromptEditSessionTarget;
	body: string;
	author: PromptEditSessionAuthor;
	replies: PromptEditSessionReply[];
	status: PromptEditSessionRequestStatus;
	/** The agent replied and awaits a human answer (POST .../replies clears it). */
	waitingOnHuman: boolean;
	/** Closing note, set when the entry is disposed. */
	note?: string;
	/** Transaction id of the staged proposal for this request, when one exists. */
	proposalId?: string;
	review: PromptEditReviewStatus;
}

/** One staged proposal with diff-ready renders (plain xml-markdown, no
 * node-id markers) plus the raw steps for rendered-line mapping. */
export interface PromptEditSessionProposalDto {
	/** Equals the transaction id; the sidecar agentRun patchId on accept. */
	transactionId: string;
	requestAlias: string;
	/** Hash of the base revision the whole batch was staged against. */
	baseHash: string;
	steps: PromptStep[];
	changedIds: string[];
	summary: string;
	renderedBefore: string;
	renderedAfter: string;
	createdAt: string;
	review: PromptEditReviewStatus;
}

/** Whether a live prompt-editor agent run is attached to the session. */
export interface PromptEditSessionAgentDto {
	spawned: boolean;
	error?: string;
	// The turn fields below are always served by this kernel; they are optional
	// so payloads from kernels that predate re-run-on-reply still typecheck.
	/** An agent turn is in flight (the lab's "working…" state). */
	running?: boolean;
	/** Turns started so far: 1 is the session's own spawn, 2+ are reply re-runs. */
	turns?: number;
	/** A reply arrived mid-turn; a follow-up turn is already scheduled. */
	rerunPending?: boolean;
}

/** One annotation that did not become a request at session creation. */
export interface PromptEditSessionSkippedDto {
	annotationId: string;
	reason: string;
	detail?: string;
}

/** Full session state: 201 body of the create route (`{ state }`), 200 body
 * of `GET /kernel/prompt-edit-sessions/:id` (`{ state }`), and the SSE
 * `session-state` hello event. */
export interface PromptEditSessionStateDto {
	sessionId: string;
	targetAgent: string;
	baseHash: string;
	/** Currently saved revision as the session's apply path tracks it. */
	currentHash: string;
	/** "running" until every human/system request is disposed. */
	status: "running" | "completed";
	instruction?: string;
	createdAt: string;
	/**
	 * The annotation ids this session was scoped to, or null when it works
	 * every open agent-request. One id is the lab's "run now"; a set is
	 * "apply the batch". Optional so payloads from kernels that predate
	 * request scoping still typecheck (absent reads as unscoped).
	 */
	scope?: string[] | null;
	requests: PromptEditSessionRequestDto[];
	proposals: PromptEditSessionProposalDto[];
	/** Staging-order pointer: the only alias accept will take next. */
	nextAcceptAlias: string | null;
	/** The only alias undo will take (most recently applied), if any. */
	undoableAlias: string | null;
	skipped: PromptEditSessionSkippedDto[];
	agent: PromptEditSessionAgentDto;
}

/** One row of `GET /kernel/prompt-edit-sessions`. */
export interface PromptEditSessionSummaryDto {
	sessionId: string;
	targetAgent: string;
	status: "running" | "completed";
	createdAt: string;
	baseHash: string;
	currentHash: string;
	requestCount: number;
	proposalCount: number;
	appliedCount: number;
	scope?: string[] | null;
}

/** Response of `GET /kernel/prompt-edit-sessions`. */
export interface PromptEditSessionListResponse {
	sessions: PromptEditSessionSummaryDto[];
}

/** Body of `POST /kernel/catalog/agents/:name/edit-sessions`. */
export interface PromptEditSessionCreateRequest {
	/** Operator instruction; also the agent kickoff prompt. */
	instruction?: string;
	/**
	 * Scope the session to these annotation ids — the lab's filing gestures:
	 * one id for "run now", the queued set for "apply". Omitted: every open
	 * agent-request. Must be non-empty when present (400 otherwise); a scope
	 * where nothing is actionable answers 409 `empty-scope`.
	 */
	requestIds?: string[];
	/** Requests appended after the annotation-derived ones. */
	extraRequests?: Array<{
		id: string;
		target: PromptEditSessionTarget;
		body: string;
		author?: PromptEditSessionAuthor;
		thread?: PromptEditSessionReply[];
	}>;
	sessionId?: string;
	/** False: create the session without spawning the editor agent. */
	spawn?: boolean;
}

/** Body of `POST /kernel/prompt-edit-sessions/:id/requests`. */
export interface PromptEditSessionAddRequestBody {
	/** Omitted: the service generates one (no sidecar annotation attached). */
	id?: string;
	target: PromptEditSessionTarget;
	body: string;
	author?: PromptEditSessionAuthor;
}

/** Body of `POST /kernel/prompt-edit-sessions/:id/requests/:alias/reject`. */
export interface PromptEditSessionRejectRequest {
	note?: string;
}

/** Body of `POST /kernel/prompt-edit-sessions/:id/requests/:alias/replies`. */
export interface PromptEditSessionReplyRequest {
	body: string;
}

/** Sidecar outcome piggybacked on accept/reject success bodies (the prompt
 * write already landed; sidecar trouble is reported, never a failure). */
export interface PromptEditSessionAnnotationOutcome {
	annotationId: string;
	attached: boolean;
	resolved: boolean;
	detail?: string;
}

/** 200 body of `POST .../requests/:alias/accept`. */
export interface PromptEditSessionAcceptSuccess {
	ok: true;
	alias: string;
	transactionId: string;
	/** Canonical hash of the newly saved revision (source "agent-run"). */
	hash: string;
	annotation: PromptEditSessionAnnotationOutcome;
}

/** 200 body of `POST .../requests/:alias/reject`. */
export interface PromptEditSessionRejectSuccess {
	ok: true;
	alias: string;
	transactionId: string;
	request: PromptEditSessionRequestDto;
	annotation: PromptEditSessionAnnotationOutcome;
}

/** 200 body of `POST .../requests/:alias/undo`. */
export interface PromptEditSessionUndoSuccess {
	ok: true;
	alias: string;
	transactionId: string;
	/** Canonical hash after the revert save (write-through undo revision). */
	hash: string;
}

/** 409 body of the review mutations: stale base carries `currentHash` (the
 * savePrompt idiom); review-order conflicts carry the typed `failure`. */
export interface PromptEditSessionReviewConflict {
	currentHash?: string;
	failure: PromptEditSessionReviewFailure;
}

/** Typed review failure carried on 4xx bodies of accept/reject/undo. */
export type PromptEditSessionReviewFailure =
	| { kind: "writes_disabled" }
	| { kind: "unknown_request"; alias: string }
	| { kind: "no_staged_proposal"; alias: string }
	| { kind: "already_applied"; alias: string }
	| { kind: "out_of_order"; alias: string; nextAlias: string }
	| { kind: "proposal_not_latest"; alias: string; latestAlias: string }
	| { kind: "not_applied"; alias: string }
	| { kind: "not_latest_applied"; alias: string; lastAppliedAlias: string }
	| { kind: "stale_base"; expectedHash: string; currentHash: string }
	| { kind: "save_failed"; errors: string[] }
	| { kind: "discard_failed"; message: string };

/** Events on `GET /kernel/prompt-edit-sessions/:id/events` (SSE, one JSON
 * object per `data:` frame). The stream opens with `session-state` and ends
 * after `session-disposed`. */
export type PromptEditSessionEventDto =
	| {
			type: "session-state";
			sessionId: string;
			state: PromptEditSessionStateDto;
	  }
	| {
			type: "request-updated";
			sessionId: string;
			request: PromptEditSessionRequestDto;
	  }
	| {
			type: "proposal-staged";
			sessionId: string;
			proposal: PromptEditSessionProposalDto;
	  }
	| {
			type: "thread-updated";
			sessionId: string;
			alias: string;
			request: PromptEditSessionRequestDto;
	  }
	| {
			type: "session-status";
			sessionId: string;
			status: "running" | "completed";
	  }
	| {
			type: "proposal-applied";
			sessionId: string;
			alias: string;
			transactionId: string;
			hash: string;
	  }
	| {
			type: "proposal-rejected";
			sessionId: string;
			alias: string;
			transactionId: string;
			note?: string;
	  }
	| {
			type: "proposal-undone";
			sessionId: string;
			alias: string;
			transactionId: string;
			hash: string;
	  }
	| {
			/**
			 * An agent turn on this session started, finished, or failed to
			 * start. Turn 1 is the session's own spawn; later turns are the
			 * re-runs a human reply on a thread triggers ("working…" in the lab).
			 */
			type: "agent-turn";
			sessionId: string;
			phase: "started" | "finished" | "failed";
			turn: number;
			/** Aliases the turn was kicked off for; empty for turn 1. */
			aliases: string[];
			error?: string;
	  }
	| { type: "session-disposed"; sessionId: string };

/**
 * 409 body of `POST /kernel/catalog/agents/:name/edit-sessions`: the request
 * was well-formed but could not become a session.
 *
 * - `agent-busy`: another session already holds this agent. Sessions are
 *   base-hash pinned, so only one can safely stage at a time — end the named
 *   one (DELETE) or wait for it.
 * - `empty-scope`: none of `requestIds` is an open, actionable agent request
 *   (already resolved, dangling, or gone); `skipped` says which and why.
 */
export type PromptEditSessionCreateFailure =
	| { ok: false; reason: "agent-busy"; targetAgent: string; sessionId: string }
	| {
			ok: false;
			reason: "empty-scope";
			requestIds: string[];
			skipped: PromptEditSessionSkippedDto[];
	  };

/** 409 body of the create route: human-readable `error` + the typed failure. */
export interface PromptEditSessionCreateConflict {
	error: string;
	failure: PromptEditSessionCreateFailure;
}
