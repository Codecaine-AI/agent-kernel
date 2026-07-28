/**
 * DetailShell.overflow.test — regression coverage for the reviewed Turn
 * overflow chain. The live-data case opens canvas's trace database read-only;
 * it is skipped when that sibling working tree is not present.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import { renderToStaticMarkup } from "react-dom/server";

import { DetailShell } from "./DetailShell";
import { buildSnapshotContextView } from "./renderers/TurnBody";
import type {
	RunTurnContextResponse,
	SanitizedMessage,
} from "./renderers/request-snapshot-api";
import { parseSectionTags } from "./renderers/turn-sections";

const TRACE_DB_PATH = resolve(
	import.meta.dir,
	"../../../../../../canvas/.agent-kernel/trace.db",
);
const REVIEWED_STATE_BLOB =
	"b1-50962fcffffb649fd58df1cca0ae7fd72978e0bc15bbf81325c04178de658b10";
const REVIEWED_PROMPT_BLOB =
	"b1-fe6f8cc5ac213753a991e46f45e7ff2867078b7594f79de0b4578f02fa328201";

const SPAN: TraceSpan = {
	id: "reviewed-turn",
	title: "Reviewed Turn",
	startTime: new Date("2026-07-27T18:58:15.000Z"),
	endTime: new Date("2026-07-27T18:58:16.000Z"),
	duration: 1_000,
	type: "event",
	raw: "{}",
	status: "success",
	attributes: [
		{ key: "event_type", value: { stringValue: "pi_request_snapshot" } },
	],
};

interface SnapshotData {
	turn_number: number;
	system_prompt_blob_hash: string;
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

function reviewedTurn(): RunTurnContextResponse {
	const sqlite = new Database(TRACE_DB_PATH, { readonly: true });
	try {
		const snapshotRow = sqlite
			.query<
				{ run_id: string; event_data: string },
				[string, string, string]
			>(
				"select run_id, event_data from trace_events where type = ? and event_data like ? and event_data like ? order by timestamp desc limit 1",
			)
			.get(
				"pi_request_snapshot",
				`%${REVIEWED_STATE_BLOB}%`,
				`%${REVIEWED_PROMPT_BLOB}%`,
			);
		if (!snapshotRow) throw new Error("Reviewed tagged Turn is absent");
		const snapshot = JSON.parse(snapshotRow.event_data) as SnapshotData;
		expect(snapshot.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 3 },
			{ kind: "tail", start: 3, end: 13 },
		]);
		expect(snapshot.system_prompt_blob_hash).toBe(REVIEWED_PROMPT_BLOB);

		const blobQuery = sqlite.query<{ data: unknown }, [string]>(
			"select data from trace_blobs where hash = ?",
		);
		const promptRow = blobQuery.get(snapshot.system_prompt_blob_hash);
		if (!promptRow) throw new Error("Reviewed system-prompt blob is absent");
		const messages = [...snapshot.message_refs]
			.sort((left, right) => left.index - right.index)
			.map(({ blob_hash }) => {
				const row = blobQuery.get(blob_hash);
				if (!row) throw new Error(`Reviewed message blob ${blob_hash} is absent`);
				return JSON.parse(textBlob(row.data)) as SanitizedMessage;
			});

		return {
			run_id: snapshotRow.run_id,
			turn_number: snapshot.turn_number,
			prompt_hash: snapshot.prompt_hash,
			system_prompt: textBlob(promptRow.data),
			message_count: snapshot.message_count,
			messages,
			sections: snapshot.sections,
		};
	} finally {
		sqlite.close();
	}
}

function openingTag(markup: string, attribute: string, value = ""): string {
	const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return (
		new RegExp(
			`<[^>]+${attribute}="${escapedValue}"[^>]*>`,
		).exec(markup)?.[0] ?? ""
	);
}

describe("reviewed Turn overflow chain", () => {
	test.skipIf(!existsSync(TRACE_DB_PATH))(
		"keeps the real 303-line prompt and 471-character state line reachable",
		() => {
			const context = reviewedTurn();
			const prompt = context.system_prompt ?? "";
			expect(new TextEncoder().encode(prompt)).toHaveLength(18_723);
			const state = (
				context.messages[1]?.content as Array<{ text?: string }> | undefined
			)?.[0]?.text;
			expect(prompt.split("\n")).toHaveLength(303);
			expect(state?.split("\n")).toHaveLength(123);
			const reviewedLine = state
				?.split("\n")
				.find((line) => line.length === 471);
			expect(reviewedLine).toHaveLength(471);

			const markup = renderToStaticMarkup(
				<DetailShell
					span={SPAN}
					view={buildSnapshotContextView({
						systemPrompt: prompt,
						messages: context.messages,
						sections: parseSectionTags(context.sections),
						apiBase: "http://localhost:4319",
					})}
				/>,
			);
			const columnScroller = openingTag(markup, "data-detail-body");
			const contextPanel = openingTag(markup, "data-detail-tab", "context");
			const systemPanel = openingTag(markup, "data-detail-tab", "system");
			const systemSection = openingTag(
				markup,
				"data-detail-block",
				"turn:system",
			);
			const systemStart = markup.indexOf('data-detail-block="turn:system"');
			const systemMarkup = markup.slice(
				systemStart,
				markup.indexOf("</section>", systemStart),
			);
			const systemFigure = openingTag(systemMarkup, "data-doc-figure");
			const systemFigureBody = openingTag(systemMarkup, "data-doc-body");

			expect(columnScroller).toContain("min-h-0");
			expect(columnScroller).toContain("min-w-0");
			expect(columnScroller).toContain("overflow-y-auto");
			expect(contextPanel).toContain("min-h-0");
			expect(contextPanel).toContain("min-w-0");
			expect(contextPanel).not.toContain("overflow-hidden");
			expect(systemPanel).toContain("min-h-0");
			expect(systemPanel).toContain("min-w-0");
			expect(systemPanel).not.toContain("overflow-hidden");
			expect(systemSection).toContain("min-h-0");
			expect(systemSection).toContain("min-w-0");
			expect(systemSection).not.toContain("overflow-hidden");
			expect(systemFigure).not.toContain("overflow-hidden");
			expect(systemFigureBody).toContain("min-w-0");
			expect(systemFigureBody).toContain("max-w-full");
			expect(systemFigureBody).toContain("overflow-x-auto");
			expect(systemFigureBody).toContain("whitespace-pre");

			expect(systemMarkup.match(/data-doc-line-number=""/g)).toHaveLength(303);
			expect(systemMarkup).toContain(">purpose<");
			expect(systemMarkup).toContain(
				"Current working directory: /Users/Ford/Github Repos/Codecaine/Core/canvas",
			);
			expect(markup).toContain(reviewedLine!);

			const captions = markup.match(/<figcaption[\s\S]*?<\/figcaption>/g) ?? [];
			expect(captions.length).toBeGreaterThan(0);
			for (const caption of captions) {
				expect(caption).not.toMatch(/\b\d[\d,]*\s+(?:line|lines|char|chars)\b/);
			}
			const expandControls =
				markup.match(/<button[^>]*data-detail-modal-trigger=""[^>]*>/g) ??
				[];
			expect(expandControls.length).toBeGreaterThan(0);
			for (const control of expandControls) {
				expect(control).toContain("size-6");
			}
		},
	);
});
