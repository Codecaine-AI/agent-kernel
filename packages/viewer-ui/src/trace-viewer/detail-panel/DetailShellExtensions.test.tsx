import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { DetailBlocksProvider } from "./blocks";
import { DetailShell } from "./DetailShell";

const SPAN: TraceSpan = {
	id: "extension-span",
	title: "Tool",
	startTime: new Date(0),
	endTime: new Date(1),
	duration: 1,
	type: "tool_execution",
	raw: "{}",
	status: "success",
	attributes: [
		{ key: "event_type", value: { stringValue: "tool_call_end" } },
	],
};

describe("DetailShell extension merge", () => {
	test("merges extensions into the vocabulary order and lets body ids win", () => {
		const markup = renderToStaticMarkup(
			<DetailBlocksProvider
				provider={() => [
					{
						id: "canvas:renders",
						slot: "media",
						caption: "Renders",
						node: "THUMBS",
					},
					{
						id: "call",
						slot: "media",
						caption: "Colliding extension",
						node: "LOSES",
					},
					{
						id: "canvas:thinking",
						slot: "input",
						order: -10,
						caption: "Thinking",
						body: "reasoning",
					},
				]}
			>
				<DetailShell
					span={SPAN}
					view={{
						blocks: [
							{ id: "call", slot: "input", caption: "Call", body: "{}" },
							{ id: "result", slot: "output", caption: "Result", body: "ok" },
						],
					}}
				/>
			</DetailBlocksProvider>,
		);

		const ids = ["canvas:thinking", "call", "result", "canvas:renders"];
		const positions = ids.map((id) => markup.indexOf(`data-detail-block="${id}"`));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(markup).not.toContain("Colliding extension");
		expect(markup).not.toContain("LOSES");
	});

	test("merges extensions into the first tab only and sorts that tab", () => {
		const markup = renderToStaticMarkup(
			<DetailBlocksProvider
				provider={() => [
					{
						id: "canvas:renders",
						slot: "media",
						caption: "Renders",
						node: "THUMBS",
					},
					{
						id: "turn:state",
						slot: "output",
						caption: "Colliding extension",
						node: "LOSES",
					},
					{
						id: "canvas:thinking",
						slot: "input",
						caption: "Thinking",
						body: "reasoning",
					},
				]}
			>
				<DetailShell
					span={SPAN}
					view={{
						tabs: [
							{
								id: "state",
								name: "State",
								blocks: [
									{
										id: "turn:state",
										slot: "content",
										caption: "State",
										body: "moving parts",
									},
								],
							},
							{
								id: "context",
								name: "Context",
								blocks: [
									{
										id: "turn:context",
										slot: "content",
										caption: "Context",
										body: "context message",
									},
								],
							},
						],
					}}
				/>
			</DetailBlocksProvider>,
		);

		const stateStart = markup.indexOf('data-detail-tab="state"');
		const contextStart = markup.indexOf('data-detail-tab="context"');
		expect(stateStart).toBeGreaterThan(-1);
		expect(contextStart).toBeGreaterThan(stateStart);

		const firstTab = markup.slice(stateStart, contextStart);
		const positions = ["canvas:thinking", "turn:state", "canvas:renders"].map(
			(id) => firstTab.indexOf(`data-detail-block="${id}"`),
		);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(firstTab).not.toContain("Colliding extension");
		expect(firstTab).not.toContain("LOSES");

		const laterTabs = markup.slice(contextStart);
		expect(laterTabs).toContain('data-detail-block="turn:context"');
		expect(laterTabs).not.toContain('data-detail-block="canvas:thinking"');
		expect(laterTabs).not.toContain('data-detail-block="canvas:renders"');
	});
});
