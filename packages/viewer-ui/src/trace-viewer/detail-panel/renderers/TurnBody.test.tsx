import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { SpanDetailPanel } from "../../SpanDetailPanel";
import { DetailsView } from "../DetailsView";
import { TurnBody } from "./TurnBody";

const OFFLINE_SPAN: TraceSpan = {
	id: "turn-offline",
	title: "Turn 4",
	startTime: new Date("2026-07-27T12:00:00.000Z"),
	endTime: new Date("2026-07-27T12:00:01.000Z"),
	duration: 1_000,
	type: "event",
	raw: "{}",
	status: "success",
	input: JSON.stringify([
		{
			blob_hash: "b1-message-one",
			role: "user",
			index: 0,
			text_chars: 12,
			image_count: 2,
			tool_call_count: 0,
		},
		{
			blob_hash: "b1-message-two",
			role: "assistant",
			index: 1,
			text_chars: 8,
			image_count: 0,
			tool_call_count: 1,
		},
	]),
	attributes: [
		{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
		{ key: "turn_number", value: { intValue: "4" } },
		{ key: "message_count", value: { intValue: "2" } },
		{ key: "total_image_count", value: { intValue: "2" } },
		{ key: "prompt_hash", value: { stringValue: "pk1-technical" } },
	],
};

describe("TurnBody offline path", () => {
	const markup = renderToStaticMarkup(<SpanDetailPanel span={OFFLINE_SPAN} />);
	const detailsMarkup = renderToStaticMarkup(<OfflineTurnDetails />);

	test("places the tabs directly below the header with a non-empty default body", () => {
		expect(markup).not.toContain("data-detail-summary");
		expect(markup).toContain("The full request context is unavailable in this viewer.");
		expect(markup).toContain('data-detail-block="turn:context-unavailable"');
		expect(markup).toContain('data-detail-block="turn:state-unavailable"');
	});

	test("still uses the exact four-tab Turn contract with State active", () => {
		const tabs = [...markup.matchAll(/data-detail-tab-trigger="([^"]+)"/g)].map(
			([, id]) => id,
		);
		expect(tabs).toEqual(["state", "context", "system", "tools"]);
		expect(markup).toContain('data-detail-active-tab="state"');
		expect(markup).toMatch(
			/data-detail-tab-trigger="state"[^>]*aria-selected="true"[^>]*>State<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="context"[^>]*>Context<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="system"[^>]*>System prompt<\/button>/,
		);
		expect(markup).toMatch(
			/data-detail-tab-trigger="tools"[^>]*>Tools<\/button>/,
		);
	});

	test("no tools blob hash reads as never captured, not as an empty toolbox", () => {
		expect(
			OFFLINE_SPAN.attributes?.some((attr) => attr.key === "tools_blob_hash"),
		).toBe(false);
		expect(markup).toContain('data-detail-block="turn:tools-not-captured"');
		expect(markup).toContain("Tool definitions were not captured for this trace.");
		expect(markup).not.toContain('data-detail-block="turn:tools-unavailable"');
		expect(markup).not.toContain('data-detail-block="turn:tools-empty"');
	});

	test("a captured tools blob reads as unreadable here, not as never captured", () => {
		const withBlob: TraceSpan = {
			...OFFLINE_SPAN,
			attributes: [
				...OFFLINE_SPAN.attributes!,
				{ key: "tools_blob_hash", value: { stringValue: "b1-tools" } },
			],
		};
		const blobMarkup = renderToStaticMarkup(<SpanDetailPanel span={withBlob} />);
		expect(blobMarkup).toContain('data-detail-block="turn:tools-unavailable"');
		expect(blobMarkup).toContain(
			"The request tool roster is unavailable in this viewer.",
		);
		expect(blobMarkup).not.toContain(
			'data-detail-block="turn:tools-not-captured"',
		);
	});

	test("moves message references to the full-panel details view", () => {
		const body = markup.slice(markup.indexOf('data-detail-body=""'));
		expect(body).not.toContain("Message references");
		expect(body).not.toContain("message_count");
		expect(body).not.toContain("total_image_count");
		expect(markup).not.toContain("data-details-drawer");
		expect(detailsMarkup).toContain("Message references");
		expect(detailsMarkup).toContain("message_count");
		expect(detailsMarkup).toContain("total_image_count");
		expect(detailsMarkup).toContain("data-details-view");
	});

	test("keeps hashes out of the main read", () => {
		const body = markup.slice(markup.indexOf('data-detail-body=""'));
		expect(body).not.toContain("pk1-technical");
		expect(detailsMarkup).toContain("pk1-technical");
	});

	test("does not add disclosures inside the Turn tabs", () => {
		const body = markup.slice(markup.indexOf('data-detail-body=""'));
		expect(body).not.toContain("data-block-open");
	});
});

function OfflineTurnDetails() {
	const view = TurnBody({ span: OFFLINE_SPAN });
	return <DetailsView span={OFFLINE_SPAN} extras={view.detailsExtras} />;
}
