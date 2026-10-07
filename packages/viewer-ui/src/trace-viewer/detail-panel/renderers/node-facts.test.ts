import { describe, expect, test } from "bun:test";

import { classifyNodeInput } from "./node-facts";

describe("classifyNodeInput", () => {
	test("the kernel's claim-time placeholders are status, matched by their exact shape", () => {
		expect(classifyNodeInput(JSON.stringify({ pending: true }))).toEqual({
			kind: "not-recorded",
			reason: "Input not recorded: the run ended before its final input was written.",
		});
		expect(classifyNodeInput(JSON.stringify({ omitted: "arguments are not recorded when the route fails" }))).toEqual({
			kind: "not-recorded",
			reason: "Input not recorded: arguments are not recorded when the route fails.",
		});
		expect(classifyNodeInput(JSON.stringify({ pending: true, redacted: { checkpoint: "cp-7" } }))).toEqual({
			kind: "claim-time",
			value: { checkpoint: "cp-7" },
		});
	});

	test("anything else is real input, including near misses and older start contexts", () => {
		for (const text of [
			JSON.stringify({ pending: true, state: { advisory: "A1" } }),
			JSON.stringify({ pending: false }),
			JSON.stringify({ pending: "yes" }),
			JSON.stringify({ omitted: 3 }),
			JSON.stringify({ state: { advisory: "A1" }, questions: [] }),
			JSON.stringify([{ pending: true }]),
			"plain text",
		]) {
			expect(classifyNodeInput(text)).toEqual({ kind: "recorded" });
		}
	});
});
