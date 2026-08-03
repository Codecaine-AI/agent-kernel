/**
 * prompt-edit-session/tools — agent tool handlers v1, as pure functions over
 * a `PromptEditSession`. The prompt-editor bundle's prompt is written against
 * these names:
 *
 * - read_prompt            {}                              — annotated render + requests block
 * - propose_transaction    {requestAlias, ops, summary}    — compile → validate → stage (errors bounce back)
 * - resolve_request        {alias, outcome, note}          — done|declined disposition
 * - reply_request          {alias, body}                   — non-blocking thread reply
 * - add_note               {nodeId, body}                  — agent-authored placed note
 *
 * Every handler returns a `PromptEditToolResult` (`isError` + model-facing
 * `text` + structured `details`); the pi binding in `bind-tools.ts` maps that
 * onto the kernel's tool-result convention. Handlers never throw on bad
 * input — the error IS the tool result, which is what makes the validation
 * retry loop automatic.
 */
import { formatPromptEditRequestsBlock } from "./render";
import { parsePromptEditOps } from "./compile-ops";
import type { PromptEditSession } from "./session";
import type { PromptEditProposeFailure } from "./types";

export interface PromptEditToolResult {
	isError?: boolean;
	text: string;
	details: Record<string, unknown>;
}

export const PROMPT_EDIT_TOOL_NAMES = [
	"read_prompt",
	"propose_transaction",
	"resolve_request",
	"reply_request",
	"add_note",
] as const;

export type PromptEditToolName = (typeof PROMPT_EDIT_TOOL_NAMES)[number];

function requestsBlock(session: PromptEditSession): string {
	return formatPromptEditRequestsBlock(session.requests());
}

// ---------------------------------------------------------------------------
// read_prompt
// ---------------------------------------------------------------------------

export function toolReadPrompt(session: PromptEditSession): PromptEditToolResult {
	const doc = session.workingDocument();
	const text = [
		`PROMPT · agent "${session.targetAgent}" · doc "${doc.id}" · base ${session.baseHash}`,
		"Node ids are the <!-- #id --> markers; semantic ops address them.",
		"",
		session.renderedPrompt(),
		"",
		requestsBlock(session),
	].join("\n");
	return {
		text,
		details: {
			targetAgent: session.targetAgent,
			docId: doc.id,
			baseHash: session.baseHash,
			status: session.status(),
		},
	};
}

// ---------------------------------------------------------------------------
// propose_transaction
// ---------------------------------------------------------------------------

function proposeFailureText(failure: PromptEditProposeFailure): string {
	switch (failure.kind) {
		case "unknown_request":
			return `propose_transaction rejected: no request "${failure.alias}" in the queue.`;
		case "request_disposed":
			return `propose_transaction rejected: ${failure.alias} is already ${failure.status}.`;
		case "proposal_not_latest":
			return `propose_transaction rejected: ${failure.alias} already staged a proposal that later proposals build on — it cannot be replaced in this session.`;
		case "stale_base":
			return (
				`propose_transaction rejected: stale base — the live prompt is now ${failure.actualHash}, ` +
				`this session started from ${failure.expectedHash}. Stop proposing; report this in your resolution notes.`
			);
		case "compile":
			return [
				"propose_transaction rejected: ops did not compile. Nothing was staged. Fix the ops and retry:",
				...failure.errors.map((error) => `  - [${error.code}] ${error.message}`),
			].join("\n");
		case "validation":
			return [
				"propose_transaction rejected: the edited prompt fails validation. Nothing was staged. Fix and retry:",
				...failure.diagnostics.map(
					(diagnostic) =>
						`  - [${diagnostic.code}] ${diagnostic.message}` +
						(diagnostic.nodeId ? ` (node ${diagnostic.nodeId})` : ""),
				),
			].join("\n");
		case "invalid_params":
			return `propose_transaction rejected: ${failure.message}`;
	}
}

export async function toolProposeTransaction(
	session: PromptEditSession,
	params: { requestAlias?: unknown; ops?: unknown; summary?: unknown },
): Promise<PromptEditToolResult> {
	const alias =
		typeof params.requestAlias === "string" ? params.requestAlias : "";
	if (alias.trim() === "") {
		return {
			isError: true,
			text: 'propose_transaction rejected: requestAlias must name a queue entry (e.g. "R1").',
			details: { ok: false },
		};
	}
	const parsed = parsePromptEditOps(params.ops);
	if (!parsed.ok) {
		return {
			isError: true,
			text: [
				"propose_transaction rejected: malformed ops. Nothing was staged. Fix and retry:",
				...parsed.errors.map((error) => `  - [${error.code}] ${error.message}`),
			].join("\n"),
			details: { ok: false, errors: parsed.errors },
		};
	}

	const result = await session.propose(
		alias,
		parsed.ops,
		typeof params.summary === "string" ? params.summary : "",
	);
	if (!result.ok) {
		return {
			isError: true,
			text: proposeFailureText(result.failure),
			details: { ok: false, failure: result.failure },
		};
	}

	const proposal = result.proposal;
	return {
		text: [
			`STAGED · transaction ${proposal.transactionId} for ${proposal.requestAlias} (held for human review — not applied)`,
			`changed nodes: ${proposal.changedIds.join(", ")}`,
			`summary: ${proposal.summary}`,
			"",
			requestsBlock(session),
		].join("\n"),
		details: {
			ok: true,
			transactionId: proposal.transactionId,
			requestAlias: proposal.requestAlias,
			baseHash: proposal.baseHash,
			changedIds: proposal.changedIds,
		},
	};
}

// ---------------------------------------------------------------------------
// resolve_request
// ---------------------------------------------------------------------------

export function toolResolveRequest(
	session: PromptEditSession,
	params: { alias?: unknown; outcome?: unknown; note?: unknown },
): PromptEditToolResult {
	const alias = typeof params.alias === "string" ? params.alias : "";
	const outcome = params.outcome;
	if (alias.trim() === "") {
		return {
			isError: true,
			text: 'resolve_request rejected: alias must name a queue entry (e.g. "R1").',
			details: { ok: false },
		};
	}
	if (outcome !== "done" && outcome !== "declined") {
		return {
			isError: true,
			text: 'resolve_request rejected: outcome must be "done" or "declined".',
			details: { ok: false },
		};
	}
	const result = session.resolve(
		alias,
		outcome,
		typeof params.note === "string" ? params.note : "",
	);
	if (!result.ok) {
		return {
			isError: true,
			text: [`resolve_request rejected: ${result.message}`, requestsBlock(session)].join(
				"\n",
			),
			details: { ok: false },
		};
	}
	return {
		text: requestsBlock(session),
		details: {
			ok: true,
			alias: result.request.alias,
			status: result.request.status,
			sessionStatus: session.status(),
		},
	};
}

// ---------------------------------------------------------------------------
// reply_request
// ---------------------------------------------------------------------------

export function toolReplyRequest(
	session: PromptEditSession,
	params: { alias?: unknown; body?: unknown },
): PromptEditToolResult {
	const alias = typeof params.alias === "string" ? params.alias : "";
	const result = session.reply(
		alias,
		typeof params.body === "string" ? params.body : "",
	);
	if (!result.ok) {
		return {
			isError: true,
			text: [`reply_request rejected: ${result.message}`, requestsBlock(session)].join(
				"\n",
			),
			details: { ok: false },
		};
	}
	return {
		text: [
			`REPLIED · ${result.request.alias} (waiting-on-human — the run does not block; keep working)`,
			"",
			requestsBlock(session),
		].join("\n"),
		details: {
			ok: true,
			alias: result.request.alias,
			waitingOnHuman: result.request.waitingOnHuman,
		},
	};
}

// ---------------------------------------------------------------------------
// add_note
// ---------------------------------------------------------------------------

export function toolAddNote(
	session: PromptEditSession,
	params: { nodeId?: unknown; body?: unknown },
): PromptEditToolResult {
	const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
	const result = session.addNote(
		nodeId,
		typeof params.body === "string" ? params.body : "",
	);
	if (!result.ok) {
		return {
			isError: true,
			text: [`add_note rejected: ${result.message}`, requestsBlock(session)].join("\n"),
			details: { ok: false },
		};
	}
	return {
		text: [
			`NOTED · ${result.request.alias} placed on ${
				result.request.target.kind === "doc"
					? "doc"
					: `node:${(result.request.target as { nodeId: string }).nodeId}`
			} (non-blocking; the human answers on their own time)`,
			"",
			requestsBlock(session),
		].join("\n"),
		details: {
			ok: true,
			alias: result.request.alias,
			annotationId: result.request.annotationId,
		},
	};
}
