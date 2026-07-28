import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	TraceSpan,
	TraceSpanAttribute,
} from "@evilmartians/agent-prism-types";

import { DetailShell } from "../DetailShell";
import { DetailsView } from "../DetailsView";
import { FactCard } from "./FactCard";
import { buildSnapshotContextView } from "./TurnBody";

const DEAD_END_COPY = ["No input or output", " for this event."].join("");

function stringAttr(key: string, value: string): TraceSpanAttribute {
	return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): TraceSpanAttribute {
	return { key, value: { intValue: String(value) } };
}

function boolAttr(key: string, value: boolean): TraceSpanAttribute {
	return { key, value: { boolValue: value } };
}

function span(
	eventType: string,
	attributes: TraceSpanAttribute[] = [],
	overrides: Partial<TraceSpan> = {},
): TraceSpan {
	return {
		id: `fact-${eventType}`,
		title: eventType,
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:00.010Z"),
		duration: 10,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [stringAttr("event_type", eventType), ...attributes],
		...overrides,
	};
}

const FORMER_DEAD_ENDS: Array<{
	eventType: string;
	attributes: TraceSpanAttribute[];
	expectedContent: string;
}> = [
	{
		eventType: "context_input_resolved",
		attributes: [
			stringAttr("loader_kind", "capabilities"),
			stringAttr("input_ref", "capabilities"),
			stringAttr("status", "ok"),
			intAttr("bytes", 11_635),
			boolAttr("from_cache", false),
		],
		expectedContent: "Loaded capabilities · 11.4 KB · fresh",
	},
	{
		eventType: "agent_session_start",
		attributes: [
			stringAttr("agent_name", "layout-editor"),
			stringAttr("model_alias", "codex-lb"),
			stringAttr("model", "gpt-5.6-sol"),
		],
		expectedContent:
			"Session started · layout-editor · codex-lb/gpt-5.6-sol",
	},
	{
		eventType: "agent_run_start",
		attributes: [stringAttr("agent_name", "layout-editor")],
		expectedContent: "Run started · layout-editor",
	},
	{
		eventType: "agent_run_end",
		attributes: [
			stringAttr("agent_name", "layout-editor"),
			stringAttr("status", "ok"),
		],
		expectedContent: "Run ended · layout-editor · ok",
	},
	{
		eventType: "pi_agent_start",
		attributes: [stringAttr("agent_name", "layout-editor")],
		expectedContent: "Agent started · layout-editor",
	},
	{
		eventType: "pi_agent_end",
		attributes: [
			stringAttr("agent_name", "layout-editor"),
			stringAttr("status", "ok"),
		],
		expectedContent: "Agent ended · layout-editor · ok",
	},
	{
		eventType: "pi_turn_start",
		attributes: [intAttr("turn_number", 1)],
		expectedContent: "Turn 1 started",
	},
	{
		eventType: "pi_turn_end",
		attributes: [
			intAttr("turn_number", 1),
			stringAttr("stop_reason", "toolUse"),
		],
		expectedContent: "Turn 1 ended · stopped on toolUse",
	},
];

describe("FactCard", () => {
	test("SSR-renders a non-empty standard Facts block for every former dead end", () => {
		for (const fixture of FORMER_DEAD_ENDS) {
			const fixtureSpan = span(fixture.eventType, fixture.attributes);
			const view = FactCard({
				span: fixtureSpan,
			});
			const blocks = view.blocks ?? [];

			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toMatchObject({
				id: "facts",
				slot: "content",
				caption: "Facts",
			});
			const markup = renderToStaticMarkup(
				<DetailShell span={fixtureSpan} view={view} />,
			);
			const bodyMarkup = markup.slice(markup.indexOf('data-detail-body=""'));
			expect(bodyMarkup).toContain('data-detail-block="facts"');
			expect(bodyMarkup).toContain(">Facts<");
			expect(bodyMarkup).toContain(fixture.expectedContent);
			expect(bodyMarkup).not.toContain(DEAD_END_COPY);
		}
	});

	test("maps genuine generic input and output into standard source blocks", () => {
		const view = FactCard({
			span: span(
				"custom_app_event",
				[stringAttr("operation", "synchronize")],
				{
					input: '{"target":"board","revision":3}',
					output: "applied",
				},
			),
		});

		expect(view.blocks).toEqual([
			expect.objectContaining({
				id: "input",
				slot: "input",
				caption: "Input",
				// JSON data blocks render canonically pretty-printed.
				body: '{\n  "target": "board",\n  "revision": 3\n}',
				language: "json",
			}),
			expect.objectContaining({
				id: "facts",
				slot: "content",
				caption: "Facts",
			}),
			expect.objectContaining({
				id: "output",
				slot: "output",
				caption: "Output",
				body: "applied",
				language: "text",
			}),
		]);
		const factsMarkup = renderToStaticMarkup(<>{view.blocks?.[1]?.node}</>);
		expect(factsMarkup).toContain("Custom App Event");
		expect(factsMarkup).toContain("Operation: synchronize");
		expect(
			renderToStaticMarkup(
				<>
					{(view.blocks ?? []).map((block) => (
						<div key={block.id}>{block.body ?? block.node}</div>
					))}
				</>,
			),
		).not.toContain(DEAD_END_COPY);
	});

	test("keeps standalone and turn system-prompt block presentation in sync", () => {
		const prompt = "You are the layout editor.\nKeep the board coherent.";
		const standaloneSpan = span("system_prompt_resolved", [], {
			output: prompt,
		});
		const standaloneView = FactCard({ span: standaloneSpan });
		const standalone = standaloneView.blocks?.find(
			(block) => block.id === "system-prompt",
		);
		const turn = buildSnapshotContextView({
			systemPrompt: prompt,
			messages: [],
			sections: null,
			apiBase: "",
		}).tabs?.find((tab) => tab.id === "system")?.blocks.find(
			(block) => block.id === "turn:system",
		);
		const presentation = (block: typeof standalone | undefined) => ({
			caption: block?.caption,
			language: block?.language,
			clamp: block?.clamp,
		});

		expect(standalone?.id).toBe("system-prompt");
		expect(standalone?.turnSection).toBeUndefined();
		expect(turn).toBeDefined();
		expect(presentation(standalone)).toEqual(presentation(turn));

		const markup = renderToStaticMarkup(
			<DetailShell span={standaloneSpan} view={standaloneView} />,
		);
		expect(markup).not.toContain("data-turn-section");
	});

	test("keeps hashes and token values in Details, outside the main read", () => {
		const promptHash =
			"prompt:0123456789abcdef0123456789abcdef0123456789abcdef";
		const contentHash =
			"content:fedcba9876543210fedcba9876543210fedcba9876543210";
		const technicalSpan = span("generic_checkpoint", [
			stringAttr("operation", "checkpoint"),
			stringAttr("prompt_hash", promptHash),
			stringAttr("content_hash", contentHash),
			intAttr("input_tokens", 8_765_432),
			intAttr("output_tokens", 1_234_567),
		]);
		const markup = renderToStaticMarkup(
			<DetailShell span={technicalSpan} view={FactCard({ span: technicalSpan })} />,
		);
		const detailsMarkup = renderToStaticMarkup(
			<DetailsView span={technicalSpan} />,
		);
		const bodyStart = markup.indexOf("data-detail-body");
		expect(bodyStart).toBeGreaterThan(-1);

		const bodyMarkup = markup.slice(bodyStart);
		expect(markup).not.toContain("data-details-drawer");
		for (const technicalValue of [
			promptHash,
			contentHash,
			"8,765,432",
			"1,234,567",
		]) {
			expect(detailsMarkup).toContain(technicalValue);
			expect(bodyMarkup).not.toContain(technicalValue);
		}
		expect(bodyMarkup).not.toContain("prompt_hash");
		expect(bodyMarkup).not.toContain("content_hash");
		expect(bodyMarkup).not.toContain(DEAD_END_COPY);
	});
});
