import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	groupTurnSections,
	parseSectionTags,
	type RequestSectionTag,
} from "./turn-sections";
import { dedent, highlightXmlish, looksLikeStateBlock } from "./state-block";
import { DetailShell } from "../DetailShell";
import { buildSnapshotContextView } from "./TurnBody";
import {
	CANVAS_STATE_BLOCK,
	canvasTurnContext,
	untaggedTurnContext,
} from "./__fixtures__/turn-snapshots";

const API_BASE = "http://localhost:4319";
const RETIRED_CONTEXT_MEDIA_ID = ["turn:context", "images"].join("-");
const RETIRED_STATE_MEDIA_ID = ["turn:attached", "renders"].join("-");

const REALISTIC_SYSTEM_PROMPT = [
	"<purpose>",
	"    You are the full board editor for a shared whiteboard.",
	"</purpose>",
	"",
	"<board_model>",
	"    Every board keeps at least one section.",
	"</board_model>",
	"",
	"<state_grammar>",
	"    Read the state literally.",
	"</state_grammar>",
	"",
	"<workflow>",
	"    Read, plan, apply, and verify.",
	"</workflow>",
].join("\n");

function renderBody(context: typeof canvasTurnContext): string {
	const span: TraceSpan = {
		id: `turn-${context.turn_number}`,
		title: `Turn ${context.turn_number}`,
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:01.000Z"),
		duration: 1_000,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [
			{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
		],
	};
	return renderToStaticMarkup(
		<DetailShell
			span={span}
			view={buildSnapshotContextView({
			systemPrompt: context.system_prompt,
			messages: context.messages,
			sections: parseSectionTags(context.sections),
			apiBase: API_BASE,
			})}
		/>,
	);
}

/** The opening tag of the element carrying data-turn-section="<id>". */
function sectionTag(markup: string, id: string): string | null {
	const match = new RegExp(`<[a-z]+[^>]*data-turn-section="${id}"[^>]*>`).exec(
		markup,
	);
	return match ? match[0] : null;
}

function detailBlockIds(markup: string): string[] {
	return [...markup.matchAll(/data-detail-block="([^"]+)"/g)].map(
		([, id]) => id!,
	);
}

// ─── parseSectionTags ───────────────────────────────────────────────────────

describe("parseSectionTags", () => {
	test("accepts the tags on a section-tagged snapshot", () => {
		expect(parseSectionTags(canvasTurnContext.sections)).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
			{ kind: "tail", start: 2, end: 6 },
		]);
	});

	test("returns null for a snapshot without tags (flat fallback)", () => {
		expect(untaggedTurnContext.sections).toBeUndefined();
		expect(parseSectionTags(untaggedTurnContext.sections)).toBeNull();
		expect(parseSectionTags(undefined)).toBeNull();
		expect(parseSectionTags(null)).toBeNull();
		expect(parseSectionTags([])).toBeNull();
	});

	test("parses the JSON-string form used by the span attribute", () => {
		expect(
			parseSectionTags('[{"kind":"state","start":0,"end":2}]'),
		).toEqual([{ kind: "state", start: 0, end: 2 }]);
		expect(parseSectionTags("not json")).toBeNull();
	});

	test("rejects malformed tags rather than half-grouping", () => {
		expect(parseSectionTags([{ kind: "system", start: 0, end: 1 }])).toBeNull();
		expect(parseSectionTags([{ kind: "state", start: 0.5, end: 1 }])).toBeNull();
		expect(parseSectionTags([{ kind: "state", start: -1, end: 1 }])).toBeNull();
		expect(parseSectionTags([{ start: 0, end: 1 }])).toBeNull();
		expect(parseSectionTags(["state"])).toBeNull();
		expect(parseSectionTags({ kind: "state", start: 0, end: 1 })).toBeNull();
	});

	test("drops empty ranges but keeps the rest", () => {
		expect(
			parseSectionTags([
				{ kind: "context", start: 0, end: 0 },
				{ kind: "state", start: 0, end: 3 },
			]),
		).toEqual([{ kind: "state", start: 0, end: 3 }]);
		expect(parseSectionTags([{ kind: "context", start: 2, end: 2 }])).toBeNull();
	});
});

// ─── groupTurnSections ──────────────────────────────────────────────────────

describe("groupTurnSections", () => {
	const messages = ["m0", "m1", "m2", "m3", "m4", "m5"];

	test("buckets the canvas snapshot into ② context, ③ state and its tail", () => {
		const model = groupTurnSections(
			canvasTurnContext.messages,
			parseSectionTags(canvasTurnContext.sections)!,
		);
		expect(model.context.map((e) => e.index)).toEqual([0]);
		expect(model.state.map((e) => e.index)).toEqual([1]);
		expect(model.tail.map((e) => e.index)).toEqual([2, 3, 4, 5]);
		expect(model.untagged).toEqual([]);
		expect(model.state[0]!.message.customType).toBe("kernel:state");
	});

	test("messages no tag covers land in untagged, never dropped", () => {
		const model = groupTurnSections(messages, [
			{ kind: "context", start: 0, end: 1 },
			{ kind: "tail", start: 4, end: 6 },
		]);
		expect(model.context.map((e) => e.message)).toEqual(["m0"]);
		expect(model.tail.map((e) => e.message)).toEqual(["m4", "m5"]);
		expect(model.untagged.map((e) => e.message)).toEqual(["m1", "m2", "m3"]);
		const total =
			model.context.length +
			model.state.length +
			model.tail.length +
			model.untagged.length;
		expect(total).toBe(messages.length);
	});

	test("ranges are clamped to the message list", () => {
		const model = groupTurnSections(messages, [
			{ kind: "state", start: 4, end: 99 },
		]);
		expect(model.state.map((e) => e.index)).toEqual([4, 5]);
	});

	test("overlapping tags assign each message once, earliest tag wins", () => {
		const tags: RequestSectionTag[] = [
			{ kind: "tail", start: 2, end: 6 },
			{ kind: "state", start: 1, end: 4 },
		];
		const model = groupTurnSections(messages, tags);
		expect(model.state.map((e) => e.index)).toEqual([1, 2, 3]);
		expect(model.tail.map((e) => e.index)).toEqual([4, 5]);
	});

	test("bucket order follows context order", () => {
		const model = groupTurnSections(messages, [
			{ kind: "tail", start: 3, end: 4 },
			{ kind: "tail", start: 0, end: 1 },
		]);
		expect(model.tail.map((e) => e.index)).toEqual([0, 3]);
	});
});

// ─── state block printing ───────────────────────────────────────────────────

describe("state block printing", () => {
	test("looksLikeStateBlock only matches a rendered <state> block", () => {
		expect(looksLikeStateBlock(CANVAS_STATE_BLOCK)).toBe(true);
		expect(looksLikeStateBlock('\n  <state v="2">x</state>')).toBe(true);
		expect(looksLikeStateBlock("<board>x</board>")).toBe(false);
		expect(looksLikeStateBlock("make the retry path clearer")).toBe(false);
	});

	test("dedent strips the outer indent and keeps relative indentation", () => {
		const out = dedent("\n    <state>\n      <board>\n        x\n      </board>\n    </state>\n");
		expect(out).toBe("<state>\n  <board>\n    x\n  </board>\n</state>");
	});

	test("highlightXmlish reproduces the input exactly", () => {
		const segments = highlightXmlish(CANVAS_STATE_BLOCK);
		expect(segments.map((s) => s.value).join("")).toBe(CANVAS_STATE_BLOCK);
	});

	test("tag names, attribute names and values are classified", () => {
		const segments = highlightXmlish('<state v="21">\n  ok\n</state>');
		expect(segments).toEqual([
			{ type: "punct", value: "<" },
			{ type: "tagName", value: "state" },
			{ type: "punct", value: " " },
			{ type: "attrName", value: "v" },
			{ type: "punct", value: "=" },
			{ type: "attrValue", value: '"21"' },
			{ type: "punct", value: ">" },
			{ type: "text", value: "\n  ok\n" },
			{ type: "punct", value: "</" },
			{ type: "tagName", value: "state" },
			{ type: "punct", value: ">" },
		]);
	});

	test("board digest arrows and free text stay plain text", () => {
		const segments = highlightXmlish("EDGES: login→mfa \"success\"");
		expect(segments).toEqual([
			{ type: "text", value: 'EDGES: login→mfa "success"' },
		]);
	});
});

// ─── rendering ──────────────────────────────────────────────────────────────

describe("SnapshotContextBody — section-tagged snapshot", () => {
	const markup = renderBody(canvasTurnContext);

	test("renders every block in tab order, renders embedded in the figure", () => {
		const orderedMarkup = renderBody({
			...canvasTurnContext,
			message_count: 7,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 1, end: 3 },
				{ kind: "tail", start: 3, end: 7 },
			],
			messages: [
				...canvasTurnContext.messages.slice(0, 2),
				{
					role: "custom",
					customType: "kernel:state",
					content: [
						{ type: "text", text: "close-up sec-auth@t6" },
						{
							type: "image",
							blob_hash: "b1-state-close-up",
							mimeType: "image/png",
						},
					],
				},
				...canvasTurnContext.messages.slice(2),
			],
		});

		// The extra state message carries images, so it is embedded INSIDE the
		// state figure as an inline row rather than becoming a block of its own.
		// The fixture predates tool capture, so section ④ is the honest
		// never-captured notice rather than a roster.
		expect(detailBlockIds(orderedMarkup)).toEqual([
			"turn:state",
			"turn:recent-messages",
			"turn:context",
			"turn:system",
			"turn:tools-not-captured",
		]);
		expect(orderedMarkup).toContain('data-doc-inline-row=""');
		expect(orderedMarkup).toContain("b1-state-close-up");
		expect(orderedMarkup).not.toContain(RETIRED_CONTEXT_MEDIA_ID);
		expect(orderedMarkup).not.toContain(RETIRED_STATE_MEDIA_ID);
	});

	test("renders the exact four-tab Turn view with State active", () => {
		expect(markup).toContain('data-turn-view="sections"');
		expect(markup).not.toContain('data-turn-view="flat"');
		expect(
			[...markup.matchAll(/data-detail-tab-trigger="([^"]+)"/g)].map(
				([, id]) => id,
			),
		).toEqual(["state", "context", "system", "tools"]);
		expect(
			[...markup.matchAll(/data-detail-tab="([^"]+)"/g)].map(([, id]) => id),
		).toEqual(["state", "context", "system", "tools"]);
		expect(markup).toContain('data-detail-active-tab="state"');
		expect(markup).toMatch(
			/data-detail-tab-trigger="state"[^>]*aria-selected="true"[^>]*>State<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="context"[^>]*>Context<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="system"[^>]*>System prompt<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="tools"[^>]*>Tools<\/button>/,
		);
		for (const id of ["system", "context", "state"]) {
			expect(sectionTag(markup, id)).not.toBeNull();
		}
		// The fixture carries no roster, so section ④ is a notice — never a
		// marked section.
		expect(sectionTag(markup, "tools")).toBeNull();
		expect(markup).toContain("System prompt");
		expect(markup).toContain("Context");
		expect(markup).toContain("State");
		// Nothing fell outside the tags, so no untagged section.
		expect(sectionTag(markup, "untagged")).toBeNull();
		expect(markup).not.toContain(RETIRED_CONTEXT_MEDIA_ID);
		expect(markup).not.toContain(RETIRED_STATE_MEDIA_ID);
	});

	test("captions are bare titles — no numerals or explainer prose", () => {
		expect(markup).not.toContain("①");
		expect(markup).not.toContain("②");
		expect(markup).not.toContain("③");
		expect(markup).not.toContain("set once");
		expect(markup).not.toContain("rebuilt every request");
		expect(markup).not.toContain("the moving piece");
		expect(markup).not.toContain("outside every section tag");
	});

	test("all three section sources remain mounted in standard blocks", () => {
		expect(markup).toContain("You are the layout-editor");
		expect(markup).toContain("apply_operation · look · lint");
		for (const id of ["turn:system", "turn:context", "turn:state"]) {
			expect(markup).toContain(`data-detail-block="${id}"`);
			expect(markup).toContain('data-detail-slot="content"');
		}
	});

	test("the real tagged prompt, image-bearing context, and State share source gutters", () => {
		const block = (id: string) => {
			const start = markup.indexOf(`data-detail-block="${id}"`);
			return markup.slice(start, markup.indexOf("</section>", start));
		};
		const system = block("turn:system");
		const context = block("turn:context");
		const state = block("turn:state");

		expect(system).toContain("data-doc-line-number");
		expect(context).toContain("data-doc-line-number");
		expect(context).toContain("data-turn-thumbnails");
		expect(context.indexOf("apply_operation · look · lint")).toBeLessThan(
			context.indexOf("data-turn-thumbnails"),
		);
		expect(state).toContain("data-doc-line-number");
	});

	test("tabs replace the old nested disclosures while all panels remain mounted", () => {
		expect(markup).not.toContain("data-block-open");
		expect(markup).not.toContain('aria-label="Expand System prompt"');
		expect(markup).not.toContain('aria-label="Expand Context"');
		expect(markup).not.toContain('aria-label="Collapse State"');
		expect(markup).not.toContain('aria-label="Expand Recent messages"');
		expect(markup).toContain("You are the layout-editor");
		expect(markup).toContain("apply_operation · look · lint");
		expect(markup).toContain("make the retry path clearer");
	});

	test("the shell preserves prompt language and syntax classes for the real prompt shape", () => {
		const realisticMarkup = renderBody({
			...canvasTurnContext,
			system_prompt: REALISTIC_SYSTEM_PROMPT,
		});
		const start = realisticMarkup.indexOf(
			'data-detail-block="turn:system"',
		);
		const end = realisticMarkup.indexOf("</section>", start);
		const promptBlock = realisticMarkup.slice(start, end);

		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		expect(promptBlock).toContain('data-doc-language="prompt"');
		expect(promptBlock).toContain("prompt-editor-surface");
		expect(promptBlock).toContain("prompt-editor-syntax-tag");
		expect(promptBlock).toContain(">purpose</span>");
		expect(promptBlock).toContain(">board_model</span>");
		expect(promptBlock).toContain(">state_grammar</span>");
		expect(promptBlock).toContain(">workflow</span>");
	});

	test("the state block is tokenized as XML, not shown as a message card", () => {
		expect(markup).toContain('data-detail-block="turn:state"');
		expect(markup).toContain("sec-auth");
		expect(markup).toContain("EDGES: login→mfa");
		// The board digest's indentation is load-bearing and survives verbatim
		// inside whitespace-preserving source cells.
		expect(markup).toContain("      obj-login   rect ");
		// Highlighting is applied to the tag syntax.
		expect(markup).toContain("text-syntax-key");
		expect(markup).toContain("text-syntax-number");
		expect(markup).toContain("text-syntax-string");
		const stateStart = markup.indexOf('data-detail-block="turn:state"');
		const stateBlock = markup.slice(
			stateStart,
			markup.indexOf("</section>", stateStart),
		);
		expect(stateBlock).not.toContain('data-message-role="custom"');
	});

	test("the tail follows the state block and renders as real messages", () => {
		expect(markup).toContain('data-turn-subsection="tail"');
		// No wrapper figure around the stream — the cards float on the surface.
		expect(markup).not.toContain("Recent messages");
		expect(markup).toContain('data-detail-block-bare=""');
		const tail = markup.slice(
			markup.indexOf('data-turn-subsection="tail"'),
			markup.indexOf('data-detail-tab="context"'),
		);
		expect(tail).toContain('data-message-role="user"');
		expect(tail).toContain('data-message-role="assistant"');
		expect(tail).toContain('data-message-role="toolResult"');
		// Exactly the four tail messages render as conversational rows.
		expect(tail.match(/data-message-role=/g)!.length).toBe(4);
		expect(markup.indexOf('data-detail-block="turn:state"')).toBeLessThan(
			markup.indexOf('data-detail-block="turn:recent-messages"'),
		);
	});

	test("the ② context message renders both images in content-block order", () => {
		const contextPanel = markup.slice(
			markup.indexOf('data-detail-tab="context"'),
			markup.indexOf('data-detail-tab="system"'),
		);
		const contextText = contextPanel.indexOf("apply_operation · look · lint");
		const exemplar = contextPanel.indexOf(
			`${API_BASE}/kernel/blobs/b1-house-style-exemplar`,
		);
		const contactSheet = contextPanel.indexOf(
			`${API_BASE}/kernel/blobs/b1-board-contact-sheet`,
		);
		expect(contextText).toBeGreaterThan(-1);
		expect(exemplar).toBeGreaterThan(contextText);
		expect(contactSheet).toBeGreaterThan(exemplar);
		expect(contextPanel).toContain("data-turn-thumbnails");
		expect(contextPanel).not.toContain(RETIRED_CONTEXT_MEDIA_ID);
	});

	test("② and the rendered-state range are documents, not USER conversation", () => {
		const contextSection = markup.slice(
			markup.indexOf('data-detail-tab="context"'),
			markup.indexOf('data-detail-tab="system"'),
		);
		expect(contextSection).not.toContain(">User<");
		expect(contextSection).toContain(">Kernel<");
		// The actual conversation badges are confined to the tail block.
		const tail = markup.slice(markup.indexOf('data-turn-subsection="tail"'));
		expect(tail).toContain(">User<");
	});
});

describe("SnapshotContextBody — snapshot without section tags", () => {
	const markup = renderBody(untaggedTurnContext);

	test("falls back to the flat context list", () => {
		expect(markup).toContain('data-turn-view="flat"');
		expect(markup).not.toContain('data-turn-view="sections"');
		expect(markup).not.toContain("data-turn-section");
		expect(markup).not.toContain('data-detail-block="turn:state"');
		expect(markup).toContain('data-detail-block="turn:state-unavailable"');
		expect(markup).toContain('data-detail-active-tab="state"');
		expect(
			[...markup.matchAll(/data-detail-tab-trigger="([^"]+)"/g)].map(
				([, id]) => id,
			),
		).toEqual(["state", "context", "system", "tools"]);
		// A flat snapshot predates section tags AND tool capture; the Tools tab
		// says the latter outright instead of standing empty.
		expect(markup).toContain('data-detail-block="turn:tools-not-captured"');
	});

	test("still renders the system prompt and every message", () => {
		expect(markup).toContain("System prompt");
		expect(markup).toContain("You are a research assistant.");
		expect(markup).not.toContain("data-block-open");
		expect(markup).toContain("Context window");
		expect(markup.match(/data-message-role=/g)!.length).toBe(3);
	});
});
