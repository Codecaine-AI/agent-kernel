import { describe, expect, test } from "bun:test";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import { callErrorRows, callOutcome, callSummaryRows, outputFields } from "./utils";

function rowsByKey(rows: Array<{ key: string; value: string }>): Record<string, string> {
	return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

describe("CallBody utils", () => {
	test("the summary reads function, engine, transport, model, prompt hash, timing and usage off the row", () => {
		expect(rowsByKey(callSummaryRows(fixtureSpan("call")))).toEqual({
			function_name: "ExtractCheckpointKnowledge",
			engine: "baml",
			transport: "baml-http",
			model: "openai/gpt-5.4-mini",
			prompt_hash: "baml1-2c9e",
			status: "ok",
			attempts: "1",
			duration: "1.8 s",
			tokens: "1,204 in · 88 out",
			cost: "$0.0012",
			trigger: "post-run",
			request_id: "req-K",
		});
	});

	test("a retried call's node row says which attempt it shows; an attempt row says which it is", () => {
		expect(rowsByKey(callSummaryRows(fixtureSpan("retriedCall"))).attempts).toBe("2 (showing attempt 2)");
		expect(rowsByKey(callSummaryRows(fixtureSpan("retriedCallAttempt1"))).attempts).toBe("1 of 2");
	});

	test("outcome and error rows: a parse failure, and a stale attempt aborted as abandoned", () => {
		const failed = fixtureSpan("failedCall");
		expect(callOutcome(failed)).toBe("error");
		expect(rowsByKey(callErrorRows(failed))).toEqual({
			error_kind: "parse",
			error_message: "expected object at $.advisories",
		});

		const stale = fixtureSpan("retriedCallAttempt1");
		expect(callOutcome(stale)).toBe("aborted");
		expect(rowsByKey(callErrorRows(stale)).error_kind).toBe("abandoned");
	});

	test("outputFields: one field per top-level key, nested values as compact JSON", () => {
		expect(
			outputFields(JSON.stringify({ kept: ["A1"], note: "cast is safe", count: 2, done: true, extra: null })),
		).toEqual([
			{ key: "kept", value: '["A1"]', nested: true },
			{ key: "note", value: "cast is safe", nested: false },
			{ key: "count", value: "2", nested: false },
			{ key: "done", value: "true", nested: false },
			{ key: "extra", value: "null", nested: false },
		]);
		expect(outputFields("[1,2]")).toEqual([{ key: "value", value: "[1,2]", nested: true }]);
		expect(outputFields('"just text"')).toEqual([{ key: "value", value: "just text", nested: false }]);
		expect(outputFields("not json")).toBeNull();
	});
});
