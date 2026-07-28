/**
 * SSR regressions for the two spans used in the message-hierarchy live review.
 * The sibling trace database is always opened read-only and the tests skip when
 * that local capture is unavailable.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { GROUP_ACCENT } from "../../icons";
import { DetailShell } from "../DetailShell";
import { SECTION_LABEL_CLASS, SUBORDINATE_SECTION_LABEL_CLASS } from "../section-label";
import { buildSnapshotContextView } from "./TurnBody";
import { ToolBody } from "./ToolBody";
import type {
	RunTurnContextResponse,
	SanitizedMessage,
} from "./request-snapshot-api";
import { parseSectionTags } from "./turn-sections";
import { MESSAGE_ROLE_HEADER_CLASS } from "./turn/turn-block-content";

/** A kind band always has a wash; asserting through this keeps that true. */
function bandWash(group: keyof typeof GROUP_ACCENT): string {
	const wash = GROUP_ACCENT[group].wash;
	if (wash === undefined) throw new Error(`${group} band has no wash`);
	return wash;
}

const TRACE_DB_PATH = resolve(
	import.meta.dir,
	"../../../../../../../canvas/.agent-kernel/trace.db",
);
const CONTAINER_ID = "f172afdc-b39e-5d9d-b62a-729f8e29b2af";
const SESSION_ID = "019fa4f0-b02d-7f54-b007-5a4887e22543";
const TURN_EVENT_ID = "89e7644e-4923-4c62-b9c6-6eb699d827d1";
const TOOL_START_EVENT_ID = "805eba70-403d-17a1-fc55-81e5cd92e4df";
const TOOL_END_EVENT_ID = "7ab7e394-6f31-9fee-2f91-9bcda22ea40d";
const API_BASE = "http://localhost:4319";

interface EventRow {
	event_id: string;
	container_id: string;
	run_id: string | null;
	pi_session_id: string | null;
	span_id: string | null;
	timestamp: string;
	event_data: string;
}

interface SnapshotData {
	turn_number: number;
	system_prompt_blob_hash: string | null;
	prompt_hash: string | null;
	message_count: number;
	message_refs: Array<{ blob_hash: string; index: number }>;
	sections: RunTurnContextResponse["sections"];
}

function textBlob(data: unknown): string {
	if (typeof data === "string") return data;
	if (data instanceof Uint8Array) return new TextDecoder().decode(data);
	throw new Error("Expected trace blob data to be text");
}

function eventRow(db: Database, eventId: string): EventRow {
	const row = db
		.query<EventRow, [string, string, string]>(
			"select event_id, container_id, run_id, pi_session_id, span_id, timestamp, event_data from trace_events where event_id = ? and container_id = ? and pi_session_id = ?",
		)
		.get(eventId, CONTAINER_ID, SESSION_ID);
	if (!row) throw new Error(`Reviewed trace event ${eventId} is absent`);
	return row;
}

function reviewedTurn(db: Database): RunTurnContextResponse {
	const row = eventRow(db, TURN_EVENT_ID);
	const snapshot = JSON.parse(row.event_data) as SnapshotData;
	const blobQuery = db.query<{ data: unknown }, [string]>(
		"select data from trace_blobs where hash = ?",
	);
	const messageRefs = [...snapshot.message_refs].sort(
		(left, right) => left.index - right.index,
	);
	const messages = messageRefs.map(({ blob_hash }) => {
		const blob = blobQuery.get(blob_hash);
		if (!blob) throw new Error(`Reviewed message blob ${blob_hash} is absent`);
		return JSON.parse(textBlob(blob.data)) as SanitizedMessage;
	});
	const prompt = snapshot.system_prompt_blob_hash
		? blobQuery.get(snapshot.system_prompt_blob_hash)
		: null;
	if (snapshot.system_prompt_blob_hash && !prompt) {
		throw new Error(
			`Reviewed prompt blob ${snapshot.system_prompt_blob_hash} is absent`,
		);
	}
	return {
		run_id: row.run_id ?? "",
		turn_number: snapshot.turn_number,
		prompt_hash: snapshot.prompt_hash,
		system_prompt: prompt ? textBlob(prompt.data) : null,
		message_count: snapshot.message_count,
		messages,
		sections: snapshot.sections,
	};
}

function reviewedToolSpan(db: Database): TraceSpan {
	const start = eventRow(db, TOOL_START_EVENT_ID);
	const end = eventRow(db, TOOL_END_EVENT_ID);
	const call = JSON.parse(start.event_data) as {
		tool_use_id: string;
		tool_name: string;
		tool_input: unknown;
	};
	const result = JSON.parse(end.event_data) as {
		tool_use_id: string;
		tool_name: string;
		tool_output: string;
	};
	if (call.tool_use_id !== result.tool_use_id || start.span_id !== end.span_id) {
		throw new Error("Reviewed tool start/end pair no longer matches");
	}
	const startedAt = new Date(start.timestamp);
	const endedAt = new Date(end.timestamp);
	return {
		id: start.span_id ?? call.tool_use_id,
		title: call.tool_name,
		startTime: startedAt,
		endTime: endedAt,
		duration: endedAt.getTime() - startedAt.getTime(),
		type: "tool_execution",
		raw: JSON.stringify({ start: JSON.parse(start.event_data), end: result }),
		status: "success",
		input: JSON.stringify(call.tool_input),
		output: result.tool_output,
		attributes: [
			{ key: "event_type", value: { stringValue: "tool_call_end" } },
			{ key: "tool_name", value: { stringValue: call.tool_name } },
			{ key: "tool_use_id", value: { stringValue: call.tool_use_id } },
		],
	};
}

function turnSpan(context: RunTurnContextResponse): TraceSpan {
	return {
		id: TURN_EVENT_ID,
		title: `Turn ${context.turn_number}`,
		startTime: new Date("2026-07-27T18:58:15.994Z"),
		endTime: new Date("2026-07-27T18:58:15.994Z"),
		duration: 0,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [
			{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
			{ key: "turn_number", value: { intValue: String(context.turn_number) } },
		],
	};
}

function count(markup: string, needle: string): number {
	return markup.split(needle).length - 1;
}

function messageMarkup(markup: string, index: number): string {
	const marker = `data-message-index="${index}"`;
	const markerIndex = markup.indexOf(marker);
	if (markerIndex < 0) throw new Error(`Message ${index} was not rendered`);
	const start = markup.lastIndexOf("<article", markerIndex);
	const end = markup.indexOf("</article>", markerIndex);
	return markup.slice(start, end + "</article>".length);
}

function detailBlockMarkup(markup: string, id: string): string {
	const markerIndex = markup.indexOf(`data-detail-block="${id}"`);
	if (markerIndex < 0) throw new Error(`Detail block ${id} was not rendered`);
	const start = markup.lastIndexOf("<section", markerIndex);
	const end = markup.indexOf("</section>", markerIndex);
	return markup.slice(start, end + "</section>".length);
}

describe("live-reviewed message hierarchy", () => {
	test.skipIf(!existsSync(TRACE_DB_PATH))(
		"SSR nests the real Turn 4 assistant and image-elided result as bounded messages",
		() => {
			const db = new Database(TRACE_DB_PATH, { readonly: true });
			try {
				const context = reviewedTurn(db);
				expect(context.turn_number).toBe(4);
				expect(context.message_count).toBe(13);
				expect(context.sections).toEqual([
					{ kind: "context", start: 0, end: 1 },
					{ kind: "state", start: 1, end: 3 },
					{ kind: "tail", start: 3, end: 13 },
				]);
				expect(context.messages[4]?.role).toBe("assistant");
				expect(context.messages[5]?.role).toBe("toolResult");

				const markup = renderToStaticMarkup(
					<DetailShell
						span={turnSpan(context)}
						view={buildSnapshotContextView({
							systemPrompt: context.system_prompt,
							messages: context.messages,
							sections: parseSectionTags(context.sections),
							apiBase: API_BASE,
						})}
					/>,
				);
				const stateStart = markup.indexOf('data-detail-tab="state"');
				const contextStart = markup.indexOf('data-detail-tab="context"');
				const stateMarkup = markup.slice(stateStart, contextStart);
				const tailMarkup = stateMarkup.slice(
					stateMarkup.indexOf('data-turn-subsection="tail"'),
				);
				const assistant = messageMarkup(stateMarkup, 4);
				const toolResult = messageMarkup(stateMarkup, 5);

				expect(markup).toContain('data-detail-active-tab="state"');
				expect(stateMarkup).toContain('data-turn-subsection="tail"');
				expect(count(tailMarkup, "data-message-index=")).toBe(10);
				// Real messages wear the tree's card chrome: group band + corner cap.
				expect(assistant).toContain(GROUP_ACCENT.assistant.border);
				expect(assistant).toContain(bandWash("assistant"));
				expect(assistant).toContain('aria-label="Assistant message"');
				expect(assistant).toContain('data-message-role-header=""');
				expect(assistant).toContain(MESSAGE_ROLE_HEADER_CLASS);
				expect(assistant).toContain("text-trace-assistant");
				expect(assistant).toContain('data-message-blocks=""');
				expect(count(assistant, 'data-doc-caption-tier="subordinate"')).toBe(3);
				expect(assistant).toContain(SUBORDINATE_SECTION_LABEL_CLASS);

				expect(toolResult).toContain(GROUP_ACCENT.tool.border);
				expect(toolResult).toContain(bandWash("tool"));
				expect(toolResult).toContain('aria-label="Tool result message"');
				expect(toolResult).toContain("text-trace-tool");
				expect(count(toolResult, 'data-doc-figure=""')).toBe(1);
				expect(count(toolResult, 'data-doc-caption-tier="subordinate"')).toBe(1);
				expect(count(toolResult, 'data-doc-line-number=""')).toBe(4);
				expect(toolResult).toContain('data-image-elision-placeholder=""');
				expect(toolResult).toContain("text-muted-foreground/70");
				expect(toolResult).toContain("[image elided — image/png, 79.7 KB]");
			} finally {
				db.close();
			}
		},
	);

	test.skipIf(!existsSync(TRACE_DB_PATH))(
		"SSR keeps the real add_connection Call and Result captions at the top tier",
		() => {
			const db = new Database(TRACE_DB_PATH, { readonly: true });
			try {
				const span = reviewedToolSpan(db);
				expect(span.title).toBe("add_connection");
				expect(span.duration).toBe(399);
				const markup = renderToStaticMarkup(
					<DetailShell span={span} view={ToolBody({ span })} />,
				);
				const call = detailBlockMarkup(markup, "tool:call");
				const result = detailBlockMarkup(markup, "tool:result");

				expect(call).toContain('data-doc-caption-tier="top"');
				expect(result).toContain('data-doc-caption-tier="top"');
				expect(call).toContain(SECTION_LABEL_CLASS);
				expect(result).toContain(SECTION_LABEL_CLASS);
				expect(call).not.toContain('data-doc-caption-tier="subordinate"');
				expect(result).not.toContain('data-doc-caption-tier="subordinate"');
				expect(SECTION_LABEL_CLASS).toContain("text-[11px]");
				expect(SECTION_LABEL_CLASS).toContain("font-semibold");
				expect(MESSAGE_ROLE_HEADER_CLASS).toContain("text-[11px]");
				expect(MESSAGE_ROLE_HEADER_CLASS).toContain("font-semibold");
				expect(call).toContain('data-doc-line-number=""');
				expect(result).toContain('data-doc-line-number=""');
				expect(call).toContain("conn-memory-sticky-to-retrieval");
				expect(result).toContain("APPLIED · add_connection");
			} finally {
				db.close();
			}
		},
	);
});
