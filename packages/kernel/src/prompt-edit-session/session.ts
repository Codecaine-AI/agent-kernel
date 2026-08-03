/**
 * prompt-edit-session/session — the session state machine.
 *
 * One session = one editing agent working a batch of annotation requests
 * against one target agent's prompt (whole-prompt context, the canvas batch
 * topology). The session owns:
 *
 * - the request queue with session-stable R-aliases (R1, R2, … in creation
 *   order; `add_note` entries continue the numbering mid-session),
 * - the WORKING DOCUMENT: the base prompt plus every staged proposal applied
 *   in staging order (ops always compile against this),
 * - the staged proposals themselves (Phase 1 holds them; the Phase 2 apply
 *   path consumes them),
 * - a typed push-callback event stream (`subscribe`, kernel session idiom).
 *
 * Validation is an automatic retry loop: `propose` compiles, applies to a
 * scratch document, and runs `validatePrompt`; any failure is returned as a
 * typed result and NOTHING is staged — the tool layer feeds the errors back
 * to the agent so an invalid proposal never surfaces to a human.
 *
 * Phase 1 sequential-staging constraint: proposals chain on the working
 * document, so re-proposing or declining a request that already staged a
 * proposal is only allowed while that proposal is the most recently staged
 * one (its steps can then be cleanly reverted with `revertSteps`). The
 * general rebase/reorder case is Phase 2's apply machinery.
 *
 * Stale-base guard: `baseHash` is captured at creation and inherited by every
 * proposal. When `getCurrentPromptHash` (usually a registry lookup) reports a
 * different live hash, `propose` fails with a typed `stale_base` — detection
 * only, no rebase (open gate).
 */
import {
	hashPrompt,
	renderXmlMarkdown,
	validatePrompt,
	type PromptDiagnostic,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import {
	ensurePromptNodeIds,
	getPromptBlockNodeById,
	revertSteps,
	type PromptTransaction,
} from "@codecaine-ai/prompt-kit/ui";

import { compilePromptEditOps } from "./compile-ops";
import {
	formatPromptEditRequestsBlock,
	renderPromptWithNodeIds,
} from "./render";
import type {
	PromptEditOp,
	PromptEditProposal,
	PromptEditProposeResult,
	PromptEditRequestAuthor,
	PromptEditRequestEntry,
	PromptEditRequestInput,
	PromptEditSessionEvent,
	PromptEditSessionListener,
	PromptEditSessionStatus,
	PromptEditThreadReply,
} from "./types";

export interface CreatePromptEditSessionOptions {
	/** Name of the agent whose prompt is being edited (registry name). */
	targetAgent: string;
	/** The base prompt document (canonical, as stored/served by the registry).
	 * Node ids are ensured on ingest. */
	document: PromptDocument;
	/** Hash of the base revision; computed with `hashPrompt` when omitted. */
	baseHash?: string;
	requests: PromptEditRequestInput[];
	/** Optional operator instruction accompanying the batch. */
	instruction?: string;
	/** Declared prompt variables (agent.json `variables` keys) for validation. */
	declaredVariables?: Iterable<string>;
	/**
	 * Live hash lookup for the stale-base guard — usually
	 * `() => registry.tryGet(targetAgent)?.promptHash`. Undefined result means
	 * "unknown" and is treated as not stale.
	 */
	getCurrentPromptHash?: () =>
		| string
		| undefined
		| Promise<string | undefined>;
	sessionId?: string;
	now?: () => string;
	generateTransactionId?: () => string;
}

export type ResolvePromptEditRequestResult =
	| { ok: true; request: PromptEditRequestEntry }
	| { ok: false; message: string };

export type ReplyPromptEditRequestResult =
	| { ok: true; request: PromptEditRequestEntry }
	| { ok: false; message: string };

export type AddPromptEditNoteResult =
	| { ok: true; request: PromptEditRequestEntry }
	| { ok: false; message: string };

export interface PromptEditSession {
	readonly id: string;
	readonly targetAgent: string;
	readonly baseHash: string;
	readonly instruction?: string;
	status(): PromptEditSessionStatus;
	requests(): readonly PromptEditRequestEntry[];
	proposals(): readonly PromptEditProposal[];
	/** Base document + every staged proposal applied in staging order. */
	workingDocument(): PromptDocument;
	/** Annotated render of the working document (node-id markers). */
	renderedPrompt(): string;
	/** Re-rendered from the live queue on every call. */
	requestsBlock(): string;
	subscribe(listener: PromptEditSessionListener): () => void;

	/** Compile → scratch-apply → validate → stage. Nothing staged on failure. */
	propose(
		requestAliasOrId: string,
		ops: readonly PromptEditOp[],
		summary: string,
	): Promise<PromptEditProposeResult>;
	/** done requires a staged proposal; declined discards one (latest only). */
	resolve(
		aliasOrId: string,
		outcome: "done" | "declined",
		note: string,
	): ResolvePromptEditRequestResult;
	/** Agent reply into a thread; flags the entry waiting-on-human. */
	reply(aliasOrId: string, body: string): ReplyPromptEditRequestResult;
	/** Agent-authored placed note; joins the queue with the next alias. */
	addNote(nodeId: string, body: string): AddPromptEditNoteResult;
	/** Host-side: human answer into a thread; clears waiting-on-human. */
	appendHumanReply(
		aliasOrId: string,
		body: string,
	): ReplyPromptEditRequestResult;
	/**
	 * Host-side (Phase 2 review surface): discard the staged proposal for a
	 * request and mark it declined with the reviewer's note — regardless of
	 * whether the agent already resolved the entry "done" (the human review
	 * overrides the agent's disposition). Same latest-only constraint as the
	 * agent decline path: a proposal that later proposals build on cannot be
	 * discarded without a rebase (sequential staging).
	 */
	discardProposal(
		aliasOrId: string,
		note: string,
	): ResolvePromptEditRequestResult;
	/**
	 * Host-side: append a new request mid-session (author defaults "human").
	 * Joins the queue with the next alias; a new open human request flips a
	 * completed session back to running.
	 */
	addRequest(input: PromptEditRequestInput): AddPromptEditNoteResult;
}

let sessionCounter = 0;

export function createPromptEditSession(
	options: CreatePromptEditSessionOptions,
): PromptEditSession {
	const now = options.now ?? (() => new Date().toISOString());
	let txnCounter = 0;
	const generateTransactionId =
		options.generateTransactionId ??
		(() => `pes-txn-${(txnCounter += 1)}-${Date.now().toString(36)}`);

	const id =
		options.sessionId ??
		`pes-${(sessionCounter += 1)}-${Date.now().toString(36)}`;
	const baseDocument = ensurePromptNodeIds(options.document);
	const baseHash = options.baseHash ?? hashPrompt(baseDocument);
	const declaredVariables = options.declaredVariables
		? [...options.declaredVariables]
		: undefined;

	/** Error diagnostics already present on the base document — proposals are
	 * only charged for NEW errors, so a pre-existing invalid prompt cannot
	 * deadlock the retry loop. */
	const baselineErrorKeys = new Set(
		validatePrompt(baseDocument, { declaredVariables })
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map(diagnosticKey),
	);

	let workingDoc = baseDocument;
	let status: PromptEditSessionStatus = "running";
	let entries: PromptEditRequestEntry[] = options.requests.map(
		(request, index) => ({
			alias: `R${index + 1}`,
			annotationId: request.id,
			target: request.target,
			body: request.body,
			author: request.author ?? "human",
			replies: [...(request.thread ?? [])],
			status: "open",
			waitingOnHuman: false,
		}),
	);
	let aliasCounter = entries.length;
	const stagedProposals: PromptEditProposal[] = [];
	let noteCounter = 0;

	const listeners = new Set<PromptEditSessionListener>();
	function emit(event: PromptEditSessionEvent): void {
		for (const listener of listeners) listener(event);
	}

	function findEntry(aliasOrId: string): PromptEditRequestEntry | undefined {
		const wanted = aliasOrId.trim();
		return entries.find(
			(entry) => entry.alias === wanted || entry.annotationId === wanted,
		);
	}

	/** Entries are immutable snapshots: replace, never mutate. */
	function replaceEntry(
		alias: string,
		patch: Partial<PromptEditRequestEntry>,
	): PromptEditRequestEntry {
		let updated: PromptEditRequestEntry | undefined;
		entries = entries.map((entry) => {
			if (entry.alias !== alias) return entry;
			updated = { ...entry, ...patch };
			return updated;
		});
		if (!updated) throw new Error(`prompt-edit-session: no entry ${alias}`);
		return updated;
	}

	function refreshStatus(): void {
		const next: PromptEditSessionStatus = entries
			.filter((entry) => entry.author !== "agent")
			.every((entry) => entry.status === "done" || entry.status === "declined")
			? "completed"
			: "running";
		if (next !== status) {
			status = next;
			emit({ type: "session-status", sessionId: id, status });
		}
	}

	async function propose(
		requestAliasOrId: string,
		ops: readonly PromptEditOp[],
		summary: string,
	): Promise<PromptEditProposeResult> {
		if (typeof summary !== "string" || summary.trim() === "") {
			return {
				ok: false,
				failure: {
					kind: "invalid_params",
					message: "propose_transaction requires a non-empty one-line summary.",
				},
			};
		}
		const entry = findEntry(requestAliasOrId);
		if (!entry) {
			return {
				ok: false,
				failure: { kind: "unknown_request", alias: requestAliasOrId.trim() },
			};
		}
		if (entry.status === "done" || entry.status === "declined") {
			return {
				ok: false,
				failure: {
					kind: "request_disposed",
					alias: entry.alias,
					status: entry.status,
				},
			};
		}

		const replacing =
			entry.status === "proposal-ready" && entry.proposalId !== undefined
				? stagedProposals.find(
						(proposal) => proposal.transactionId === entry.proposalId,
					)
				: undefined;
		if (entry.status === "proposal-ready" && replacing) {
			const latest = stagedProposals[stagedProposals.length - 1];
			if (latest?.transactionId !== replacing.transactionId) {
				return {
					ok: false,
					failure: { kind: "proposal_not_latest", alias: entry.alias },
				};
			}
		}

		// Stale-base guard: detection only, rebase is an open gate.
		const liveHash = await options.getCurrentPromptHash?.();
		if (liveHash !== undefined && liveHash !== baseHash) {
			return {
				ok: false,
				failure: {
					kind: "stale_base",
					expectedHash: baseHash,
					actualHash: liveHash,
				},
			};
		}

		// Nothing below mutates session state until every check has passed.
		const compileBase = replacing
			? revertSteps(workingDoc, replacing.steps)
			: workingDoc;
		const compiled = compilePromptEditOps(compileBase, ops);
		if (!compiled.ok) {
			return { ok: false, failure: { kind: "compile", errors: compiled.errors } };
		}

		const validation = validatePrompt(compiled.doc, { declaredVariables });
		const newErrors = validation.diagnostics.filter(
			(diagnostic) =>
				diagnostic.severity === "error" &&
				!baselineErrorKeys.has(diagnosticKey(diagnostic)),
		);
		if (newErrors.length > 0) {
			return {
				ok: false,
				failure: { kind: "validation", diagnostics: newErrors },
			};
		}

		const transaction: PromptTransaction = {
			id: generateTransactionId(),
			baseHash,
			steps: compiled.steps,
			timestamp: now(),
		};
		const proposal: PromptEditProposal = {
			transactionId: transaction.id,
			requestAlias: entry.alias,
			baseHash,
			steps: compiled.steps,
			changedIds: compiled.changedIds,
			summary: summary.trim(),
			renderedBefore: renderXmlMarkdown(compileBase),
			renderedAfter: renderXmlMarkdown(compiled.doc),
			createdAt: transaction.timestamp,
			transaction,
		};

		if (replacing) {
			stagedProposals.splice(
				stagedProposals.findIndex(
					(candidate) => candidate.transactionId === replacing.transactionId,
				),
				1,
			);
		}
		stagedProposals.push(proposal);
		workingDoc = compiled.doc;
		const updated = replaceEntry(entry.alias, {
			status: "proposal-ready",
			proposalId: proposal.transactionId,
		});
		emit({ type: "proposal-staged", sessionId: id, proposal });
		emit({ type: "request-updated", sessionId: id, request: updated });
		return { ok: true, proposal };
	}

	function resolve(
		aliasOrId: string,
		outcome: "done" | "declined",
		note: string,
	): ResolvePromptEditRequestResult {
		if (typeof note !== "string" || note.trim() === "") {
			return {
				ok: false,
				message:
					"resolve_request requires a non-empty note — say what you did, or why you declined.",
			};
		}
		const entry = findEntry(aliasOrId);
		if (!entry) {
			return { ok: false, message: `No request "${aliasOrId.trim()}" in the queue.` };
		}
		if (entry.status === "done" || entry.status === "declined") {
			return { ok: false, message: `${entry.alias} is already ${entry.status}.` };
		}

		if (outcome === "done") {
			if (!entry.proposalId) {
				return {
					ok: false,
					message: `${entry.alias} has no staged proposal — call propose_transaction before resolving it done, or decline it.`,
				};
			}
		} else if (entry.proposalId) {
			// Declining discards the staged proposal; Phase 1 allows that only
			// for the most recently staged one (clean revert).
			const latest = stagedProposals[stagedProposals.length - 1];
			if (latest?.transactionId !== entry.proposalId) {
				return {
					ok: false,
					message: `${entry.alias} staged a proposal that later proposals build on — it can no longer be declined in this session (Phase 1 sequential staging).`,
				};
			}
			stagedProposals.pop();
			workingDoc = revertSteps(workingDoc, latest.steps);
		}

		const closingReply: PromptEditThreadReply = {
			author: "agent",
			body: note.trim(),
			createdAt: now(),
		};
		const updated = replaceEntry(entry.alias, {
			status: outcome,
			note: note.trim(),
			replies: [...entry.replies, closingReply],
			waitingOnHuman: false,
			proposalId: outcome === "done" ? entry.proposalId : undefined,
		});
		emit({ type: "request-updated", sessionId: id, request: updated });
		emit({
			type: "thread-updated",
			sessionId: id,
			alias: updated.alias,
			request: updated,
		});
		refreshStatus();
		return { ok: true, request: updated };
	}

	function appendReply(
		aliasOrId: string,
		author: PromptEditRequestAuthor,
		body: string,
	): ReplyPromptEditRequestResult {
		if (typeof body !== "string" || body.trim() === "") {
			return { ok: false, message: "Reply body must be a non-empty string." };
		}
		const entry = findEntry(aliasOrId);
		if (!entry) {
			return { ok: false, message: `No request "${aliasOrId.trim()}" in the queue.` };
		}
		if (entry.status === "done" || entry.status === "declined") {
			return {
				ok: false,
				message: `${entry.alias} is already ${entry.status} — its thread is closed.`,
			};
		}
		const reply: PromptEditThreadReply = {
			author,
			body: body.trim(),
			createdAt: now(),
		};
		const updated = replaceEntry(entry.alias, {
			replies: [...entry.replies, reply],
			// An agent reply is addressed to the human (a question or a status
			// the human should read); a human reply answers it.
			waitingOnHuman: author === "agent",
		});
		emit({
			type: "thread-updated",
			sessionId: id,
			alias: updated.alias,
			request: updated,
		});
		return { ok: true, request: updated };
	}

	function discardProposal(
		aliasOrId: string,
		note: string,
	): ResolvePromptEditRequestResult {
		if (typeof note !== "string" || note.trim() === "") {
			return {
				ok: false,
				message: "discardProposal requires a non-empty note — say why the edit was rejected.",
			};
		}
		const entry = findEntry(aliasOrId);
		if (!entry) {
			return { ok: false, message: `No request "${aliasOrId.trim()}" in the queue.` };
		}
		if (!entry.proposalId) {
			return { ok: false, message: `${entry.alias} has no staged proposal to discard.` };
		}
		const latest = stagedProposals[stagedProposals.length - 1];
		if (latest?.transactionId !== entry.proposalId) {
			return {
				ok: false,
				message: `${entry.alias} staged a proposal that later proposals build on — it cannot be discarded without a rebase (sequential staging).`,
			};
		}
		stagedProposals.pop();
		workingDoc = revertSteps(workingDoc, latest.steps);
		const closingReply: PromptEditThreadReply = {
			author: "human",
			body: note.trim(),
			createdAt: now(),
		};
		const updated = replaceEntry(entry.alias, {
			status: "declined",
			note: note.trim(),
			replies: [...entry.replies, closingReply],
			waitingOnHuman: false,
			proposalId: undefined,
		});
		emit({ type: "request-updated", sessionId: id, request: updated });
		emit({
			type: "thread-updated",
			sessionId: id,
			alias: updated.alias,
			request: updated,
		});
		refreshStatus();
		return { ok: true, request: updated };
	}

	function addRequest(input: PromptEditRequestInput): AddPromptEditNoteResult {
		if (typeof input?.body !== "string" || input.body.trim() === "") {
			return { ok: false, message: "addRequest requires a non-empty body." };
		}
		if (typeof input.id !== "string" || input.id.trim() === "") {
			return { ok: false, message: "addRequest requires an id." };
		}
		if (findEntry(input.id)) {
			return { ok: false, message: `Request "${input.id}" is already in the queue.` };
		}
		const target = input.target;
		if (target.kind !== "doc") {
			const nodeId = target.nodeId?.trim?.() ?? "";
			if (
				nodeId === "" ||
				(nodeId !== workingDoc.id && !getPromptBlockNodeById(workingDoc, nodeId))
			) {
				return {
					ok: false,
					message: `No node "${nodeId}" in the current document to target.`,
				};
			}
		}
		aliasCounter += 1;
		const entry: PromptEditRequestEntry = {
			alias: `R${aliasCounter}`,
			annotationId: input.id,
			target,
			body: input.body.trim(),
			author: input.author ?? "human",
			replies: [...(input.thread ?? [])],
			status: "open",
			waitingOnHuman: false,
		};
		entries = [...entries, entry];
		emit({ type: "request-updated", sessionId: id, request: entry });
		refreshStatus();
		return { ok: true, request: entry };
	}

	function addNote(nodeId: string, body: string): AddPromptEditNoteResult {
		if (typeof body !== "string" || body.trim() === "") {
			return { ok: false, message: "add_note requires a non-empty body." };
		}
		const trimmedNodeId = nodeId?.trim?.() ?? "";
		if (trimmedNodeId === "") {
			return { ok: false, message: "add_note requires a nodeId." };
		}
		const isDocTarget = trimmedNodeId === workingDoc.id;
		if (!isDocTarget && !getPromptBlockNodeById(workingDoc, trimmedNodeId)) {
			return {
				ok: false,
				message: `No node "${trimmedNodeId}" in the current document to place a note on.`,
			};
		}
		aliasCounter += 1;
		noteCounter += 1;
		const entry: PromptEditRequestEntry = {
			alias: `R${aliasCounter}`,
			annotationId: `${id}-note-${noteCounter}`,
			target: isDocTarget
				? { kind: "doc" }
				: { kind: "node", nodeId: trimmedNodeId },
			body: body.trim(),
			author: "agent",
			replies: [],
			status: "open",
			// A placed agent note is a question/observation for the human.
			waitingOnHuman: true,
		};
		entries = [...entries, entry];
		emit({ type: "request-updated", sessionId: id, request: entry });
		return { ok: true, request: entry };
	}

	return {
		id,
		targetAgent: options.targetAgent,
		baseHash,
		instruction: options.instruction,
		status: () => status,
		requests: () => entries,
		proposals: () => [...stagedProposals],
		workingDocument: () => workingDoc,
		renderedPrompt: () => renderPromptWithNodeIds(workingDoc),
		requestsBlock: () => formatPromptEditRequestsBlock(entries),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		propose,
		resolve,
		reply: (aliasOrId, body) => appendReply(aliasOrId, "agent", body),
		addNote,
		appendHumanReply: (aliasOrId, body) =>
			appendReply(aliasOrId, "human", body),
		discardProposal,
		addRequest,
	};
}

function diagnosticKey(diagnostic: PromptDiagnostic): string {
	return [
		diagnostic.code,
		diagnostic.nodeId ?? "",
		(diagnostic.path ?? []).join("."),
	].join("|");
}
