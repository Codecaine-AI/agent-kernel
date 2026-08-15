/**
 * Section ③ — the context-editor's state sidecar (state/index.ts, discovered
 * by the registry's filename convention).
 *
 * The agent is mostly stateless in v1: it edits sidecar *sources* in the
 * repo, and the repo itself is the working picture. The state `S` carries
 * only the session's aim — WHICH bundle is being edited and the operator's
 * running notes — so the model re-reads the target instead of trusting a
 * cached copy.
 *
 * Seed contract — optional sessionData the booting harness may supply:
 *
 *   sessionData.targetBundle  string   — catalog name of the bundle to edit
 *   sessionData.notes         string[] — carry-over notes for this session
 *
 * Both keys degrade to explicit placeholders; the bundle boots (and
 * previews) without any session data.
 */
import { defineState } from "@agent-kernel/kernel/agent-definition";
import type { SpawnContext } from "@agent-kernel/kernel/context";
import {
	kernelStateMessage,
	renderRollingWindow,
	type RenderContext,
	type RenderResult,
	type SessionEvent,
} from "@agent-kernel/kernel/state";

/** The context-editor's state `S`. Plain JSON — snapshots to state.json. */
export interface ContextEditorState {
	/** Catalog name of the bundle being edited; "(unset)" until chosen. */
	targetBundle: string;
	/** Operator notes accumulated this session, oldest first. */
	notes: string[];
}

function seed(ctx: SpawnContext, prior?: ContextEditorState): ContextEditorState {
	if (prior) return { targetBundle: prior.targetBundle, notes: [...prior.notes] };
	const target = ctx.sessionData?.targetBundle;
	const notes = ctx.sessionData?.notes;
	return {
		targetBundle:
			typeof target === "string" && target.length > 0 ? target : "(unset)",
		notes: Array.isArray(notes)
			? notes.filter((note): note is string => typeof note === "string")
			: [],
	};
}

/**
 * v1 pass-through: the operator steers interactively and every durable change
 * lands in the repo's files, so no kernel session event moves this state.
 * `update` satisfies the contract and is the seam a later version folds
 * events into.
 */
function update(
	state: ContextEditorState,
	_event: SessionEvent,
): ContextEditorState {
	return state;
}

/**
 * One kernel:state message — a compact <context_editor_state> block —
 * followed by the default rolling window over the live conversation.
 */
function render(state: ContextEditorState, ctx: RenderContext): RenderResult {
	const notes =
		state.notes.length > 0
			? state.notes.map((note) => `- ${note}`).join("\n")
			: "(no notes yet)";
	const body = [
		`<context_editor_state target="${state.targetBundle}">`,
		notes,
		"</context_editor_state>",
	].join("\n");
	const tail = renderRollingWindow(ctx);
	return {
		messages: [kernelStateMessage(body), ...tail.messages],
		stateMessageCount: 1 + (tail.stateMessageCount ?? 0),
	};
}

export const state = defineState<ContextEditorState>({ seed, update, render });
export default state;
