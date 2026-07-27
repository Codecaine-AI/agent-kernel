/**
 * base.ts — the base state module: a completely normal agent.
 *
 * This is the centerpiece. An agent with no `state.ts` has no schema, no XML
 * state block, no ceremony — its state IS its messages, and the default
 * renderer shows them as a rolling window with one elision marker where
 * history was cut. The counters below exist only so `update` has somewhere to
 * fold events into; nothing in the request is derived from them.
 *
 * There is no compaction step anywhere, because nothing ever piles up to
 * compact.
 */

import { kernelStateMessage } from "./kernel-messages";
import type {
	AgentMessage,
	RenderContext,
	RenderResult,
	SessionEvent,
	StateModule,
} from "./types";
import { applyWindow } from "./window";

/** Base state: bookkeeping only. The working picture is the transcript. */
export interface BaseState {
	kind: "base";
	turns: number;
	userMessages: number;
	toolCalls: number;
	toolErrors: number;
	/** seq of the last event folded in — the resume/debug marker. */
	lastEventSeq: number;
}

export function emptyBaseState(): BaseState {
	return {
		kind: "base",
		turns: 0,
		userMessages: 0,
		toolCalls: 0,
		toolErrors: 0,
		lastEventSeq: -1,
	};
}

/**
 * Build one synthetic kernel line. It ships to the provider as a plain user
 * message (Pi's convertToLlm does that for `role: "custom"`), but carries the
 * kernel marker so the turn view badges it KERNEL rather than USER.
 */
export function textMessage(text: string): AgentMessage {
	return kernelStateMessage(text);
}

/**
 * The default renderer: a rolling window over the conversation, emitted as
 * genuine messages, with at most one elision marker line in front of it.
 */
export function renderRollingWindow(ctx: RenderContext): RenderResult {
	const windowed = applyWindow(ctx.messages, ctx.window);
	const messages = windowed.elisionMarker
		? [textMessage(windowed.elisionMarker), ...windowed.messages]
		: windowed.messages;
	return {
		messages,
		// The marker is the rendered summary of what was cut — section ③'s
		// synthesized prefix. Everything after it is verbatim conversation.
		stateMessageCount: windowed.elisionMarker ? 1 : 0,
	};
}

export const baseStateModule: StateModule<BaseState> = {
	seed(_ctx, prior) {
		return prior ? { ...prior } : emptyBaseState();
	},

	update(state: BaseState, event: SessionEvent): BaseState {
		const next: BaseState = { ...state, lastEventSeq: event.seq };
		switch (event.kind) {
			case "user_message":
				next.userMessages += 1;
				break;
			case "tool_call":
				next.toolCalls += 1;
				break;
			case "tool_result":
				if (event.isError) next.toolErrors += 1;
				break;
			case "turn_end":
				next.turns = event.turnIndex + 1;
				break;
		}
		return next;
	},

	render(_state, ctx) {
		return renderRollingWindow(ctx);
	},
};
