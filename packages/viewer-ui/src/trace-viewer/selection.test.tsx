import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { TreeView } from "./TreeView";

function span(id: string, title: string): TraceSpan {
	return {
		id,
		title,
		type: "event",
		startTime: new Date(0),
		endTime: new Date(1),
		duration: 1,
		status: "success",
		attributes: [{ key: "event_type", value: { stringValue: "tool_call_start" } }, { key: "tool_name", value: { stringValue: title } }],
		children: [],
	} as unknown as TraceSpan;
}

describe("selection treatment", () => {
	const spans = [span("a", "probe"), span("b", "other")];
	const markup = renderToStaticMarkup(
		h(TreeView, {
			spans,
			selectedSpan: spans[0],
			expandedSpansIds: [],
			onExpandSpansIdsChange: () => {},
		}),
	);

	test("no row-wide wash — the row contributes only the gutter bar", () => {
		expect(markup).not.toContain("bg-gradient-to-b");
		expect(markup).not.toContain("from-status-info-fill");
		expect(markup).not.toContain("before:bg-status-info-fill");
		expect(markup).toContain(
			"shadow-[inset_var(--selection-bar-width,3px)_0_0_0_rgb(var(--selection-color,var(--status-info))/var(--selection-opacity,1))]",
		);
		// Exactly one selected row.
		expect((markup.match(/data-selected/g) ?? []).length).toBe(1);
	});

	test("card ring + fill consume the selection tokens with baked fallbacks", () => {
		expect(markup).toContain(
			"group-data-[selected]/spanrow:shadow-[inset_0_0_0_var(--selection-width,2px)_rgb(var(--selection-color,var(--status-info))/var(--selection-opacity,1))]",
		);
		expect(markup).toContain(
			"group-data-[selected]/spanrow:bg-[rgb(var(--selection-color,var(--status-info))/0.12)]",
		);
		// The old fixed classes are gone.
		expect(markup).not.toContain("ring-status-info-border");
		expect(markup).not.toContain("bg-status-info-fill/70");
	});
});
