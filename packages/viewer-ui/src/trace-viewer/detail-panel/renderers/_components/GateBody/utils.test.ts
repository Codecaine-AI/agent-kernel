import { describe, expect, test } from "bun:test";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import { gateChecks, gateMetaLine, gateVerdictLabel, pillTone } from "./utils";

describe("GateBody utils", () => {
	test("one check per gate_end record, in order, with the decide check's questions", () => {
		const checks = gateChecks(fixtureSpan("gate"));
		expect(checks.map((check) => [check.name, check.kind, check.result, check.value])).toEqual([
			["justification:A1", "step", "pass", "true"],
			["judge:A1", "decide", "pass", undefined],
		]);
		expect(checks[1]?.questions).toEqual([
			{ question_id: "ok", result: "pass", run_id: "RD1", probability: 0.91, pass_at: 0.85, fail_at: 0.15 },
		]);
	});

	test("a gate without gate_end lists its planned checks as pending", () => {
		const open = { ...fixtureSpan("gate"), output: undefined };
		expect(gateChecks(open).map((check) => [check.name, check.result])).toEqual([
			["justification:A1", "pending"],
			["judge:A1", "pending"],
		]);
	});

	test("verdict, meta line and pill tones", () => {
		const gate = fixtureSpan("gate");
		expect(gateVerdictLabel(gate)).toBe("pass");
		expect(gateMetaLine(gate, 2)).toBe("2 checks · 460 ms");
		const aborted = {
			...gate,
			attributes: [
				...(gate.attributes ?? []).filter((attr) => attr.key !== "verdict"),
				{ key: "verdict", value: { stringValue: "abstain" } },
				{ key: "aborted", value: { boolValue: true } },
			],
		};
		expect(gateVerdictLabel(aborted)).toBe("abstain · aborted");
		expect(pillTone("pass")).toBe("success");
		expect(pillTone("fail")).toBe("danger");
		expect(pillTone("abstain · aborted")).toBe("warning");
		expect(pillTone("skipped")).toBe("neutral");
	});
});
