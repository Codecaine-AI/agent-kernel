/** DetailShell.test — SSR coverage for the shared detail-panel frame. */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	DetailModalFrame,
	DetailShell,
	DetailShellFrame,
	shouldCloseDetailsOnEscape,
} from "./DetailShell";
import { CLAMP } from "./doc-figure/clamp";

const SPAN: TraceSpan = {
	id: "shell-span",
	title: "Resolved prompt",
	startTime: new Date("2026-07-27T12:00:00.000Z"),
	endTime: new Date("2026-07-27T12:00:01.500Z"),
	duration: 1_500,
	type: "event",
	raw: "{}",
	status: "success",
	attributes: [
		{ key: "event_type", value: { stringValue: "system_prompt_resolved" } },
	],
};

describe("DetailShell", () => {
	test("uses the shared accessible modal surface for fit-to-viewport images", () => {
		const markup = renderToStaticMarkup(
			<DetailModalFrame
				block={null}
				image={{
					src: "/kernel/blobs/b1-image",
					alt: "image/png attachment",
				}}
				span={SPAN}
				onClose={() => {}}
				labelId="image-dialog-title"
			/>,
		);

		expect(markup).toContain('data-detail-modal-backdrop=""');
		expect(markup).toContain('data-detail-modal-kind="image"');
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain('aria-labelledby="image-dialog-title"');
		expect(markup).toContain(">image/png attachment<");
		expect(markup).toContain('aria-label="Close image/png attachment"');
		expect(markup).toContain('data-detail-image-modal-content=""');
		expect(markup).toContain("overflow-auto");
		expect(markup).toContain("h-auto w-auto max-h-full max-w-full object-contain");
		expect(markup).toContain('src="/kernel/blobs/b1-image"');
		expect(markup).toContain('alt="image/png attachment"');
	});

	test("renders the stable header and untabbed body with no bottom drawer", () => {
		const markup = renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={{
					blocks: [
						{
							id: "prompt",
							slot: "content",
							caption: "System prompt",
							body: "one\ntwo",
							language: "prompt",
							clamp: CLAMP.tall,
						},
					],
				}}
			/>,
		);

		const header = markup.slice(
			markup.indexOf("data-detail-header"),
			markup.indexOf("data-detail-body"),
		);
		expect(markup).toContain(">Resolved prompt<");
		expect(header).toContain("h-12");
		expect(header).toContain("border-b border-border");
		expect(header).toContain("bg-background");
		expect(header).toContain(
			"min-w-0 flex-1 truncate text-sm font-semibold text-foreground",
		);
		expect(header).toContain(">Details<");
		expect(header).toContain('aria-label="Details"');
		expect(header).toContain('aria-expanded="false"');
		expect(header).toMatch(/aria-controls="[^"]+-details-region"/);
		expect(header).not.toContain("system_prompt_resolved");
		expect(header).not.toContain(">1.5s<");
		expect(header).not.toContain("data-detail-type");
		expect(markup).not.toContain("data-detail-summary");
		expect(markup).toContain('data-detail-block="prompt"');
		expect(markup).toContain('data-detail-slot="content"');
		expect(markup).toContain('data-detail-clamp="tall"');
		expect(markup).toContain('data-detail-details-open="false"');
		expect(markup).not.toContain("data-details-drawer");
		expect(markup).not.toContain("data-details-view");
		expect(markup).not.toContain('data-details-section="timing"');
		expect(markup).not.toContain("ap-collapsible");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain('role="tablist"');
		expect(markup).not.toContain(">Primary<");
		expect(markup).not.toContain(">Metadata<");
	});

	test("renders Details as a full-panel takeover without unmounting the tab body", () => {
		const view = {
			tabs: [
				{
					id: "state",
					name: "State",
					blocks: [
						{
							id: "state",
							slot: "content" as const,
							caption: "State",
							body: "selected state",
						},
					],
				},
				{
					id: "context",
					name: "Context",
					blocks: [
						{
							id: "context",
							slot: "content" as const,
							caption: "Context",
							body: "context body",
						},
					],
				},
			],
		};
		const closed = renderToStaticMarkup(
			<DetailShellFrame
				span={SPAN}
				view={view}
				onOpenModal={() => {}}
			/>,
		);
		const open = renderToStaticMarkup(
			<DetailShellFrame
				span={SPAN}
				view={view}
				onOpenModal={() => {}}
				initialDetailsOpen
				initialActiveTabId="context"
			/>,
		);
		const openingTag = (markup: string, attribute: string) =>
			new RegExp(`<div[^>]*${attribute}[^>]*>`).exec(markup)?.[0] ?? "";

		expect(open).toContain('data-detail-details-open="true"');
		expect(open).toContain('aria-label="Close details"');
		expect(open).toContain('data-details-view=""');
		expect(open).toContain('data-details-region=""');
		expect(open).not.toContain("data-details-drawer");

		const closedHeader = openingTag(closed, 'data-detail-header=""');
		const openHeader = openingTag(open, 'data-detail-header=""');
		expect(openHeader).toBe(closedHeader);
		expect(openHeader).toContain("h-12");
		const closedControl =
			/<button[^>]*aria-label="Details"[^>]*>/.exec(closed)?.[0] ?? "";
		const openControl =
			/<button[^>]*aria-label="Close details"[^>]*>/.exec(open)?.[0] ?? "";
		for (const control of [closedControl, openControl]) {
			expect(control).toContain("h-7");
			expect(control).toContain("w-[3.75rem]");
		}
		const openHeaderMarkup = open.slice(
			open.indexOf('data-detail-header=""'),
			open.indexOf('data-detail-body=""'),
		);
		expect(openHeaderMarkup).toContain("data-detail-glyph");
		expect(openHeaderMarkup).toContain(">Resolved prompt<");

		const hiddenBody = openingTag(open, 'data-detail-body=""');
		expect(hiddenBody).toContain('hidden=""');
		expect(hiddenBody).toContain('aria-hidden="true"');
		expect(hiddenBody).toContain('data-detail-active-tab="context"');
		expect(open).toContain('data-detail-tab-trigger="state"');
		expect(open).toContain('data-detail-tab-trigger="context"');
		expect(open).toContain('data-detail-block="state"');
		expect(open).toContain('data-detail-block="context"');
		expect(open).toMatch(
			/data-detail-tab-trigger="state"[^>]*aria-selected="false"/,
		);
		expect(open).toMatch(
			/data-detail-tab-trigger="context"[^>]*aria-selected="true"/,
		);
	});

	test("gives an open modal Escape precedence over the Details takeover", () => {
		expect(shouldCloseDetailsOnEscape(true, false)).toBe(true);
		expect(shouldCloseDetailsOnEscape(true, true)).toBe(false);
		expect(shouldCloseDetailsOnEscape(false, false)).toBe(false);
		expect(shouldCloseDetailsOnEscape(false, true)).toBe(false);
	});

	test("orders body blocks by slot, order, then id", () => {
		const markup = renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={{
					blocks: [
						{ id: "media", slot: "media", caption: "Media", node: "M" },
						{ id: "output", slot: "output", caption: "Output", body: "O" },
						{ id: "content", slot: "content", caption: "Content", body: "C" },
						{ id: "input", slot: "input", caption: "Input", body: "I" },
					],
				}}
			/>,
		);
		const positions = ["input", "content", "output", "media"].map((id) =>
			markup.indexOf(`data-detail-block="${id}"`),
		);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	test("owns tab semantics, first-tab default, and per-tab block ordering", () => {
		const markup = renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={{
					tabs: [
						{
							id: "state",
							name: "State",
							blocks: [
								{
									id: "state-media",
									slot: "media",
									caption: "State media",
									node: "M",
								},
								{
									id: "state-input",
									slot: "input",
									caption: "State input",
									body: "I",
								},
							],
						},
						{
							id: "context",
							name: "Context",
							blocks: [
								{
									id: "context-output",
									slot: "output",
									caption: "Context output",
									body: "O",
								},
								{
									id: "context-content",
									slot: "content",
									caption: "Context content",
									body: "C",
								},
							],
						},
						{
							id: "system",
							name: "System prompt",
							blocks: [
								{
									id: "system-prompt",
									slot: "content",
									caption: "System prompt",
									body: "S",
								},
							],
						},
					],
				}}
			/>,
		);

		expect(markup).toContain('data-detail-active-tab="state"');
		expect(markup).toContain('role="tablist"');
		const tablistTag =
			/<div[^>]*role="tablist"[^>]*>/.exec(markup)?.[0] ?? "";
		expect(tablistTag).toContain("border border-border");
		expect(tablistTag).toContain("bg-muted");
		expect(markup.match(/role="tab"/g)?.length).toBe(3);
		expect(markup.match(/role="tabpanel"/g)?.length).toBe(3);
		expect(markup).toMatch(
			/role="tab"[^>]*data-detail-tab-trigger="state"[^>]*aria-selected="true"/,
		);
		expect(markup).toMatch(
			/role="tab"[^>]*data-detail-tab-trigger="context"[^>]*aria-selected="false"/,
		);
		const stateTabTag =
			/<button[^>]*data-detail-tab-trigger="state"[^>]*>/.exec(markup)?.[0] ??
			"";
		const contextTabTag =
			/<button[^>]*data-detail-tab-trigger="context"[^>]*>/.exec(markup)?.[0] ??
			"";
		expect(stateTabTag).toContain("bg-status-info-fill");
		expect(stateTabTag).toContain("text-status-info");
		expect(stateTabTag).not.toContain("text-muted-foreground");
		expect(contextTabTag).toContain("bg-muted");
		expect(contextTabTag).toContain("text-muted-foreground");
		expect(contextTabTag).not.toContain("bg-status-info-fill");
		expect(contextTabTag).not.toContain("text-status-info");
		const statePanelTag =
			/<div[^>]*role="tabpanel"[^>]*data-detail-tab="state"[^>]*>/.exec(
				markup,
			)?.[0] ?? "";
		const contextPanelTag =
			/<div[^>]*role="tabpanel"[^>]*data-detail-tab="context"[^>]*>/.exec(
				markup,
			)?.[0] ?? "";
		expect(statePanelTag).not.toContain("hidden");
		expect(contextPanelTag).toContain('hidden=""');

		const stateStart = markup.indexOf('data-detail-tab="state"');
		const contextStart = markup.indexOf('data-detail-tab="context"');
		const systemStart = markup.indexOf('data-detail-tab="system"');
		const statePanel = markup.slice(stateStart, contextStart);
		const contextPanel = markup.slice(contextStart, systemStart);
		expect(statePanel.indexOf('data-detail-block="state-input"')).toBeLessThan(
			statePanel.indexOf('data-detail-block="state-media"'),
		);
		expect(
			contextPanel.indexOf('data-detail-block="context-content"'),
		).toBeLessThan(
			contextPanel.indexOf('data-detail-block="context-output"'),
		);
	});

	test("rejects DetailViews with both or neither body form in development", () => {
		expect(() =>
			renderToStaticMarkup(
					<DetailShell
						span={SPAN}
						view={{
							blocks: [],
						tabs: [{ id: "state", name: "State", blocks: [] }],
					}}
				/>,
			),
		).toThrow("exactly one of blocks or tabs");

		expect(() =>
			renderToStaticMarkup(
				<DetailShell span={SPAN} view={{}} />,
			),
		).toThrow("exactly one of blocks or tabs");
	});

	test("renders the shell-owned modal affordance only for long clamped blocks", () => {
		const body = JSON.stringify(
			Object.fromEntries(
				Array.from({ length: 100 }, (_, index) => [
					`argument_${index + 1}`,
					index + 1,
				]),
			),
			null,
			2,
		);
		const markup = renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={{
					blocks: [
						{
							id: "tool:call",
							slot: "input",
							caption: "Input",
							body,
							language: "json",
							clamp: CLAMP.block,
						},
						{
							id: "short",
							slot: "content",
							caption: "Short",
							body: "fits",
							clamp: CLAMP.block,
						},
					],
				}}
			/>,
		);

		const longStart = markup.indexOf('data-detail-block="tool:call"');
		const shortStart = markup.indexOf('data-detail-block="short"');
		const longBlock = markup.slice(longStart, shortStart);
		const shortBlock = markup.slice(shortStart);
		expect(longBlock).toContain('data-doc-language="json"');
		expect(longBlock).toContain('data-detail-modal-trigger=""');
		expect(longBlock).toContain('aria-label="Expand Input"');
		expect(longBlock).toContain(">⤢<");
		expect(longBlock.indexOf("data-detail-modal-trigger")).toBeLessThan(
			longBlock.indexOf("data-doc-body"),
		);
		expect(longBlock).toContain("argument_100");
		expect(shortBlock).not.toContain('data-detail-modal-trigger=""');
		expect(markup.match(/data-detail-modal-trigger=/g)?.length).toBe(1);
		expect(markup).not.toContain(["Open", "in modal"].join(" "));
		expect(markup).not.toContain('role="dialog"');
	});

	test("contains the 471-character state line in the figure scroller, not the panel", () => {
		const longLine = "A system diagram showing how interview inputs drive an AI-led question loop. The agent asks and adapts questions, records interview context in the **Memory Bank**, evaluates whether responses satisfy the research objective, and routes outcomes either toward the next question or a probing response. Within the Memory Bank, actions create, update, delete, or preserve memory, while **Retrieval: per-question recall** shows how stored context is recalled for each question.";
		expect(longLine.length).toBe(471);
		const markup = renderToStaticMarkup(
			<DetailShell
				span={SPAN}
				view={{
					blocks: [
						{
							id: "turn:state",
							slot: "content",
							caption: "State",
							body: longLine,
							language: "xml",
							clamp: CLAMP.tall,
						},
					],
				}}
			/>,
		);
		const rootTag =
			/<div[^>]*data-detail-root=""[^>]*>/.exec(markup)?.[0] ?? "";
		const panelBodyTag =
			/<div[^>]*data-detail-body=""[^>]*>/.exec(markup)?.[0] ?? "";
		const figureBodyTag =
			/<div[^>]*data-doc-body=""[^>]*data-doc-gutter=""[^>]*>/.exec(markup)?.[0] ??
			"";

		expect(rootTag).toContain("min-w-0");
		expect(rootTag).toContain("overflow-hidden");
		expect(panelBodyTag).toContain("min-w-0");
		expect(panelBodyTag).toContain("overflow-x-hidden");
		expect(figureBodyTag).toContain("min-w-0");
		expect(figureBodyTag).toContain("max-w-full");
		expect(figureBodyTag).toContain("overflow-x-auto");
		expect(figureBodyTag).toContain("whitespace-pre");
		expect(markup).toContain('data-doc-line-number=""');
		expect(markup).toContain("A system diagram showing how interview inputs drive");
		expect(markup).toContain("Retrieval: per-question recall");
	});

	test("force-mounts collapsed blocks with caption-only chrome and their complete SSR preview", () => {
		const body = Array.from(
			{ length: 100 },
			(_, index) => `line ${index + 1}`,
		).join("\n");
		const view = {
			blocks: [
				{
					id: "turn:system",
					slot: "content" as const,
					caption: "System prompt",
					body,
					clamp: CLAMP.block,
					collapsible: true,
					defaultOpen: false,
					turnSection: "system" as const,
				},
			],
		};
		const markup = renderToStaticMarkup(
			<DetailShellFrame
				span={SPAN}
				view={view}
				blocks={view.blocks}
				onOpenModal={() => {}}
			/>,
		);

		expect(markup).toContain('data-detail-block="turn:system"');
		expect(markup).toContain('data-turn-section="system"');
		expect(markup).toContain('data-block-open="false"');
		expect(markup).toContain('aria-label="Show System prompt"');
		expect(markup).toContain('aria-label="Expand System prompt"');
		expect(markup).toContain('class="ap-collapsible"');
		expect(markup).toContain('data-state="closed"');
		expect(markup).toContain(">System prompt<");
		expect(markup).not.toContain(">100 lines<");
		expect(markup).toContain("line 1");
		expect(markup).toContain("line 100");
		expect(markup).toContain('data-detail-modal-trigger=""');
		expect(markup).toContain(">⤢<");
		expect(markup.indexOf("data-detail-modal-trigger")).toBeLessThan(
			markup.indexOf('class="ap-collapsible"'),
		);
		expect(markup).not.toContain(["Open", "in modal"].join(" "));
		expect(markup).not.toContain("data-detail-isolated");
		expect(markup).not.toContain("data-detail-breadcrumb");
		expect(markup).not.toContain('role="dialog"');
	});
});
