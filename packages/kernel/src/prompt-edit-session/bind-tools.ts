/**
 * prompt-edit-session/bind-tools — the thin shell around the pure handlers.
 *
 * Follows the kernel's private-tools convention: a register function with the
 * `AgentPrivateTools` shape (`(pi, runtime) => void`) that calls
 * `pi.registerTool` with TypeBox parameter schemas and delegates every
 * execute to the pure handlers in `tools.ts`. The prompt-editor agent bundle
 * (referenced by name only — `PROMPT_EDITOR_AGENT_NAME`) can re-export
 * `promptEditSessionTools(session)` from its `tools.ts` sidecar, or a host
 * can pass it through `sharedTools`.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentRegistry } from "../agent-registry";
import type { PromptEditSession } from "./session";
import {
	toolAddNote,
	toolProposeTransaction,
	toolReadPrompt,
	toolReplyRequest,
	toolResolveRequest,
	type PromptEditToolResult,
} from "./tools";

/** Registry-backed live-hash lookup for the session's stale-base guard. */
export function registryPromptHashLookup(
	registry: Pick<AgentRegistry, "tryGet">,
	targetAgent: string,
): () => string | undefined {
	return () => registry.tryGet(targetAgent)?.promptHash ?? undefined;
}

function toPiResult(result: PromptEditToolResult): {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
} {
	return {
		content: [{ type: "text", text: result.text }],
		details: result.details,
		...(result.isError ? { isError: true } : {}),
	};
}

/** Loose node/patch schema: full recursive PromptBlockNode schemas are not
 * practical in TypeBox; the compiler narrows and returns typed errors. */
const NodeSchema = Type.Record(Type.String(), Type.Unknown(), {
	description: "A prompt-kit block node (type + type-specific fields).",
});

const OpSchema = Type.Union([
	Type.Object({
		op: Type.Literal("update_node"),
		nodeId: Type.String(),
		patch: NodeSchema,
	}),
	Type.Object({
		op: Type.Literal("insert_after"),
		refNodeId: Type.String(),
		node: NodeSchema,
	}),
	Type.Object({
		op: Type.Literal("insert_into"),
		parentNodeId: Type.String(),
		index: Type.Optional(Type.Number()),
		node: NodeSchema,
	}),
	Type.Object({
		op: Type.Literal("remove_node"),
		nodeId: Type.String(),
	}),
	Type.Object({
		op: Type.Literal("move_after"),
		nodeId: Type.String(),
		refNodeId: Type.String(),
	}),
]);

export function registerPromptEditSessionTools(
	pi: ExtensionAPI,
	session: PromptEditSession,
): void {
	pi.registerTool({
		name: "read_prompt",
		label: "Read the target prompt",
		description:
			"Read the working prompt document rendered with node-id markers (<!-- #id -->) plus the current REQUESTS block. Call it before proposing and whenever you need fresh state — staged proposals are already applied to what you see.",
		promptSnippet:
			"Read the annotated prompt document and the current request queue.",
		parameters: Type.Object({}),
		executionMode: "sequential",
		execute: async () => toPiResult(toolReadPrompt(session)),
	});

	pi.registerTool({
		name: "propose_transaction",
		label: "Propose a prompt edit",
		description:
			"Compile semantic ops into a prompt transaction for one request, validate it, and STAGE it for human review (never applied directly). Ops are id-relative — update_node {nodeId, patch}, insert_after {refNodeId, node}, insert_into {parentNodeId, index?, node}, remove_node {nodeId}, move_after {nodeId, refNodeId} — and run in order against the current working document. On any compile or validation failure the errors come back as this tool's result and nothing is staged: fix the ops and call again.",
		promptSnippet: "Stage a validated prompt-edit transaction for a request.",
		parameters: Type.Object({
			requestAlias: Type.String({
				description: 'The queue alias the edit answers, e.g. "R1".',
			}),
			ops: Type.Array(OpSchema, { minItems: 1 }),
			summary: Type.String({
				description: "One line for the reviewer: what this edit does and why.",
			}),
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) =>
			toPiResult(await toolProposeTransaction(session, params)),
	});

	pi.registerTool({
		name: "resolve_request",
		label: "Resolve a request",
		description:
			'Dispose one queue entry. Use outcome "done" after propose_transaction staged an edit for it (the annotation moves to applied-pending-review), or "declined" when you consciously will not do it (moves to resolved). The note is the closing reply the human reads. Every human-authored request must be disposed before the session completes.',
		promptSnippet: "Dispose one request queue entry (done or declined).",
		parameters: Type.Object({
			alias: Type.String({ description: 'An open queue entry, e.g. "R1".' }),
			outcome: Type.Union([Type.Literal("done"), Type.Literal("declined")]),
			note: Type.String({
				description: "Required. What you did, or why you declined.",
			}),
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) =>
			toPiResult(toolResolveRequest(session, params)),
	});

	pi.registerTool({
		name: "reply_request",
		label: "Reply in a request thread",
		description:
			"Post a reply into an open request thread without closing it — ask a clarifying question or report progress. This never blocks: the entry is flagged waiting-on-human, you keep working on your best reading, and resolve_request stays the closing move.",
		promptSnippet: "Reply into a request thread (non-blocking).",
		parameters: Type.Object({
			alias: Type.String({ description: 'The thread to reply in, e.g. "R2".' }),
			body: Type.String({
				description: "What to say, specific enough to answer without context.",
			}),
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) =>
			toPiResult(toolReplyRequest(session, params)),
	});

	pi.registerTool({
		name: "add_note",
		label: "Place a note on a node",
		description:
			"Open an agent-authored note anchored to one node (or to the whole document by passing the document id). It joins the request queue with the next alias, non-blocking — use it to flag conflicts or observations the human should see in place, e.g. 'this section contradicts <output-format>'.",
		promptSnippet: "Anchor a non-blocking agent note to a prompt node.",
		parameters: Type.Object({
			nodeId: Type.String({
				description: "The node id to anchor to (a <!-- #id --> marker), or the document id for a doc-level note.",
			}),
			body: Type.String({
				description: "The note, readable on its own.",
			}),
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) =>
			toPiResult(toolAddNote(session, params)),
	});
}

/** `AgentPrivateTools`-shaped factory: bind these tools to one session. */
export function promptEditSessionTools(
	session: PromptEditSession,
): (pi: ExtensionAPI) => void {
	return (pi) => registerPromptEditSessionTools(pi, session);
}
