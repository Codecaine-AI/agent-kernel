/**
 * state-outline.test — the coarse index behind the State tab's rail and focus.
 *
 * The line ranges asserted against the real capture are the ones printed in
 * state-tab-options.html R2.1, so a drift in the parser is a drift from the
 * agreed design, not just from a fixture.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseStateOutline, sliceLines } from "./state-outline";

const TRACE_DB_PATH = resolve(
	import.meta.dir,
	"../../../../../../../canvas/.agent-kernel/trace.db",
);
const CONTAINER_ID = "f172afdc-b39e-5d9d-b62a-729f8e29b2af";
const SESSION_ID = "019fa4f0-b02d-7f54-b007-5a4887e22543";
const TURN_EVENT_ID = "89e7644e-4923-4c62-b9c6-6eb699d827d1";

/** The 123-line render(state) payload of canvas turn 4, read only. */
export function realStatePayload(): string {
	const db = new Database(TRACE_DB_PATH, { readonly: true });
	try {
		const row = db
			.query<{ event_data: string }, [string, string, string]>(
				"select event_data from trace_events where event_id = ? and container_id = ? and pi_session_id = ?",
			)
			.get(TURN_EVENT_ID, CONTAINER_ID, SESSION_ID);
		if (!row) throw new Error("The reviewed turn event is absent");
		const snapshot = JSON.parse(row.event_data) as {
			message_refs: Array<{ blob_hash: string; index: number }>;
		};
		const stateRef = [...snapshot.message_refs].sort(
			(left, right) => left.index - right.index,
		)[1];
		if (!stateRef) throw new Error("The reviewed turn has no state message");
		const blob = db
			.query<{ data: unknown }, [string]>(
				"select data from trace_blobs where hash = ?",
			)
			.get(stateRef.blob_hash);
		if (!blob) throw new Error("The reviewed state blob is absent");
		const text =
			typeof blob.data === "string"
				? blob.data
				: new TextDecoder().decode(blob.data as Uint8Array);
		const message = JSON.parse(text) as {
			content: Array<{ type: string; text?: string }>;
		};
		const body = message.content.find((block) => block.type === "text")?.text;
		if (body === undefined) throw new Error("The reviewed state has no text");
		return body;
	} finally {
		db.close();
	}
}

export const hasRealCapture: boolean = existsSync(TRACE_DB_PATH);

/**
 * The nine top-level fields and their line ranges, copied from the R2.1
 * resting-view mockup's rail.
 */
const AGREED_RANGES: ReadonlyArray<readonly [string, number, number]> = [
	["instruction", 2, 4],
	["scope", 5, 17],
	["board", 18, 92],
	["ops", 93, 98],
	["diff", 99, 105],
	["lints", 106, 113],
	["requests", 114, 116],
	["views", 117, 119],
	["conversation", 120, 122],
];

describe("the real 123-line state payload", () => {
	test.skipIf(!hasRealCapture)(
		"indexes exactly the nine top-level fields at the agreed line ranges",
		() => {
			const payload = realStatePayload();
			expect(payload.split("\n").length).toBe(123);
			expect(payload.length).toBe(11_744);

			const outline = parseStateOutline(payload);
			expect(outline).not.toBeNull();
			expect(outline!.rootLine).toBe(1);
			expect(outline!.totalLines).toBe(123);
			expect(outline!.totalChars).toBe(11_744);
			expect(outline!.rootAttributes).toEqual({
				v: "15",
				turn: "5",
				board: "v2-flow",
			});
			expect(
				outline!.blocks.map((block) => [
					block.tag,
					block.startLine,
					block.endLine,
				]),
			).toEqual(AGREED_RANGES.map((range) => [...range]));
		},
	);

	test.skipIf(!hasRealCapture)(
		"every sub-block source is the payload's own bytes for its range",
		() => {
			const payload = realStatePayload();
			const outline = parseStateOutline(payload)!;
			for (const block of outline.blocks) {
				expect(block.source).toBe(
					sliceLines(payload, block.startLine, block.endLine),
				);
				expect(payload).toContain(block.source);
				// The opening and closing tags bound the slice exactly.
				expect(block.source.split("\n")[0]!.trim()).toStartWith(`<${block.tag}`);
				expect(block.source.split("\n").at(-1)!.trim()).toBe(`</${block.tag}>`);
			}
			// 75 board lines, the number the rail advertises.
			const board = outline.blocks.find((block) => block.tag === "board")!;
			expect(board.endLine - board.startLine + 1).toBe(75);
			expect(board.attributes).toEqual({
				fresh: "yes",
				objects: "40",
				edges: "25",
			});
			const views = outline.blocks.find((block) => block.tag === "views")!;
			expect(views.attributes).toEqual({ attached: "3", taken: "5" });
		},
	);

	test.skipIf(!hasRealCapture)(
		"the board digest's own indentation is never mistaken for structure",
		() => {
			const outline = parseStateOutline(realStatePayload())!;
			expect(outline.blocks.map((block) => block.tag)).not.toContain("BOARD");
			// Nothing between <board> and </board> starts another top-level field.
			const board = outline.blocks.find((block) => block.tag === "board")!;
			const following = outline.blocks.find(
				(block) => block.startLine > board.endLine,
			)!;
			expect(following.tag).toBe("ops");
			expect(following.startLine).toBe(board.endLine + 1);
		},
	);
});

describe("degradation — no offsets means no focus targets", () => {
	test("a payload that is not a state render has no outline", () => {
		expect(parseStateOutline("[turns 1–2 elided]")).toBeNull();
		expect(parseStateOutline("")).toBeNull();
		expect(parseStateOutline("No state rendered.")).toBeNull();
	});

	test("a one-line state has no top-level sub-blocks", () => {
		expect(
			parseStateOutline('<state v="2"><board>ready</board></state>'),
		).toBeNull();
	});

	test("a state whose fields never close is content, not structure", () => {
		const truncated = ['<state v="3">', "<board>", "  a b c"].join("\n");
		expect(parseStateOutline(truncated)).toBeNull();
	});

	test("a hostile payload indexes only the fields that really close", () => {
		const hostile = [
			'<state v="2" note="quotes \'&\' &amp; angles">',
			"  <board>",
			'    a → b × 3 · "quoted" & bare & <not a tag',
			"    <!-- comment with < and > -->",
			"    5 < 6 > 4 → done",
			"  </board>",
			"  <malformed <>>",
			"</state>",
		].join("\n");
		const outline = parseStateOutline(hostile)!;
		expect(outline.blocks.map((block) => block.tag)).toEqual(["board"]);
		expect(outline.blocks[0]!.startLine).toBe(2);
		expect(outline.blocks[0]!.endLine).toBe(6);
		expect(outline.blocks[0]!.source).toBe(sliceLines(hostile, 2, 6));
	});

	test("inline and self-closing fields are one-line ranges", () => {
		const payload = [
			"<state>",
			"  <lints>0 errors · 0 warnings</lints>",
			"  <requests open='1'>make the retry path clearer</requests>",
			"  <views taken=\"2\" />",
			"</state>",
		].join("\n");
		const outline = parseStateOutline(payload)!;
		expect(
			outline.blocks.map((block) => [
				block.tag,
				block.startLine,
				block.endLine,
			]),
		).toEqual([
			["lints", 2, 2],
			["requests", 3, 3],
			["views", 4, 4],
		]);
		expect(outline.blocks[2]!.attributes).toEqual({ taken: "2" });
	});

	test("a nested field of the same name closes at its own depth", () => {
		const payload = [
			"<state>",
			"<scope>",
			"<scope>",
			"</scope>",
			"</scope>",
			"<ops>",
			"</ops>",
			"</state>",
		].join("\n");
		const outline = parseStateOutline(payload)!;
		expect(
			outline.blocks.map((block) => [
				block.tag,
				block.startLine,
				block.endLine,
			]),
		).toEqual([
			["scope", 2, 5],
			["ops", 6, 7],
		]);
	});
});
