/**
 * prompt-edit-session/session-data — the sessionData payload the prompt-editor
 * bundle's context sidecar consumes (catalog/prompt-editor/context/index.ts).
 *
 * The bundle's documented contract, reproduced key for key:
 *
 *   sessionData.targetPromptRender  string — node-id-stamped render of the
 *                                   target prompt
 *   sessionData.targetPromptHash    string — canonical hash (pk1-…) proposals
 *                                   build on
 *   sessionData.requestQueue        string — the rendered queue body
 *
 * The payload is a pure function of CURRENT session state: `renderedPrompt()`
 * is the working document (base plus every staged proposal) and
 * `requestsBlock()` re-renders the live queue, so hosts can call this again
 * after `add_note` / `propose` / `resolve` and get a fresh payload.
 * `targetPromptHash` stays the session's baseHash by design — proposals chain
 * on the base revision, staged edits do not move it.
 *
 * What the runner does with a rebuilt payload: the spawn pipeline snapshots
 * `sessionData` once per spawn and assembles the context block once at session
 * creation — it does NOT re-assemble mid-run. A rebuilt payload therefore only
 * reaches a model on a NEW spawn; mid-run freshness is the `read_prompt`
 * tool's job, which serves these same renders straight off the session.
 */
import type { PromptEditSession } from "./session";

/** Exactly the three keys the prompt-editor context contract names. */
export interface PromptEditSessionData {
	targetPromptRender: string;
	targetPromptHash: string;
	requestQueue: string;
}

export function sessionDataForPromptEditSession(
	session: Pick<
		PromptEditSession,
		"baseHash" | "renderedPrompt" | "requestsBlock"
	>,
): PromptEditSessionData {
	return {
		targetPromptRender: session.renderedPrompt(),
		targetPromptHash: session.baseHash,
		requestQueue: session.requestsBlock(),
	};
}
