/**
 * ToolsSection.test.tsx — section ④, the per-request tool roster.
 *
 * The load-bearing distinction here is three-state, not two: an ABSENT roster
 * means the snapshot predates tool capture, an EMPTY roster means the capture
 * ran and the agent had nothing, and offline a captured-but-unreadable roster
 * is a third fact again. Reading length instead of presence would quietly turn
 * "we never looked" into "there were no tools", which is a lie about the run.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailShell } from "../../DetailShell";
import { buildSnapshotContextView } from "../TurnBody";
import type { SanitizedToolDefinition } from "../request-snapshot-api";
import {
	TOOLS_EMPTY_BODY,
	TOOLS_NOT_CAPTURED_BODY,
	TOOLS_UNAVAILABLE_BODY,
	ToolsSection,
} from "./ToolsSection";

const PROBE: SanitizedToolDefinition = {
	name: "probe",
	description: "Probe one note.",
	parameters: {
		type: "object",
		properties: { note: { type: "string" } },
	},
};

const LOOK: SanitizedToolDefinition = { name: "look" };

const APPLY: SanitizedToolDefinition = {
	name: "apply_operation",
	description: "Apply one board operation.",
};

/** The canonical 2-space form the json-document carve-out produces. */
const PROBE_BODY = [
	"{",
	'  "name": "probe",',
	'  "description": "Probe one note.",',
	'  "parameters": {',
	'    "type": "object",',
	'    "properties": {',
	'      "note": {',
	'        "type": "string"',
	"      }",
	"    }",
	"  }",
	"}",
].join("\n");

const SPAN: TraceSpan = {
	id: "turn-tools",
	title: "Turn 1",
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

// ─── The roster ─────────────────────────────────────────────────────────────

describe("ToolsSection — a captured roster", () => {
	const blocks = ToolsSection({ tools: [PROBE, LOOK, APPLY] });

	test("one block per tool, in provider order", () => {
		expect(blocks).toHaveLength(3);
		expect(blocks.map((block) => block.id)).toEqual([
			"turn:tool:probe",
			"turn:tool:look",
			"turn:tool:apply_operation",
		]);
		expect(blocks.map((block) => block.caption)).toEqual([
			"probe",
			"look",
			"apply_operation",
		]);
		// Order values rise with the roster, so the shell's slot sort cannot
		// reshuffle the sequence the provider actually saw.
		const orders = blocks.map((block) => block.order!);
		expect(orders).toEqual([...orders].sort((a, b) => a - b));
		expect(new Set(orders).size).toBe(orders.length);
	});

	test("every block is standard content carrying the section ④ marker", () => {
		for (const block of blocks) {
			expect(block.slot).toBe("content");
			expect(block.turnSection).toBe("tools");
			expect(block.node).toBeUndefined();
			expect(typeof block.body).toBe("string");
		}
	});

	test("the body is the canonical 2-space JSON document", () => {
		expect(blocks[0]!.body).toBe(PROBE_BODY);
		expect(blocks[0]!.language).toBe("json");
	});

	test("absent description and parameters are omitted, never nulled", () => {
		expect(blocks[1]!.body).toBe(['{', '  "name": "look"', "}"].join("\n"));
		expect(blocks[2]!.body).toBe(
			[
				"{",
				'  "name": "apply_operation",',
				'  "description": "Apply one board operation."',
				"}",
			].join("\n"),
		);
	});

	test("untagged snapshots still get the roster, just no section marker", () => {
		for (const block of ToolsSection({ tools: [PROBE], tagged: false })) {
			expect(block.turnSection).toBeUndefined();
			expect(block.slot).toBe("content");
		}
	});

	test("a duplicate tool name keeps distinct ids so no tool is dropped", () => {
		const shadowed = ToolsSection({
			tools: [PROBE, { ...PROBE, description: "Shadowed override." }],
		});
		const ids = shadowed.map((block) => block.id);
		expect(ids).toEqual(["turn:tool:probe", "turn:tool:probe:1"]);
		expect(new Set(ids).size).toBe(ids.length);
		// Both are still labelled with the name the agent saw.
		expect(shadowed.map((block) => block.caption)).toEqual(["probe", "probe"]);
		expect(shadowed[1]!.body).toContain('"description": "Shadowed override."');
	});
});

// ─── The three empty states ─────────────────────────────────────────────────

describe("ToolsSection — presence, not length", () => {
	test("an absent roster says the trace never captured one", () => {
		const blocks = ToolsSection({ tools: undefined });
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.id).toBe("turn:tools-not-captured");
		expect(blocks[0]!.caption).toBe("Tools");
		expect(blocks[0]!.body).toBe(TOOLS_NOT_CAPTURED_BODY);
		expect(blocks[0]!.slot).toBe("content");
		expect(blocks[0]!.language).toBe("text");
		// "We never looked" is not section ④; it is the absence of it.
		expect(blocks[0]!.turnSection).toBeUndefined();
	});

	test("an empty roster says the request had no tool active", () => {
		const blocks = ToolsSection({ tools: [] });
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.id).toBe("turn:tools-empty");
		expect(blocks[0]!.body).toBe(TOOLS_EMPTY_BODY);
		expect(blocks[0]!.slot).toBe("content");
		// A captured, empty roster IS section ④ — present and empty.
		expect(blocks[0]!.turnSection).toBe("tools");
		expect(ToolsSection({ tools: [], tagged: false })[0]!.turnSection).toBeUndefined();
	});

	test("offline, a captured blob reads as unreadable here, not as never captured", () => {
		const blocks = ToolsSection({ tools: undefined, unavailable: true });
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.id).toBe("turn:tools-unavailable");
		expect(blocks[0]!.body).toBe(TOOLS_UNAVAILABLE_BODY);
		expect(blocks[0]!.turnSection).toBeUndefined();
	});

	test("the three notices are three different sentences", () => {
		expect(
			new Set([
				TOOLS_NOT_CAPTURED_BODY,
				TOOLS_EMPTY_BODY,
				TOOLS_UNAVAILABLE_BODY,
			]).size,
		).toBe(3);
	});

	test("every state returns at least one block, so the tab is never empty", () => {
		for (const tools of [undefined, [] as SanitizedToolDefinition[], [PROBE]]) {
			expect(ToolsSection({ tools }).length).toBeGreaterThan(0);
		}
	});
});

// ─── Through the shell ──────────────────────────────────────────────────────

describe("the Tools tab in a rendered Turn", () => {
	function render(tools?: SanitizedToolDefinition[]): string {
		return renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={buildSnapshotContextView({
					systemPrompt: "You are the layout-editor.",
					messages: [
						{ role: "user", content: [{ type: "text", text: "align these" }] },
					],
					sections: [{ kind: "context", start: 0, end: 1 }],
					apiBase: "http://localhost:4319",
					...(tools === undefined ? {} : { tools }),
				})}
			/>,
		);
	}

	test("the roster renders last, in provider order, on the source gutter", () => {
		const markup = render([PROBE, LOOK, APPLY]);
		const panel = markup.slice(markup.indexOf('data-detail-tab="tools"'));
		const positions = ["probe", "look", "apply_operation"].map((name) =>
			panel.indexOf(`data-detail-block="turn:tool:${name}"`),
		);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(panel).toContain('data-turn-section="tools"');
		expect(panel).toContain("data-doc-line-number");
		expect(panel).toContain('data-doc-language="json"');
	});

	test("a snapshot without the field shows the never-captured notice", () => {
		const markup = render();
		expect(markup).toContain('data-detail-block="turn:tools-not-captured"');
		expect(markup).toContain(TOOLS_NOT_CAPTURED_BODY);
		expect(markup).not.toContain('data-turn-section="tools"');
	});

	test("a captured empty roster shows the no-tools notice instead", () => {
		const markup = render([]);
		expect(markup).toContain('data-detail-block="turn:tools-empty"');
		expect(markup).toContain(TOOLS_EMPTY_BODY);
		expect(markup).not.toContain(TOOLS_NOT_CAPTURED_BODY);
	});
});
