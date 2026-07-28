/**
 * BoardRenderBody — the "app:board-render" detail body. Online it shows the
 * board facts and fetches the raster thumbnail through the blob route (click
 * opens the shell modal); offline it degrades to a plain pointer at the blob
 * store. The tree rows never render the image — only this panel does, and
 * only once the row is selected.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan, TraceSpanAttribute } from "@evilmartians/agent-prism-types";

import { SpanDetailPanel } from "../../SpanDetailPanel";
import { TraceViewerApiContext } from "../TraceViewerApiContext";

const BLOB_HASH = "b1-0123456789abcdef";
const API_BASE = "http://localhost:4319";

function stringAttr(key: string, value: string): TraceSpanAttribute {
	return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): TraceSpanAttribute {
	return { key, value: { intValue: String(value) } };
}

function boardRenderSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
	return {
		id: "evt-board-render-1",
		title: "board render #3",
		startTime: new Date("2026-07-28T00:00:00.000Z"),
		endTime: new Date("2026-07-28T00:00:00.000Z"),
		duration: 0,
		type: "event",
		status: "success",
		raw: "{}",
		attributes: [
			stringAttr("event_type", "app:board-render"),
			stringAttr("blob_hash", BLOB_HASH),
			stringAttr("mime_type", "image/png"),
			intAttr("byte_length", 20480),
			intAttr("n", 3),
			stringAttr("summary", "aligned the auth column"),
			intAttr("turn", 5),
			intAttr("turn_number", 4),
		],
		...overrides,
	};
}

function renderOnline(span: TraceSpan): string {
	return renderToStaticMarkup(
		<TraceViewerApiContext.Provider value={{ apiBase: API_BASE }}>
			<SpanDetailPanel span={span} />
		</TraceViewerApiContext.Provider>,
	);
}

describe("BoardRenderBody", () => {
	test("shows the board facts and the blob-backed image when the API is configured", () => {
		const markup = renderOnline(boardRenderSpan());

		expect(markup).toContain("Board after change 3");
		expect(markup).toContain("Turn 4");
		expect(markup).toContain("aligned the auth column");

		// The image block fetches through the kernel blob route.
		expect(markup).toContain("<img");
		expect(markup).toContain(
			`${API_BASE}/kernel/blobs/${encodeURIComponent(BLOB_HASH)}`,
		);
		// It is the shared click-to-open modal trigger, not a bare inline image.
		expect(markup).toContain('data-detail-image-modal-trigger=""');
	});

	test("degrades to a blob-store pointer offline, with no image element", () => {
		const markup = renderToStaticMarkup(
			<SpanDetailPanel span={boardRenderSpan()} />,
		);

		expect(markup).not.toContain("<img");
		expect(markup).toContain("connect the trace read API");
		expect(markup).toContain(BLOB_HASH);
		expect(markup).toContain("Board after change 3");
	});

	test("a payload-less span still renders a non-empty facts body", () => {
		const markup = renderOnline(
			boardRenderSpan({
				attributes: [stringAttr("event_type", "app:board-render")],
			}),
		);

		expect(markup).toContain("Board render");
		expect(markup).not.toContain("<img");
	});
});
