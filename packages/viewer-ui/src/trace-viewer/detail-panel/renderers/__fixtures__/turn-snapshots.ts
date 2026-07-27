/**
 * Fixture turn-context responses for the request-snapshot renderers.
 *
 * `canvasTurnContext` is the section-tagged case, shaped after the canvas
 * layout-editor example in state-shapes.html §5: one rebuilt ② context
 * message, a ③ <state> block in the board digest grammar, and a four-message
 * tail of real conversation.
 *
 * `untaggedTurnContext` is a snapshot from before the builder emitted section
 * tags — it must keep rendering as the flat context list.
 */
import type { RunTurnContextResponse } from "../request-snapshot-api";

export const CANVAS_SYSTEM_PROMPT = `<system>
  <role>You are the layout-editor. You edit a canvas board through operations.</role>
  <method>
    Read the board digest, decide the smallest operation that advances the
    open request, apply it, then re-read.
  </method>
  <constraints>Never invent element ids. Never move outside the scope frame.</constraints>
</system>`;

export const CANVAS_CONTEXT_MESSAGE = `<context>
  <capabilities>
    apply_operation · look · lint · connect · align-row · recolor
  </capabilities>
  <style_guide>
    Rectangles for steps, diamonds for decisions, edges labelled with the
    condition that takes them.
  </style_guide>
</context>`;

export const CANVAS_STATE_BLOCK = `<state v="21">
  <board elements="34">
    # indent = containment · id type "text" [color] x,y w×h
    sec-auth    section "Auth flow"   40,40  720×360
      obj-login   rect "Login"        120,80 140×60
      obj-mfa     rect "MFA check"    320,80 140×60 [blue]
      obj-token   rect "Issue token"  520,80 140×60
    EDGES: login→mfa "success" · mfa→token · token→refresh [dashed]
  </board>
  <ops total="12" showing="4">
    t5 move obj-login → 120,80 · t6 connect mfa→token
    t7 align-row ×3 · t8 recolor obj-mfa blue
  </ops>
  <lints>0 errors · 0 warnings (was 2)</lints>
  <requests open="1">"make the retry path clearer"</requests>
  <views>full board (fresh) + close-up sec-auth@t6 attached</views>
</state>`;

/** Section-tagged snapshot — the three-section turn view. */
export const canvasTurnContext: RunTurnContextResponse = {
	run_id: "run_canvas_01",
	turn_number: 9,
	prompt_hash: "pk1-3f9ac2",
	system_prompt: CANVAS_SYSTEM_PROMPT,
	message_count: 6,
	sections: [
		{ kind: "context", start: 0, end: 1 },
		{ kind: "state", start: 1, end: 2 },
		{ kind: "tail", start: 2, end: 6 },
	],
	messages: [
		{
			role: "custom",
			customType: "kernel:context",
			content: [
				{ type: "text", text: CANVAS_CONTEXT_MESSAGE },
				{
					type: "image",
					blob_hash: "b1-house-style-exemplar",
					mimeType: "image/png",
					byte_length: 40_112,
				},
			],
		},
		{
			role: "custom",
			customType: "kernel:state",
			content: [{ type: "text", text: CANVAS_STATE_BLOCK }],
		},
		{
			role: "user",
			content: [{ type: "text", text: "make the retry path clearer" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "The retry edge is unlabelled — label it." },
				{
					type: "toolCall",
					id: "call_1",
					name: "apply_operation",
					arguments: { op: "connect", from: "obj-token", to: "obj-refresh", label: "retry" },
				},
			],
		},
		{
			role: "toolResult",
			toolName: "apply_operation",
			content: [{ type: "text", text: "applied: connect obj-token→obj-refresh \"retry\"" }],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Labelled the retry edge. Lints still clean." }],
		},
	],
};

/** Pre-section-tags snapshot — flat rendering, unchanged. */
export const untaggedTurnContext: RunTurnContextResponse = {
	run_id: "run_plain_01",
	turn_number: 3,
	prompt_hash: null,
	system_prompt: "You are a research assistant.",
	message_count: 3,
	messages: [
		{ role: "user", content: [{ type: "text", text: "Summarize the findings." }] },
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call_a", name: "search", arguments: { q: "findings" } },
			],
		},
		{
			role: "toolResult",
			toolName: "search",
			content: [{ type: "text", text: "3 results" }],
		},
	],
};
