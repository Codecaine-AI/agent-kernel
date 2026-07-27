import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
	groupTurnSections,
	parseSectionTags,
	type RequestSectionTag,
} from "./turn-sections";
import { dedent, highlightXmlish, looksLikeStateBlock } from "./state-block";
import { SnapshotContextBody } from "./RequestSnapshotRenderer";
import {
	CANVAS_STATE_BLOCK,
	canvasTurnContext,
	untaggedTurnContext,
} from "./__fixtures__/turn-snapshots";

const API_BASE = "http://localhost:4319";

function renderBody(context: typeof canvasTurnContext): string {
	return renderToStaticMarkup(
		createElement(SnapshotContextBody, {
			systemPrompt: context.system_prompt,
			messages: context.messages,
			sections: parseSectionTags(context.sections),
			apiBase: API_BASE,
		}),
	);
}

/** The opening tag of the element carrying data-turn-section="<id>". */
function sectionTag(markup: string, id: string): string | null {
	const match = new RegExp(`<[a-z]+[^>]*data-turn-section="${id}"[^>]*>`).exec(
		markup,
	);
	return match ? match[0] : null;
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

	test("renders the three-section turn view", () => {
		expect(markup).toContain('data-turn-view="sections"');
		expect(markup).not.toContain('data-turn-view="flat"');
		for (const id of ["system", "context", "state"]) {
			expect(sectionTag(markup, id)).not.toBeNull();
		}
		expect(markup).toContain("System prompt");
		expect(markup).toContain("Context");
		expect(markup).toContain("State");
		// Nothing fell outside the tags, so no untagged section.
		expect(sectionTag(markup, "untagged")).toBeNull();
	});

	test("headers are bare titles — no numerals, subtitles, or counts", () => {
		expect(markup).not.toContain("①");
		expect(markup).not.toContain("②");
		expect(markup).not.toContain("③");
		expect(markup).not.toContain("set once");
		expect(markup).not.toContain("rebuilt every request");
		expect(markup).not.toContain("the moving piece");
		expect(markup).not.toContain("outside every section tag");
	});

	test("③ state is expanded by default, ① and ② are collapsed", () => {
		expect(sectionTag(markup, "state")).toContain('data-state="open"');
		expect(sectionTag(markup, "system")).toContain('data-state="closed"');
		expect(sectionTag(markup, "context")).toContain('data-state="closed"');
	});

	test("every section has a collapse trigger reporting its state", () => {
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain("Expand System prompt");
		expect(markup).toContain("Collapse State");
	});

	test("collapsed sections keep their content mounted (forceMount)", () => {
		// ① is closed but its body is still in the DOM — the CSS collapsible
		// clips it, so nothing is lost to search/scroll restoration.
		expect(markup).toContain("You are the layout-editor");
		expect(markup).toContain("apply_operation · look · lint");
	});

	test("the state block is pretty-printed, not shown as a message card", () => {
		expect(markup).toContain('data-state-block=""');
		expect(markup).toContain("sec-auth");
		expect(markup).toContain("EDGES: login→mfa");
		// The board digest's indentation is load-bearing and survives verbatim,
		// inside a whitespace-preserving <pre>.
		expect(markup).toContain("\n      obj-login   rect ");
		expect(markup).toContain("whitespace-pre ");
		// Highlighting is applied to the tag syntax.
		expect(markup).toContain('class="text-syntax-key">state<');
		expect(markup).toContain('class="text-syntax-number">elements<');
		expect(markup).toContain("text-syntax-string");
		// Between the start of ③ and the tail divider there is only the state
		// block — the state message itself never renders as a message card.
		const stateHead = markup.slice(
			markup.indexOf('data-turn-section="state"'),
			markup.indexOf('data-turn-subsection="tail"'),
		);
		expect(stateHead).toContain('data-state-block=""');
		expect(stateHead).not.toContain("data-message-role=");
	});

	test("the tail is sub-grouped under ③ and renders as real messages", () => {
		expect(markup).toContain('data-turn-subsection="tail"');
		expect(markup).toContain("Recent messages");
		const tail = markup.slice(markup.indexOf('data-turn-subsection="tail"'));
		expect(tail).toContain('data-message-role="user"');
		expect(tail).toContain('data-message-role="assistant"');
		expect(tail).toContain('data-message-role="toolResult"');
		// Exactly the four tail messages render as message cards.
		expect(tail.match(/data-message-role=/g)!.length).toBe(4);
		// Plus the one ② context message — the state block is not a card.
		expect(markup.match(/data-message-role=/g)!.length).toBe(5);
	});

	test("the ② context message renders with its image blob", () => {
		expect(markup).toContain(`${API_BASE}/kernel/blobs/b1-house-style-exemplar`);
	});

	test("② and ③ are badged KERNEL, not USER — they are not what the user said", () => {
		// The kernel authors both as role "custom" with a kernel: customType,
		// which pi's convertToLlm turns into an ordinary user message on the
		// wire. The badge is the only place the difference shows.
		expect(markup).toContain('data-message-author="kernel"');
		expect(markup).toContain(">Kernel<");
		const contextSection = markup.slice(
			markup.indexOf('data-turn-section="context"'),
			markup.indexOf('data-turn-section="state"'),
		);
		expect(contextSection).toContain('data-message-author="kernel"');
		expect(contextSection).not.toContain(">User<");
		// The four USER/assistant/tool cards are all in the tail.
		const tail = markup.slice(markup.indexOf('data-turn-subsection="tail"'));
		expect(tail).not.toContain('data-message-author="kernel"');
	});
});

describe("SnapshotContextBody — snapshot without section tags", () => {
	const markup = renderBody(untaggedTurnContext);

	test("falls back to the flat context list", () => {
		expect(markup).toContain('data-turn-view="flat"');
		expect(markup).not.toContain('data-turn-view="sections"');
		expect(markup).not.toContain("data-turn-section");
		expect(markup).not.toContain('data-state-block=""');
	});

	test("still renders the system prompt and every message", () => {
		expect(markup).toContain("System prompt");
		expect(markup).toContain("You are a research assistant.");
		expect(markup).toContain("Context window");
		expect(markup.match(/data-message-role=/g)!.length).toBe(3);
	});
});
