/**
 * span-indent.test.tsx — SSR depth audit for the tree indent geometry.
 *
 * THE RULE: one uniform, visually obvious indent step per depth level across
 * the whole tree, and connectors + content derived from the SAME formula.
 * In the default "inside" toggle mode every row is laid out on a 24px grid:
 *
 *   columns 0 .. depth-1 — fixed 24px connector cells (ancestor guides +
 *                          this row's elbow in column depth-1)
 *   column depth         — the always-reserved toggle slot (toggle, or the
 *                          elbow's horizontal continuation on leaf rows)
 *   content              — starts at exactly (depth + 1) * 24px
 *
 * Because cells are fixed-width and rendered in column order, line
 * x-positions are (k * 24 + 12) by construction — the same constant and the
 * same depth arithmetic as the content offset, so they cannot diverge.
 *
 * Rendered via react-dom/server so the assertions cover the real markup,
 * not a unit formula; drift in SpanCard/SpanCardConnector layout fails
 * here. The fixture mirrors the canvas layout-editor trace Ford reviews:
 * Provisioning with leaf children, a user-message card, Turn N containers
 * owning tools, and last-child termination.
 */
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { TreeView } from "../TreeView";
import { collectSpanIds } from "../trace-tree-utils";

const STEP = 24; // LAYOUT_CONSTANTS.CONNECTOR_WIDTH

let idSeq = 0;

function span(
	title: string,
	eventType: string,
	children?: TraceSpan[],
): TraceSpan {
	idSeq += 1;
	const start = new Date("2026-07-27T00:00:00.000Z");
	const end = new Date("2026-07-27T00:00:01.000Z");
	return {
		id: `span-${idSeq}`,
		title,
		startTime: start,
		endTime: end,
		duration: 1000,
		type: eventType === "tool_call_start" ? "tool_execution" : "agent_invocation",
		status: "success",
		raw: "{}",
		attributes: [{ key: "event_type", value: { stringValue: eventType } }],
		children,
	};
}

/**
 * Mirrors the restructured trace shape: agent → user message → Turn N →
 * tools, with a provisioning branch whose children are leaves (the exact
 * case where a leaf used to render at its parent's own x-offset).
 */
function fixtureTree(): TraceSpan[] {
	return [
		span("layout-editor", "pi_agent_container", [
			span("Provisioning", "provisioning_container", [
				span("system prompt: layout-editor", "system_prompt_resolved"),
				span("context build", "context_build_started", [
					span("input: capabilities", "context_input_resolved"),
					span("input: style-guide", "context_input_resolved"),
				]),
			]),
			span("user_message", "user_message", [
				span("Turn 0", "pi_request_snapshot", [
					span("update_sticky", "tool_call_start"),
					span("add_object", "tool_call_start"),
				]),
				span("Turn 1", "pi_request_snapshot", [
					span("add_connection", "tool_call_start"),
				]),
			]),
		]),
	];
}

interface RenderedRow {
	depth: number;
	columnWidth: number;
	label: string;
	/** data-connector types of this row's cells, in column order. */
	connectors: string[];
	/** Raw class attributes of this row's connector cells. */
	connectorClasses: string[];
	/** data-slot marker of the reserved toggle-slot element, if rendered. */
	slot: string | null;
	/** Whether the expanded-parent drop-line is painted in the slot. */
	hasDropLine: boolean;
}

/**
 * Each SpanCard row carries data-depth plus an inline grid-template-columns
 * whose first track is the connectors column. Splitting the markup at each
 * row start yields one chunk per row: that row's connector cells and slot
 * element render before any descendant row's (descendants start their own
 * chunk), so per-chunk matches belong to the chunk's row.
 */
function parseRows(markup: string): RenderedRow[] {
	const rows: RenderedRow[] = [];
	const chunks = markup.split(/(?=data-depth=")/g).slice(1);
	for (const chunk of chunks) {
		const head = chunk.match(
			/^data-depth="(\d+)"[^>]*style="[^"]*grid-template-columns:(\d+(?:\.\d+)?)px[^"]*"[^>]*aria-label="[^"]*span card for ([^"]*) at level \d+"/,
		);
		if (!head) continue;
		const connectors: string[] = [];
		const connectorClasses: string[] = [];
		for (const cell of chunk.matchAll(
			/data-connector="([a-z-]+)" class="([^"]*)"/g,
		)) {
			connectors.push(cell[1]!);
			connectorClasses.push(cell[2]!);
		}
		const slot = chunk.match(/data-slot="([a-z-]+)"/);
		rows.push({
			depth: Number.parseInt(head[1]!, 10),
			columnWidth: Number.parseFloat(head[2]!),
			label: head[3]!,
			connectors,
			connectorClasses,
			slot: slot?.[1] ?? null,
			hasDropLine: /top-\[calc\(50%_\+_10px\)\]/.test(chunk),
		});
	}
	return rows;
}

function renderTree(spans: TraceSpan[], expandedSpansIds: string[]): string {
	return renderToStaticMarkup(
		createElement(TreeView, {
			spans,
			expandedSpansIds,
			onExpandSpansIdsChange: () => {},
		}),
	);
}

function countSpans(spans: TraceSpan[]): number {
	return spans.reduce(
		(n, s) => n + 1 + countSpans(s.children ?? []),
		0,
	);
}

describe("tree indent geometry (SSR depth audit)", () => {
	const tree = fixtureTree();
	const markup = renderTree(tree, collectSpanIds(tree));
	const rows = parseRows(markup);
	const byLabel = new Map(rows.map((r) => [r.label, r]));

	it("renders every span as a row with a parseable depth", () => {
		expect(rows.length).toBe(countSpans(tree));
	});

	it("indents every row exactly one uniform step per depth level, leaf or parent", () => {
		for (const row of rows) {
			// Content column starts at (depth + 1) * STEP: depth steps of
			// ancestor guides plus the always-reserved toggle slot.
			expect(`${row.label}@${row.depth}:${row.columnWidth}`).toBe(
				`${row.label}@${row.depth}:${(row.depth + 1) * STEP}`,
			);
		}
	});

	it("gives leaves and expandable rows at the same depth the same offset", () => {
		const byDepth = new Map<number, Set<number>>();
		for (const row of rows) {
			const widths = byDepth.get(row.depth) ?? new Set<number>();
			widths.add(row.columnWidth);
			byDepth.set(row.depth, widths);
		}
		for (const [depth, widths] of byDepth) {
			expect({ depth, widths: [...widths] }).toEqual({
				depth,
				widths: [(depth + 1) * STEP],
			});
		}
	});

	it("nests each depth exactly one step deeper than its parent (turn tools sit at depth 3)", () => {
		expect(byLabel.get("layout-editor")?.depth).toBe(0);
		expect(byLabel.get("Provisioning")?.depth).toBe(1);
		expect(byLabel.get("system prompt: layout-editor")?.depth).toBe(2);
		expect(byLabel.get("input: capabilities")?.depth).toBe(3);
		expect(byLabel.get("Turn 0")?.depth).toBe(2);
		expect(byLabel.get("update_sticky")?.depth).toBe(3);
		expect(byLabel.get("add_connection")?.depth).toBe(3);
	});

	it("renders exactly depth connector cells plus one reserved slot per row — content and lines share the formula", () => {
		for (const row of rows) {
			expect(`${row.label}: ${row.connectors.length} cells`).toBe(
				`${row.label}: ${row.depth} cells`,
			);
			// The slot is always present: toggle on expandable rows, the
			// elbow continuation (or blank at the root) on leaves.
			expect(`${row.label}: slot=${row.slot}`).not.toBe(
				`${row.label}: slot=null`,
			);
		}
	});

	it("keeps every connector cell a fixed 24px column (no grow — lines cannot drift off-grid)", () => {
		for (const row of rows) {
			for (const cls of row.connectorClasses) {
				expect(cls).toContain("w-6");
				expect(cls).toContain("shrink-0");
				expect(cls).not.toMatch(/\bgrow\b/);
			}
		}
	});

	it("gives each leaf one clean elbow whose stub continues across the slot to the card edge", () => {
		for (const leaf of [
			"system prompt: layout-editor",
			"input: capabilities",
			"input: style-guide",
			"update_sticky",
			"add_object",
			"add_connection",
		]) {
			const row = byLabel.get(leaf)!;
			const last = row.connectors[row.connectors.length - 1];
			expect(`${leaf}: ${last}`).toMatch(
				new RegExp(`^${leaf}: (t-right|corner-top-right)$`),
			);
			expect(`${leaf}: slot=${row.slot}`).toBe(`${leaf}: slot=leaf-line`);
		}
	});

	it("terminates the drop-line at the last child's elbow and blanks ancestor columns below it", () => {
		// Column 0 keeps the root guide RUNNING here (user_message is still
		// below), column 1 blanks (context build was Provisioning's last
		// child), and the elbow terminates at the last input.
		expect(byLabel.get("input: capabilities")?.connectors).toEqual([
			"vertical",
			"empty",
			"t-right",
		]);
		expect(byLabel.get("input: style-guide")?.connectors).toEqual([
			"vertical",
			"empty",
			"corner-top-right",
		]);
		// user_message is the root's last child: everything beneath it blanks
		// column 0 instead of painting a floating fragment.
		expect(byLabel.get("user_message")?.connectors).toEqual([
			"corner-top-right",
		]);
		expect(byLabel.get("Turn 0")?.connectors).toEqual(["empty", "t-right"]);
		expect(byLabel.get("Turn 1")?.connectors).toEqual([
			"empty",
			"corner-top-right",
		]);
		expect(byLabel.get("add_connection")?.connectors).toEqual([
			"empty",
			"empty",
			"corner-top-right",
		]);
	});

	it("paints the drop-line only on expanded parents — collapsed parents leave no dangling stubs", () => {
		expect(byLabel.get("Turn 0")?.slot).toBe("toggle");
		expect(byLabel.get("Turn 0")?.hasDropLine).toBe(true);

		const collapsed = parseRows(renderTree(fixtureTree(), []));
		for (const row of collapsed) {
			expect(`${row.label}: dropLine=${row.hasDropLine}`).toBe(
				`${row.label}: dropLine=false`,
			);
		}
	});

	it("keeps the uniform step when rows are collapsed", () => {
		// Collapse everything: only roots visible; still at the level-0 offset.
		const collapsed = parseRows(renderTree(fixtureTree(), []));
		const roots = collapsed.filter((r) => r.depth === 0);
		expect(roots.length).toBeGreaterThan(0);
		for (const row of roots) {
			expect(row.columnWidth).toBe(STEP);
		}
	});
});
