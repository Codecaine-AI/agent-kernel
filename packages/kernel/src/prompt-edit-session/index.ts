/**
 * prompt-edit-session — Phase 1 of the prompt-editor agent: the session
 * machinery that runs a prompt-editing agent over a queue of annotation
 * requests and produces STAGED, validated transaction proposals.
 *
 * Public surface:
 * - `createPromptEditSession` — the pure session state machine (queue with
 *   session-stable R-aliases, working document, staged proposals, typed
 *   event stream).
 * - `compilePromptEditOps` / `parsePromptEditOps` — the id-relative semantic
 *   ops → path-based PromptStep[] compiler.
 * - tool handlers (`toolReadPrompt`, `toolProposeTransaction`, …) — pure
 *   functions the agent tools delegate to.
 * - `registerPromptEditSessionTools` / `promptEditSessionTools` — the thin
 *   pi binding following the kernel private-tools convention.
 * - `registryPromptHashLookup` — stale-base guard wired to the registry.
 *
 * Phase 2 adds the host-side apply path:
 * - `createPromptEditSessionService` — in-memory session lifecycle manager
 *   (create/get/list/dispose) plus the accept/reject/undo review flow that
 *   writes accepted proposals through savePrompt (source "agent-run") and
 *   settles the annotation sidecar. Its HTTP surface is
 *   ../prompt-edit-session-api.ts.
 */
export {
	PROMPT_EDITOR_AGENT_NAME,
	PROMPT_EDIT_DISPOSITION_STATUS,
} from "./types";
export type {
	PromptEditTarget,
	PromptEditRequestAuthor,
	PromptEditThreadReply,
	PromptEditRequestInput,
	PromptEditRequestStatus,
	PromptEditRequestEntry,
	PromptEditOp,
	PromptEditOpErrorCode,
	PromptEditOpError,
	PromptEditCompileResult,
	PromptEditProposal,
	PromptEditProposeFailure,
	PromptEditProposeResult,
	PromptEditSessionStatus,
	PromptEditSessionEvent,
	PromptEditSessionListener,
} from "./types";

export {
	compilePromptEditOps,
	parsePromptEditOps,
} from "./compile-ops";
export type {
	CompilePromptEditOpsResult,
	CompilePromptEditOpsSuccess,
	CompilePromptEditOpsFailure,
	ParsePromptEditOpsResult,
} from "./compile-ops";

export {
	PROMPT_EDIT_REQUESTS_EMPTY,
	formatPromptEditRequestLine,
	formatPromptEditRequestThread,
	formatPromptEditRequestsBlock,
	promptEditTargetText,
	renderPromptWithNodeIds,
} from "./render";

export { createPromptEditSession } from "./session";
export type {
	CreatePromptEditSessionOptions,
	PromptEditSession,
	ResolvePromptEditRequestResult,
	ReplyPromptEditRequestResult,
	AddPromptEditNoteResult,
} from "./session";

export {
	PROMPT_EDIT_TOOL_NAMES,
	toolAddNote,
	toolProposeTransaction,
	toolReadPrompt,
	toolReplyRequest,
	toolResolveRequest,
} from "./tools";
export type { PromptEditToolName, PromptEditToolResult } from "./tools";

export {
	promptEditSessionTools,
	registerPromptEditSessionTools,
	registryPromptHashLookup,
} from "./bind-tools";

export { sessionDataForPromptEditSession } from "./session-data";
export type { PromptEditSessionData } from "./session-data";

export { promptEditRequestsFromAnnotations } from "./from-annotations";
export type {
	PromptEditRequestsFromAnnotations,
	PromptEditRequestsFromAnnotationsOptions,
	SkippedAnnotation,
	SkippedAnnotationReason,
} from "./from-annotations";

export {
	DEFAULT_PROMPT_EDIT_KICKOFF,
	launchPromptEditSession,
} from "./launch";

export { createPromptEditSessionService } from "./service";
export type {
	AcceptPromptEditProposalFailure,
	AcceptPromptEditProposalResult,
	CreatePromptEditSessionInput,
	CreatePromptEditSessionResult,
	CreatePromptEditSessionServiceOptions,
	PromptEditAnnotationOutcome,
	PromptEditReviewStatus,
	PromptEditSessionAgentState,
	PromptEditSessionProposalState,
	PromptEditSessionRequestState,
	PromptEditSessionService,
	PromptEditSessionState,
	PromptEditSessionStreamEvent,
	PromptEditSessionStreamListener,
	PromptEditSessionSummary,
	PromptEditSimpleResult,
	RejectPromptEditProposalFailure,
	RejectPromptEditProposalResult,
	UndoAcceptedProposalFailure,
	UndoAcceptedProposalResult,
} from "./service";
export type {
	LaunchedPromptEditSession,
	LaunchPromptEditSessionFailure,
	LaunchPromptEditSessionOptions,
	LaunchPromptEditSessionResult,
} from "./launch";
