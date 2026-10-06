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
			"box-shadow:inset var(--selection-bar-width, var(--ds-border-width-rail)) 0 0 0 rgb(var(--selection-color, var(--status-info)) / var(--selection-opacity, 1))",
		);
		// Exactly one selected row.
		expect((markup.match(/data-selected/g) ?? []).length).toBe(1);
	});

	test("card ring consumes the selection knobs; the fill is the design-system accent wash", () => {
		expect(markup).toContain("group-data-[selected]/spanrow:ring-inset");
		expect(markup).toContain(
			"group-data-[selected]/spanrow:ring-[length:var(--selection-width,var(--ds-border-width-focus))]",
		);
		expect(markup).toContain(
			"group-data-[selected]/spanrow:ring-[color:rgb(var(--selection-color,var(--status-info))/var(--selection-opacity,1))]",
		);
		expect(markup).toContain(
			"group-data-[selected]/spanrow:bg-[color:var(--ds-color-fill-accent)]",
		);
		// The old fixed classes are gone.
		expect(markup).not.toContain("ring-status-info-border");
		expect(markup).not.toContain("bg-status-info-fill/70");
	});
});
