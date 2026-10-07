/**
 * model-node-tree.test.tsx — call, decision, step and gate rows in the tree,
 * rendered from viewer-core's real span build of an offline fixture.
 */
import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { fixtureSpan, modelNodeSpans } from "./__fixtures__/model-node-trace";
import { GROUP_ACCENT } from "./icons";
import { collectSpanIds } from "./trace-tree-utils";
import { TreeView } from "./TreeView";

const spans = modelNodeSpans();
const markup = renderToStaticMarkup(
	h(TreeView, {
		spans,
		expandedSpansIds: collectSpanIds(spans),
		onExpandSpansIdsChange: () => {},
	}),
);

/** One row's own markup: from its row element up to the next row (its children follow). */
function rowMarkup(spanId: string): string {
	const start = markup.indexOf(`data-span-row="${spanId}"`);
	if (start < 0) throw new Error(`row ${spanId} not rendered`);
	const next = markup.indexOf("data-span-row=", start + 1);
	return markup.slice(start, next < 0 ? undefined : next);
}

function count(needle: string): number {
	return markup.split(needle).length - 1;
}

describe("TreeView model-node rows", () => {
	const call = fixtureSpan("call").id;
	const decision = fixtureSpan("decision").id;
	const step = fixtureSpan("step").id;
	const gate = fixtureSpan("gate").id;

	test("TreeView renders badge text and group classes for each kind", () => {
		const cases = [
			{ id: call, badge: "CALL", kind: "call", group: GROUP_ACCENT.call },
			{ id: decision, badge: "DECIDE", kind: "decision", group: GROUP_ACCENT.decision },
			{ id: step, badge: "STEP", kind: "step", group: GROUP_ACCENT.step },
		] as const;
		for (const { id, badge, kind, group } of cases) {
			const row = rowMarkup(id);
			expect(row).toContain(`data-node-kind-badge="${kind}"`);
			expect(row).toContain(`>${badge}</span>`);
			expect(row).toContain(`data-node-kind="${kind}"`);
			expect(row).toContain(group.border);
			expect(row).toContain(group.wash ?? "missing wash");
			expect(row).toContain(group.text);
		}

		// The gate is a neutral frame: hairline border, no band wash.
		const gateRow = rowMarkup(gate);
		expect(gateRow).toContain(">GATE</span>");
		expect(gateRow).toContain('data-node-kind="gate"');
		expect(gateRow).toContain(GROUP_ACCENT.orchestration.border);
		expect(gateRow).not.toContain("--band-wash-opacity");
	});

	test("each row shows a result chip and a duration chip", () => {
		for (const id of [call, decision, step, gate]) {
			const row = rowMarkup(id);
			expect(row).toContain('data-node-chip="result"');
			expect(row).toContain('data-node-chip="duration"');
		}
		expect(rowMarkup(decision)).toContain(">pass p=0.91</span>");
		expect(rowMarkup(call)).toContain(">1.8 s</span>");
		expect(rowMarkup(step)).toContain(">objdiff 100</span>");
	});

	test("status wins on the frame; the kind badge keeps its hue", () => {
		const abstain = rowMarkup(fixtureSpan("abstain").id);
		expect(abstain).toContain(GROUP_ACCENT.warning.border);
		expect(abstain).toContain('data-node-chip-tone="warning"');
		expect(abstain).toContain("bg-pink-soft text-pink");

		const failed = rowMarkup(fixtureSpan("failedCall").id);
		expect(failed).toContain(GROUP_ACCENT.error.border);
		expect(failed).toContain(">error · parse</span>");
		expect(failed).toContain("bg-teal-soft text-teal");
	});

	test("the retried decision shows its ×2 node row and both attempt rows", () => {
		const retry = rowMarkup(fixtureSpan("retry").id);
		expect(retry).toContain('data-node-chip="attempts"');
		expect(retry).toContain(">×2</span>");
		expect(rowMarkup("attempt:RD2a")).toContain(">attempt 1 · 503</span>");
		expect(rowMarkup("attempt:RD2b")).toContain(">attempt 2</span>");
	});

	test("the name keeps its width ahead of the chips and carries its full name as a tooltip", () => {
		const row = rowMarkup(fixtureSpan("retriedCall").id);
		// Longer than 18 characters: may truncate, but never below 18ch.
		expect(row).toMatch(/data-node-name="" title="ExtractConfirmedCheckpointKnowledge" style="[^"]*min-width:18ch/);
		// A short name never shrinks.
		expect(rowMarkup(step)).toMatch(/data-node-name="" title="validate" style="[^"]*flex-shrink:0/);
		// Chips sit on one clipped line and wrap out whole; the duration has its own
		// slot, which gives way before the name or the result.
		expect(row).toMatch(/data-node-chips="" class="[^"]*flex-wrap[^"]*overflow-hidden[^"]*" style="height:18px;flex-shrink:1"/);
		expect(row).toMatch(/data-node-duration="" class="[^"]*flex-wrap[^"]*overflow-hidden[^"]*" style="height:18px;flex-shrink:1000000"/);
		expect(row).toMatch(/style="line-height:18px;min-width:18ch;flex-shrink:1000"/);
		const chips = [...row.matchAll(/data-node-chip="(\w+)"/g)].map((match) => match[1]);
		expect(chips).toEqual(["result", "attempts", "duration"]);
		expect(rowMarkup("attempt:RD2a")).toContain('title="attempt 1 of 2 · http · upstream 503"');
	});

	test("every tree item carries its span id exactly once, on the item and on its clickable row", () => {
		for (const id of collectSpanIds(spans)) {
			expect(count(`data-span-id="${id}"`)).toBe(1);
			expect(count(`data-span-row="${id}"`)).toBe(1);
		}
		expect(markup).toMatch(/<li role="treeitem"[^>]*data-span-id="pi:K"/);
		expect(markup).toMatch(/<div[^>]*data-span-row="pi:K"[^>]*role="button"/);
	});
});
