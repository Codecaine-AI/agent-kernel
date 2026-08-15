/**
 * Section ③ — the docs-writer's state sidecar (state/index.ts, discovered by
 * the registry's filename convention).
 *
 * The repo and its docs tooling are the working picture. The state `S`
 * carries only the session's aim — WHICH doc path is being worked and the
 * operator's task notes — so the model re-reads files instead of trusting a
 * cached copy.
 *
 * Seed contract — optional sessionData the booting harness may supply:
 *
 *   sessionData.targetDocPath  string   — doc path currently being worked
 *   sessionData.taskNotes      string[] — task notes for this session
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

/** The docs-writer's state `S`. Plain JSON — snapshots to state.json. */
export interface DocsWriterState {
	/** Doc path currently being worked; "(unset)" until chosen. */
	targetDocPath: string;
	/** Operator task notes accumulated this session, oldest first. */
	taskNotes: string[];
}

function seed(ctx: SpawnContext, prior?: DocsWriterState): DocsWriterState {
	if (prior) {
		return {
			targetDocPath: prior.targetDocPath,
			taskNotes: [...prior.taskNotes],
		};
	}
	const target = ctx.sessionData?.targetDocPath;
	const notes = ctx.sessionData?.taskNotes;
	return {
		targetDocPath:
			typeof target === "string" && target.length > 0 ? target : "(unset)",
		taskNotes: Array.isArray(notes)
			? notes.filter((note): note is string => typeof note === "string")
			: [],
	};
}

/**
 * v1 pass-through: the operator steers interactively and every durable change
 * lands in the repo's docs, so no kernel session event moves this state.
 * `update` satisfies the contract and is the seam a later version folds
 * events into.
 */
function update(state: DocsWriterState, _event: SessionEvent): DocsWriterState {
	return state;
}

/**
 * One kernel:state message — a compact <docs_writer_state> block — followed
 * by the default rolling window over the live conversation.
 */
function render(state: DocsWriterState, ctx: RenderContext): RenderResult {
	const notes =
		state.taskNotes.length > 0
			? state.taskNotes.map((note) => `- ${note}`).join("\n")
			: "(no notes yet)";
	const body = [
		`<docs_writer_state target="${state.targetDocPath}">`,
		notes,
		"</docs_writer_state>",
	].join("\n");
	const tail = renderRollingWindow(ctx);
	return {
		messages: [kernelStateMessage(body), ...tail.messages],
		stateMessageCount: 1 + (tail.stateMessageCount ?? 0),
	};
}

export const state = defineState<DocsWriterState>({ seed, update, render });
export default state;
