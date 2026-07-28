/**
 * state-tab-postures.test — the State tab's ONE posture.
 *
 * Round 2 of state-tab-options.html agreed postures 1 and 2. Ford's 2026-07-28
 * review then cut BOTH of posture 2's ingredients: first the index rail, then
 * the focus posture itself ("I don't really love this focus state. I'm trying
 * to have things render more in line"). What remains is the subtabbed resting
 * surface — State | Messages, exactly one visible at a time — and the state as
 * ONE CONTINUOUS FIGURE with its attached renders embedded inline at <views>.
 *
 * There must be no focus trigger, no breadcrumb, no raw-slice affordance and no
 * posture attribute anywhere. Posture 3, the ⫿ split, was deferred and likewise
 * must not appear.
 *
 * The interaction rule is asserted as a pure function — this package has no DOM
 * test environment — and the surface through SSR of the real canvas turn 4
 * capture, read only.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailShellFrame, shouldCloseDetailsOnEscape } from "./DetailShell";
import { partitionZoneBlocks } from "./DetailStream";
import { resolveEscapeLayer } from "./escape";
import { buildSnapshotContextView } from "./renderers/TurnBody";
import type {
	RunTurnContextResponse,
	SanitizedMessage,
} from "./renderers/request-snapshot-api";
import { parseStateOutline, sliceLines } from "./renderers/state-outline";
import {
	PRIMARY_FIGURE_CLAMP,
	withPrimaryFigurePolicy,
} from "./renderers/primary-figure";
import { CLAMP } from "./doc-figure/clamp";
import { parseSectionTags } from "./renderers/turn-sections";

const TRACE_DB_PATH = resolve(
	import.meta.dir,
	"../../../../../../canvas/.agent-kernel/trace.db",
);
const CONTAINER_ID = "f172afdc-b39e-5d9d-b62a-729f8e29b2af";
const SESSION_ID = "019fa4f0-b02d-7f54-b007-5a4887e22543";
const TURN_EVENT_ID = "89e7644e-4923-4c62-b9c6-6eb699d827d1";
const API_BASE = "http://localhost:4319";
const hasCapture = existsSync(TRACE_DB_PATH);

// ─── Interaction contract (R2.2), asserted as pure rules ────────────────────

describe("Escape precedence — modal → Details, one layer per press", () => {
	test("resolves exactly one layer for every combination", () => {
		const layer = (m: boolean, d: boolean) =>
			resolveEscapeLayer({ modalOpen: m, detailsOpen: d });

		expect(layer(false, false)).toBeNull();
		expect(layer(false, true)).toBe("details");
		expect(layer(true, false)).toBe("modal");
		expect(layer(true, true)).toBe("modal");
	});

	test("a modal above Details takes two presses, in order", () => {
		let state = { modalOpen: true, detailsOpen: true };
		const press = () => {
			const layer = resolveEscapeLayer(state);
			if (layer === "modal") state = { ...state, modalOpen: false };
			if (layer === "details") state = { ...state, detailsOpen: false };
			return layer;
		};
		expect([press(), press(), press()]).toEqual(["modal", "details", null]);
	});

	test("the agreed §0 rule reads off the same ladder", () => {
		expect(shouldCloseDetailsOnEscape(true, false)).toBe(true);
		expect(shouldCloseDetailsOnEscape(true, true)).toBe(false);
		expect(shouldCloseDetailsOnEscape(false, false)).toBe(false);
	});

	test("focus is gone from the ladder entirely", () => {
		// The layer union itself is the pin: adding a focus layer back would
		// have to change this type, and this file, deliberately.
		const layers: Array<ReturnType<typeof resolveEscapeLayer>> = [
			"modal",
			"details",
			null,
		];
		expect(layers).toHaveLength(3);
	});
});

describe("surfaces — one at a time, and the pieces they own", () => {
	const BLOCKS = [
		{ id: "turn:state", slot: "content" as const, caption: "State", body: "s" },
		{
			id: "turn:recent-messages",
			slot: "content" as const,
			caption: "Messages",
			body: "m",
		},
		{ id: "turn:response", slot: "output" as const, caption: "Response", body: "r" },
	];
	const ZONES = [
		{ id: "state", name: "State", blockIds: ["turn:state"] },
		{ id: "messages", name: "Messages", blockIds: ["turn:recent-messages"] },
	];

	test("blocks no surface names still render, after the surfaces", () => {
		const { zoned, rest } = partitionZoneBlocks(BLOCKS, ZONES);
		expect(zoned.map((entry) => entry.blocks.map((block) => block.id))).toEqual([
			["turn:state"],
			["turn:recent-messages"],
		]);
		expect(rest.map((block) => block.id)).toEqual(["turn:response"]);
	});
});

// ─── SSR against the real canvas turn 4 ─────────────────────────────────────

interface Snapshot {
	turn_number: number;
	system_prompt_blob_hash: string | null;
	prompt_hash: string | null;
	message_count: number;
	message_refs: Array<{ blob_hash: string; index: number }>;
	sections: RunTurnContextResponse["sections"];
}

function realTurn(): RunTurnContextResponse {
	const db = new Database(TRACE_DB_PATH, { readonly: true });
	try {
		const row = db
			.query<
				{ event_data: string; run_id: string | null },
				[string, string, string]
			>(
				"select event_data, run_id from trace_events where event_id = ? and container_id = ? and pi_session_id = ?",
			)
			.get(TURN_EVENT_ID, CONTAINER_ID, SESSION_ID);
		if (!row) throw new Error("The reviewed turn event is absent");
		const snapshot = JSON.parse(row.event_data) as Snapshot;
		const blobQuery = db.query<{ data: unknown }, [string]>(
			"select data from trace_blobs where hash = ?",
		);
		const text = (hash: string): string => {
			const blob = blobQuery.get(hash);
			if (!blob) throw new Error(`Reviewed blob ${hash} is absent`);
			return typeof blob.data === "string"
				? blob.data
				: new TextDecoder().decode(blob.data as Uint8Array);
		};
		const messages = [...snapshot.message_refs]
			.sort((left, right) => left.index - right.index)
			.map(({ blob_hash }) => JSON.parse(text(blob_hash)) as SanitizedMessage);
		return {
			run_id: row.run_id ?? "",
			turn_number: snapshot.turn_number,
			prompt_hash: snapshot.prompt_hash,
			system_prompt: snapshot.system_prompt_blob_hash
				? text(snapshot.system_prompt_blob_hash)
				: null,
			message_count: snapshot.message_count,
			messages,
			sections: snapshot.sections,
		};
	} finally {
		db.close();
	}
}

const SPAN: TraceSpan = {
	id: TURN_EVENT_ID,
	title: "Turn 4",
	startTime: new Date("2026-07-27T18:58:15.994Z"),
	endTime: new Date("2026-07-27T18:58:15.994Z"),
	duration: 0,
	type: "event",
	raw: "{}",
	status: "success",
	attributes: [
		{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
	],
};

function render(
	context: RunTurnContextResponse,
	options: { surface?: string } = {},
): string {
	return renderToStaticMarkup(
		<DetailShellFrame
			span={SPAN}
			view={buildSnapshotContextView({
				systemPrompt: context.system_prompt,
				messages: context.messages,
				sections: parseSectionTags(context.sections),
				apiBase: API_BASE,
			})}
			onOpenModal={() => {}}
			{...(options.surface === undefined ? {} : { initialZoneId: options.surface })}
		/>,
	);
}

function decode(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&");
}

function element(markup: string, opening: string): string {
	const start = markup.indexOf(opening);
	if (start < 0) throw new Error(`${opening} was not rendered`);
	const tagStart = markup.lastIndexOf("<", start);
	const tag = /^<([a-z]+)/.exec(markup.slice(tagStart))![1]!;
	let depth = 0;
	const tokens = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
	tokens.lastIndex = tagStart;
	let token: RegExpExecArray | null;
	while ((token = tokens.exec(markup))) {
		if (token[0].startsWith("</")) {
			depth -= 1;
			if (depth === 0) return markup.slice(tagStart, tokens.lastIndex);
		} else if (!token[0].endsWith("/>")) {
			depth += 1;
		}
	}
	throw new Error(`${opening} was not closed`);
}

function blockSource(markup: string, id: string): string {
	const block = element(markup, `data-detail-block="${id}"`);
	const lines = [...block.matchAll(/<[^>]*data-doc-source-line=""[^>]*>/g)].map(
		(match) => decode(element(block.slice(match.index), match[0])),
	);
	if (lines.length === 0) throw new Error(`${id} rendered no source lines`);
	return lines.join("\n");
}

function attributeOf(markup: string, name: string): string | null {
	return new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1] ?? null;
}

function statePanel(markup: string): string {
	return markup.slice(
		markup.indexOf('data-detail-tab="state"'),
		markup.indexOf('data-detail-tab="context"'),
	);
}

function surfaces(markup: string): Array<{ id: string; hidden: boolean }> {
	return [
		...markup.matchAll(/<section[^>]*data-detail-zone="([a-z]+)"([^>]*)>/g),
	].map(([, id, rest]) => ({ id: id!, hidden: /\bhidden\b/.test(rest!) }));
}

describe.skipIf(!hasCapture)("the resting surface — State | Messages subtabs", () => {
	test("State and Messages are subtabs — exactly one surface at a time", () => {
		const markup = statePanel(render(realTurn()));
		expect(markup).not.toContain("data-detail-posture");
		expect(markup).not.toContain("data-detail-focus");
		expect(markup).not.toContain("data-detail-crumb");
		expect(markup).not.toContain("data-detail-raw-slice");

		const triggers = [
			...markup.matchAll(
				/<button[^>]*data-detail-subtab-trigger="([^"]+)"[^>]*aria-selected="(true|false)"/g,
			),
		].map(([, id, selected]) => [id, selected]);
		expect(triggers).toEqual([
			["state", "true"],
			["messages", "false"],
		]);
		expect(surfaces(markup)).toEqual([
			{ id: "state", hidden: false },
			{ id: "messages", hidden: true },
		]);

		// The label is the whole subtab: no counts on the trigger, and no meta
		// line under the row (both cut on review).
		expect(markup).not.toContain("data-detail-zone-meta");
		expect(decode(element(markup, 'data-detail-subtab-trigger="state"'))).toBe(
			"State",
		);
		expect(
			decode(element(markup, 'data-detail-subtab-trigger="messages"')),
		).toBe("Messages");
	});

	test("the Messages subtab shows the message stream instead", () => {
		const markup = statePanel(render(realTurn(), { surface: "messages" }));
		expect(surfaces(markup)).toEqual([
			{ id: "state", hidden: true },
			{ id: "messages", hidden: false },
		]);
		expect(markup).not.toContain("data-detail-zone-meta");
		expect(markup).toMatch(
			/data-detail-subtab-trigger="messages"[^>]*aria-selected="true"/,
		);
	});

	test("there is no index rail and no scroll-spy — Ford cut both", () => {
		const markup = statePanel(render(realTurn()));
		expect(markup).not.toContain("data-detail-rail");
		expect(markup).not.toContain("aria-current");
		// Posture 3 is deferred, not built.
		expect(markup).not.toContain("Split");
		expect(markup).not.toContain("data-detail-lane");
	});

	test("no piece offers a Focus affordance — the mechanism is gone", () => {
		const state = statePanel(render(realTurn()));
		expect(state).not.toContain("data-detail-focus-trigger");
		expect(decode(state)).not.toContain("Focus State");
		expect(decode(state)).not.toContain("Focus Attached renders");
		// The caption row keeps the modal ⤢, which is now the only escape hatch.
		const caption = element(state, 'data-doc-caption-tier="top"');
		expect(caption).toContain("data-detail-modal-trigger");
	});

	test("the state is ONE figure whose source still reconstructs the payload", () => {
		const context = realTurn();
		const payload = (
			context.messages[1]!.content as Array<{ text: string }>
		)[0]!.text;
		const markup = statePanel(render(context));

		// One block, undivided: the head/tail split and the separate renders card
		// are both gone.
		expect(markup).toContain('data-detail-block="turn:state"');
		expect(markup).not.toContain('data-detail-block="turn:state:continued"');
		expect(markup).not.toContain('data-detail-block="turn:state-message:2"');
		expect(decode(markup)).not.toContain("State · continued");

		// Byte-exact: every line of the payload is in the one figure, in order.
		expect(blockSource(markup, "turn:state")).toBe(payload);
	});

	test("the state is a scroll WINDOW, not a clamped preview", () => {
		const context = realTurn();
		const payload = (
			context.messages[1]!.content as Array<{ text: string }>
		)[0]!.text;
		const state = element(
			statePanel(render(context)),
			'data-detail-block="turn:state"',
		);

		// Every line is on the page — no preview, no fade, nothing withheld.
		expect(attributeOf(state, "data-detail-clamp")).toBe("scroll");
		expect(state).not.toContain("data-clamped");
		expect(state).not.toContain("to-background/95");
		expect(
			[...state.matchAll(/data-doc-line-number=""/g)],
		).toHaveLength(payload.split("\n").length);

		// It is bounded into its own reading window instead, and that window is
		// the element that already scrolls horizontally, so both scrollbars sit
		// on its edges.
		const body = element(state, 'data-doc-scroll=""');
		expect(body).toContain("overflow-x-auto");
		expect(body).toContain("overflow-y-auto");
		expect(body).toContain("max-height:min(70vh, 900px)");

		// And the caption keeps the ⤢ modal, which opens it unbounded.
		expect(state).toContain("data-detail-modal-trigger");
		expect(state).toContain('aria-label="Expand State"');
	});

	test("the attached renders sit INSIDE the figure at the <views> line", () => {
		const context = realTurn();
		const payload = (
			context.messages[1]!.content as Array<{ text: string }>
		)[0]!.text;
		const outline = parseStateOutline(payload)!;
		const views = outline.blocks.find((block) => block.tag === "views")!;
		const state = element(
			statePanel(render(context)),
			'data-detail-block="turn:state"',
		);

		// The row is a row of the document's own table, not a sibling card.
		const inlineAt = state.indexOf('data-doc-inline-row=""');
		expect(inlineAt).toBeGreaterThan(-1);
		expect(state.indexOf("data-turn-thumbnails")).toBeGreaterThan(inlineAt);
		expect(state.indexOf("data-doc-figure", inlineAt)).toBe(-1);

		// It follows the last <views> line and precedes the line after it, so the
		// images read at their reference point inside the payload.
		const lineCells = [
			...state.matchAll(/<[^>]*data-doc-source-line=""[^>]*>/g),
		].map((match) => match.index!);
		expect(lineCells[views.endLine - 1]!).toBeLessThan(inlineAt);
		expect(lineCells[views.endLine]!).toBeGreaterThan(inlineAt);
		expect(
			decode(element(state, 'data-doc-inline-label=""')),
		).toContain("Attached renders · kernel");

		// It is presentation, not source: no line number, and the gutter runs on.
		const row = element(state, 'data-doc-inline-row=""');
		expect(row).toContain('data-doc-inline-gutter=""');
		expect(row).not.toContain("data-doc-line-number");
		expect(sliceLines(payload, views.endLine, views.endLine)).toBe("</views>");
	});
});

describe.skipIf(!hasCapture)("the focus posture is gone, not dormant", () => {
	test("nothing in the rendered view offers a way into a focused surface", () => {
		const markup = render(realTurn());
		for (const token of [
			"data-detail-focus",
			"data-detail-focus-trigger",
			"data-detail-crumb",
			"data-detail-raw-slice",
			"data-detail-posture",
			"data-detail-stream-focused",
		]) {
			expect(markup).not.toContain(token);
		}
		expect(markup).not.toContain('data-detail-block="focus:');
		expect(decode(markup)).not.toContain("Raw state");
		expect(decode(markup)).not.toContain("All state");
	});

	test("the Messages surface is simply the surface — unwrapped and complete", () => {
		const panel = statePanel(render(realTurn(), { surface: "messages" }));
		const stream = panel.slice(panel.indexOf('data-detail-zone="messages"'));
		expect(stream).toContain('data-detail-clamp="none"');
		expect(stream).toContain('data-detail-block-bare=""');
		expect(stream.split("data-message-index=").length - 1).toBe(10);
		// The kernel elided these images upstream; no thumbnail is invented here.
		expect(decode(stream)).toMatch(/\[image elided — image\/png, [\d.]+ KB\]/);
	});

	test("Context and System prompt keep their plain, unzoned bodies", () => {
		const markup = render(realTurn());
		const context = markup.slice(
			markup.indexOf('data-detail-tab="context"'),
			markup.indexOf('data-detail-tab="system"'),
		);
		expect(context).not.toContain("data-detail-subtabs");
		expect(context).toContain('data-detail-block="turn:context"');
	});
});

describe.skipIf(!hasCapture)("every tab's primary figure is a reading window", () => {
	function tabPanel(markup: string, id: string, next: string): string {
		return markup.slice(
			markup.indexOf(`data-detail-tab="${id}"`),
			next === "" ? undefined : markup.indexOf(`data-detail-tab="${next}"`),
		);
	}

	test("the System prompt tab renders all 303 lines in a scroll window", () => {
		const context = realTurn();
		const prompt = context.system_prompt!;
		expect(prompt.split("\n")).toHaveLength(303);

		const panel = tabPanel(render(context), "system", "tools");
		const figure = element(panel, 'data-detail-block="turn:system"');

		expect(attributeOf(figure, "data-detail-clamp")).toBe("scroll");
		expect(figure).not.toContain("data-clamped");
		expect(figure).not.toContain("to-background/95");
		expect(blockSource(panel, "turn:system")).toBe(prompt);
		expect([...figure.matchAll(/data-doc-line-number=""/g)]).toHaveLength(303);

		const body = element(figure, 'data-doc-scroll=""');
		expect(body).toContain("overflow-x-auto");
		expect(body).toContain("overflow-y-auto");
		expect(body).toContain("max-height:min(70vh, 900px)");
		expect(figure).toContain('aria-label="Expand System prompt"');
	});

	test("the Context tab renders all 16k characters in a scroll window", () => {
		const context = realTurn();
		const panel = tabPanel(render(context), "context", "system");
		const figure = element(panel, 'data-detail-block="turn:context"');
		const source = blockSource(panel, "turn:context");

		expect(source.length).toBeGreaterThan(16_000);
		expect(attributeOf(figure, "data-detail-clamp")).toBe("scroll");
		expect(figure).not.toContain("data-clamped");
		expect(figure).not.toContain("to-background/95");
		expect([...figure.matchAll(/data-doc-line-number=""/g)]).toHaveLength(
			source.split("\n").length,
		);

		const body = element(figure, 'data-doc-scroll=""');
		expect(body).toContain("overflow-x-auto");
		expect(body).toContain("overflow-y-auto");
		expect(body).toContain("max-height:min(70vh, 900px)");
		expect(figure).toContain('aria-label="Expand Context"');
	});

	test("every tab's primary figure inherits the policy, tall is gone", () => {
		const markup = render(realTurn());
		const clampOf = (id: string) =>
			attributeOf(
				element(markup, `data-detail-block="${id}"`),
				"data-detail-clamp",
			);

		// State inherits it (it declares no clamp); Context and System prompt
		// name it, because they are also opened outside the Turn body.
		expect(clampOf("turn:state")).toBe("scroll");
		expect(clampOf("turn:context")).toBe("scroll");
		expect(clampOf("turn:system")).toBe("scroll");
		expect(markup).not.toContain('data-detail-clamp="tall"');

		// Tier-2 figures nested INSIDE message cards are not primary figures and
		// keep their own previews — the policy is about the tab's document.
		const messages = markup.slice(markup.indexOf('data-detail-zone="messages"'));
		expect(messages).toContain("data-clamped");
	});

	test("a tab renderer that says nothing about clamping inherits the window", () => {
		// The mechanism the future Tools tab rides in on, asserted directly.
		expect(PRIMARY_FIGURE_CLAMP.windowed).toBe(true);
		const stamped = withPrimaryFigurePolicy([
			{ id: "a", slot: "content", caption: "A", body: "x" },
			{ id: "b", slot: "content", caption: "B", body: "y", clamp: CLAMP.tight },
			{ id: "c", slot: "content", caption: "C", node: null },
		]);
		expect(stamped[0]!.clamp).toBe(PRIMARY_FIGURE_CLAMP);
		// A stated reason to differ survives, and node blocks are untouched.
		expect(stamped[1]!.clamp).toBe(CLAMP.tight);
		expect(stamped[2]!.clamp).toBeUndefined();
	});
});

describe("degradation — a payload with no offsets keeps the subtabs and the figure", () => {
	const ELIDED: RunTurnContextResponse = {
		run_id: "r",
		turn_number: 2,
		prompt_hash: null,
		system_prompt: "sys",
		message_count: 4,
		sections: [
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
			{ kind: "tail", start: 2, end: 4 },
		],
		messages: [
			{
				role: "custom",
				customType: "kernel:context",
				content: [{ type: "text", text: "<context>c</context>" }],
			},
			{
				role: "custom",
				customType: "kernel:state",
				content: [{ type: "text", text: "[turns 1–2 elided]" }],
			},
			{ role: "user", content: [{ type: "text", text: "carry on" }] },
			{ role: "assistant", content: [{ type: "text", text: "done" }] },
		],
	};

	test("no <views> anchor, but the surfaces and the whole figure survive", () => {
		const markup = statePanel(render(ELIDED));
		expect(surfaces(markup).map((surface) => surface.id)).toEqual([
			"state",
			"messages",
		]);
		expect(markup).toContain('data-detail-block="turn:state"');
		expect(blockSource(markup, "turn:state")).toBe("[turns 1–2 elided]");
		expect(markup).not.toContain('data-detail-block="turn:state:continued"');

		// Nothing to embed and nothing to focus: an unindexable payload still
		// shows every byte it has.
		expect(markup).not.toContain("data-doc-inline-row");
		expect(markup).not.toContain("data-detail-focus-trigger");
		expect(markup).not.toContain("data-detail-zone-meta");
	});
});
