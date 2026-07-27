/**
 * builder.ts — three-section request assembly + section boundaries.
 *
 * The request is ① system prompt (Pi's, untouched, captured separately) · ②
 * one context message rendered from the L2 set · ③ render(state). This module
 * owns only ② and ③ — it concatenates them and reports where each section
 * begins and ends so the per-turn recorder can tag the snapshot and the viewer
 * can render the exact window the model ran on, structurally.
 *
 * Boundaries are half-open [start, end) indices into the returned message
 * list. Empty sections are omitted rather than emitted as zero-length ranges.
 */

import type {
	AgentMessage,
	BuiltRequest,
	RenderOutput,
	RenderResult,
	RequestSection,
} from "./types";

/** Normalize the two accepted `render` return shapes into one. */
export function normalizeRenderOutput(output: RenderOutput): RenderResult {
	if (Array.isArray(output)) return { messages: output, stateMessageCount: 0 };
	const count = output.stateMessageCount ?? 0;
	return {
		messages: output.messages ?? [],
		stateMessageCount: Math.max(
			0,
			Math.min(Math.floor(count), (output.messages ?? []).length),
		),
	};
}

export interface BuildRequestInput {
	/** Section ② — null when the L2 set is empty. */
	contextMessage: AgentMessage | null;
	/** Section ③ — whatever `render` returned. */
	rendered: RenderOutput;
}

export function buildRequest(input: BuildRequestInput): BuiltRequest {
	const rendered = normalizeRenderOutput(input.rendered);
	const messages: AgentMessage[] = [];
	const sections: RequestSection[] = [];

	if (input.contextMessage) {
		messages.push(input.contextMessage);
		sections.push({ kind: "context", start: 0, end: 1 });
	}

	const stateStart = messages.length;
	const stateCount = rendered.stateMessageCount ?? 0;
	messages.push(...rendered.messages);
	if (stateCount > 0) {
		sections.push({
			kind: "state",
			start: stateStart,
			end: stateStart + stateCount,
		});
	}
	const tailStart = stateStart + stateCount;
	if (messages.length > tailStart) {
		sections.push({ kind: "tail", start: tailStart, end: messages.length });
	}

	return { messages, sections };
}
