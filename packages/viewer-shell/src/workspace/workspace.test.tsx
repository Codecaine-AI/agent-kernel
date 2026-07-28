import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import { DetailShell } from "@agent-kernel/viewer-ui";

import {
	KernelTraceWorkspace,
	defaultTraceStatusClass,
	type KernelTraceWorkspaceProps,
	type TraceWorkspaceRow,
} from "./KernelTraceWorkspace";

function span(id: string, title: string): TraceSpan {
	return {
		id,
		title,
		type: "event",
		startTime: new Date(0),
		endTime: new Date(1),
		duration: 1,
		status: "success",
		attributes: [{ key: "event_type", value: { stringValue: "user_message" } }],
		children: [],
		input: "hello",
	} as unknown as TraceSpan;
}

const ROWS: TraceWorkspaceRow[] = [
	{ id: "t1", title: "First trace", subtitle: "Session abc", status: "done" },
	{ id: "t2", title: "Second trace", status: "running", deleteDisabled: true },
];

function render(props: Partial<KernelTraceWorkspaceProps>): string {
	return renderToStaticMarkup(
		h(KernelTraceWorkspace, {
			rows: ROWS,
			selectedRowId: null,
			detail: null,
			spans: [],
			onSelect: () => {},
			...props,
		}),
	);
}

describe("adapter contract — list mode", () => {
	test("rows render title/subtitle/status with the shared status mapping", () => {
		const markup = render({});
		expect(markup).toContain('data-trace-workspace="list"');
		expect(markup).toContain("First trace");
		expect(markup).toContain("Session abc");
		expect(markup).toContain(defaultTraceStatusClass("done"));
		expect(markup).toContain(defaultTraceStatusClass("running"));
	});

	test("delete affordances exist ONLY when the host provides onDelete", () => {
		const withDelete = render({ onDelete: () => {} });
		expect(withDelete).toContain("Delete trace First trace");
		expect(withDelete).toContain(">Del<");
		const readOnly = render({});
		expect(readOnly).not.toContain("Delete trace");
		expect(readOnly).not.toContain(">Del<");
	});

	test("labels and slots are host-configurable", () => {
		const markup = render({
			labels: { listTitle: "Sessions", countNoun: "session", rowColumnLabel: "Session" },
			listExtras: h("div", { "data-testid": "doctor" }, "DOCTOR"),
		});
		expect(markup).toContain(">Sessions<");
		expect(markup).toContain("2 sessions");
		expect(markup).toContain("DOCTOR");
	});
});

describe("drill-in mode", () => {
	const detailProps: Partial<KernelTraceWorkspaceProps> = {
		selectedRowId: "t1",
		detail: { id: "t1", title: "First trace", status: "done", subtitle: "Session abc" },
		spans: [span("u1", "user")],
	};

	test("detail present → compact header, no list, tree+detail own the width", () => {
		const markup = render(detailProps);
		expect(markup).toContain('data-trace-workspace="detail"');
		expect(markup).toContain("All traces"); // back affordance
		expect(markup).not.toContain("Second trace"); // list fully hidden
		expect(markup).toContain("width:40%"); // tree pane of the shared split
		expect(markup).toContain('role="separator"'); // draggable divider
	});

	test("overflow delete menu button only with onDelete", () => {
		expect(render({ ...detailProps, onDelete: () => {} })).toContain("Trace actions");
		expect(render(detailProps)).not.toContain("Trace actions");
	});

	test("overlay slot is threaded; NO workspace-level usage affordance", () => {
		const markup = render({
			...detailProps,
			overlays: h("div", null, "OVERLAY-LAYER"),
			usageData: { container: null, runs: [] },
		});
		expect(markup).toContain("OVERLAY-LAYER");
		// Usage/runtime info lives detail-side; the workspace renders neither
		// the old strip nor the toolbar toggle.
		expect(markup).not.toContain(">Usage<");
		expect(markup).not.toContain("Toggle usage summary");
	});

	test("drill-in header carries ONLY back/title/status(/overflow)", () => {
		const markup = render({ ...detailProps });
		const detailMarkup = renderToStaticMarkup(
			h(DetailShell, {
				span: span("u1", "user"),
				view: {
					blocks: [
						{
							id: "message",
							slot: "content",
							caption: "Message",
							body: "hello",
						},
					],
				},
			}),
		);
		// The subtitle ("Session abc") no longer rides the header bar.
		const header = markup.slice(
			markup.indexOf("All traces"),
			markup.indexOf('role="separator"'),
		);
		expect(header).not.toContain("Session abc");
		expect(header).toContain("First trace");
		expect(header).toContain(defaultTraceStatusClass("done"));
		const detailHeader =
			/<div[^>]*data-detail-header=""[^>]*>/.exec(detailMarkup)?.[0] ?? "";
		expect(detailHeader).toContain("border-b border-border");
		// Shared panel-header surface: bg-background over border-b border-border.
		expect(detailHeader).toContain("bg-background");
		expect((markup.match(/bg-background/g) ?? []).length).toBeGreaterThanOrEqual(2);
		expect(markup).not.toContain("bg-muted/40 px-3");
	});
});

describe("both hosts, same geometry", () => {
	// The research app's binding shape vs the canvas binding shape — labels
	// and slots differ, geometry must not.
	const research: Partial<KernelTraceWorkspaceProps> = {
		selectedRowId: "t1",
		detail: { id: "t1", title: "Research run", status: "done", subtitle: "Session s" },
		spans: [span("u1", "user")],
		onDelete: () => {},
		labels: { listTitle: "Traces", countNoun: "database trace", rowColumnLabel: "Research" },
	};
	const canvas: Partial<KernelTraceWorkspaceProps> = {
		selectedRowId: "t1",
		detail: { id: "t1", title: "Canvas session", status: "done", subtitle: null },
		spans: [span("u1", "user")],
		labels: { countNoun: "session", rowColumnLabel: "Session" },
	};

	function geometry(markup: string): Record<string, string | boolean> {
		const rootClass = /data-trace-workspace="detail" class="([^"]+)"/.exec(markup)?.[1] ?? "";
		return {
			rootClass,
			treePane: markup.includes("width:40%"),
			divider: markup.includes('role="separator"'),
			workspaceHeightVar: rootClass.includes("h-[var(--research-workspace-height,100%)]"),
			minHeightVar: rootClass.includes("min-h-[var(--research-workspace-min-height,560px)]"),
		};
	}

	test("drill-in geometry identical across host prop shapes", () => {
		const a = geometry(render(research));
		const b = geometry(render(canvas));
		expect(a).toEqual(b);
		expect(a.treePane).toBe(true);
		expect(a.divider).toBe(true);
		expect(a.workspaceHeightVar).toBe(true);
	});

	test("list header consumes the LAYOUT header-height var in both hosts", () => {
		const a = render({ labels: research.labels });
		const b = render({ labels: canvas.labels });
		for (const markup of [a, b]) {
			expect(markup).toContain("h-[var(--research-header-height,64px)]");
		}
	});
});
