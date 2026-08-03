/**
 * prompt-edit-session/types — the shared vocabulary of the prompt-editing
 * agent session (Phase 1 of the prompt-editor build-out).
 *
 * A session runs one agent over a batch of annotation requests against one
 * agent's prompt document and produces STAGED, validated transaction
 * proposals. Phase 1 explicitly excludes the apply/accept path: proposals are
 * held on the session, never written to the prompt.
 *
 * Model ported from canvas-agent's session queue (session-stable R-aliases,
 * per-request disposition, non-blocking agent threads) and adapted to
 * prompt-kit targets: node / node-range / whole-document.
 */
import type {
	PromptBlockNode,
	PromptDiagnostic,
} from "@codecaine-ai/prompt-kit";
import type {
	PromptBlockNodePatch,
	PromptStep,
	PromptTransaction,
} from "@codecaine-ai/prompt-kit/ui";

/** The catalog name of the editing agent bundle. Referenced by name only —
 * this module never touches the bundle's files. */
export const PROMPT_EDITOR_AGENT_NAME = "prompt-editor";

// ---------------------------------------------------------------------------
// Targets & requests
// ---------------------------------------------------------------------------

/**
 * What a request points at. Mirrors the lab's annotation targets:
 * `doc` is the whole-document target (the lab encodes it as nodeId===docId;
 * here it is explicit), `node` anchors to one block node, `range` to a
 * character range of one node's rendered extent.
 */
export type PromptEditTarget =
	| { kind: "doc" }
	| { kind: "node"; nodeId: string }
	| {
			kind: "range";
			nodeId: string;
			start: number;
			end: number;
			quote?: string;
	  };

export type PromptEditRequestAuthor = "human" | "agent" | "system";

export interface PromptEditThreadReply {
	author: PromptEditRequestAuthor;
	body: string;
	createdAt?: string;
}

/** One annotation request handed to the session at creation. */
export interface PromptEditRequestInput {
	/** The underlying annotation id (sidecar id once persistence lands). */
	id: string;
	target: PromptEditTarget;
	/** The thread's opening post. */
	body: string;
	/** Who opened the thread. Defaults to "human". */
	author?: PromptEditRequestAuthor;
	/** Prior replies on the thread, oldest first. */
	thread?: PromptEditThreadReply[];
}

/**
 * Session-level request status.
 * - `open`: nothing staged yet.
 * - `proposal-ready`: a validated proposal is staged for this request.
 * - `done`: disposed by the agent after staging a proposal. The underlying
 *   annotation moves to "applied-pending-review" — the edit is staged, not
 *   applied; the human review in Phase 2 settles it.
 * - `declined`: consciously not done; the note is the closing reply. Maps to
 *   annotation status "resolved".
 */
export type PromptEditRequestStatus =
	| "open"
	| "proposal-ready"
	| "done"
	| "declined";

/** Annotation status a disposition closes its thread with (canvas ports
 * done→applied; here staged edits await review, hence applied-pending-review). */
export const PROMPT_EDIT_DISPOSITION_STATUS: Record<
	"done" | "declined",
	"applied-pending-review" | "resolved"
> = {
	done: "applied-pending-review",
	declined: "resolved",
};

/**
 * One queue entry: an annotation thread plus its session-level state.
 * Entries are treated as immutable snapshots — every mutation replaces the
 * object, so emitted events carry stable state.
 */
export interface PromptEditRequestEntry {
	/** Session-stable model-facing alias: R1, R2, … in queue order. */
	alias: string;
	/** The underlying annotation id. */
	annotationId: string;
	target: PromptEditTarget;
	body: string;
	/** Who opened the thread. Only non-agent entries gate session completion. */
	author: PromptEditRequestAuthor;
	/** Everything said since the opening post, oldest first. */
	replies: readonly PromptEditThreadReply[];
	status: PromptEditRequestStatus;
	/**
	 * Set when the agent replied into the thread (its replies are addressed to
	 * the human); cleared when the host appends a human reply.
	 */
	waitingOnHuman: boolean;
	/** The resolve_request note, set when the entry is disposed. */
	note?: string;
	/** Transaction id of the staged proposal for this request, when one exists. */
	proposalId?: string;
}

// ---------------------------------------------------------------------------
// Semantic ops (the tool boundary — id-relative, never path-based)
// ---------------------------------------------------------------------------

export type PromptEditOp =
	| { op: "update_node"; nodeId: string; patch: PromptBlockNodePatch }
	| { op: "insert_after"; refNodeId: string; node: PromptBlockNode }
	| {
			op: "insert_into";
			parentNodeId: string;
			index?: number;
			node: PromptBlockNode;
	  }
	| { op: "remove_node"; nodeId: string }
	| { op: "move_after"; nodeId: string; refNodeId: string };

export type PromptEditOpErrorCode =
	| "invalid_op_shape"
	| "unknown_node"
	| "cannot_contain_children"
	| "cannot_change_id"
	| "cannot_change_type"
	| "noop_update"
	| "move_ref_inside_subtree"
	| "empty_ops";

export interface PromptEditOpError {
	code: PromptEditOpErrorCode;
	/** Index of the offending op in the submitted ops array (-1 for empty_ops). */
	opIndex: number;
	nodeId?: string;
	message: string;
}

export type PromptEditCompileResult =
	| {
			ok: true;
			steps: PromptStep[];
			/** Primary node id touched per op, deduplicated, in op order. */
			changedIds: string[];
	  }
	| { ok: false; errors: PromptEditOpError[] };

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** One staged, validated proposal: held on the session, never applied. */
export interface PromptEditProposal {
	/** patchId of the annotation contract — equals transaction.id. */
	transactionId: string;
	requestAlias: string;
	/** Inherited from the session (the hash the whole batch started from). */
	baseHash: string;
	steps: PromptStep[];
	changedIds: string[];
	summary: string;
	/** Plain xml-markdown render of the working document before/after this
	 * proposal (diff-ready; no node-id markers). */
	renderedBefore: string;
	renderedAfter: string;
	createdAt: string;
	transaction: PromptTransaction;
}

/** Why a propose_transaction call was rejected. Nothing is staged on failure. */
export type PromptEditProposeFailure =
	| { kind: "unknown_request"; alias: string }
	| { kind: "request_disposed"; alias: string; status: PromptEditRequestStatus }
	| {
			/** Re-proposing / replacing is only allowed for the most recently
			 * staged proposal — later proposals build on the working document.
			 * Phase 1 sequential-staging constraint. */
			kind: "proposal_not_latest";
			alias: string;
	  }
	| {
			/** The live prompt's hash moved since the session was created. The
			 * rebase policy is an open gate — Phase 1 only detects and surfaces. */
			kind: "stale_base";
			expectedHash: string;
			actualHash: string;
	  }
	| { kind: "compile"; errors: PromptEditOpError[] }
	| {
			/** validatePrompt found NEW error diagnostics on the edited document
			 * (diagnostics already present on the session base are not charged
			 * to the proposal). */
			kind: "validation";
			diagnostics: PromptDiagnostic[];
	  }
	| { kind: "invalid_params"; message: string };

export type PromptEditProposeResult =
	| { ok: true; proposal: PromptEditProposal }
	| { ok: false; failure: PromptEditProposeFailure };

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** `running` until every human/system-authored request is disposed. */
export type PromptEditSessionStatus = "running" | "completed";

export type PromptEditSessionEvent =
	| {
			type: "request-updated";
			sessionId: string;
			request: PromptEditRequestEntry;
	  }
	| {
			type: "proposal-staged";
			sessionId: string;
			proposal: PromptEditProposal;
	  }
	| {
			type: "thread-updated";
			sessionId: string;
			alias: string;
			request: PromptEditRequestEntry;
	  }
	| {
			type: "session-status";
			sessionId: string;
			status: PromptEditSessionStatus;
	  }
	// -- Phase 2 review events. Emitted by the host-side session SERVICE
	// (prompt-edit-session/service.ts) on its forwarded stream, never by the
	// session state machine itself — they describe what the apply path did
	// with a staged proposal.
	| {
			/** The proposal was applied and saved: a new prompt revision exists. */
			type: "proposal-applied";
			sessionId: string;
			alias: string;
			transactionId: string;
			/** Canonical hash of the newly saved revision. */
			hash: string;
	  }
	| {
			/** The staged proposal was discarded by the human reviewer. */
			type: "proposal-rejected";
			sessionId: string;
			alias: string;
			transactionId: string;
			note?: string;
	  }
	| {
			/** A previously applied proposal was reverted (write-through undo). */
			type: "proposal-undone";
			sessionId: string;
			alias: string;
			transactionId: string;
			/** Canonical hash of the prompt after the revert save. */
			hash: string;
	  };

export type PromptEditSessionListener = (event: PromptEditSessionEvent) => void;
