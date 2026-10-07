import { describe, expect, test } from "bun:test";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import {
	abstainFacts,
	decisionBadges,
	decisionMetaRows,
	modelId,
	parseDecision,
	thresholdLabel,
} from "./utils";

/** The fixture's decision with its decision_made payload patched. */
function withPayload(span: TraceSpan, patch: Record<string, unknown>): TraceSpan {
	return { ...span, output: JSON.stringify({ ...JSON.parse(span.output ?? "{}"), ...patch }) };
}

describe("DecisionBody utils", () => {
	test("parseDecision reads decision_made off the row's output", () => {
		const decision = parseDecision(fixtureSpan("decision"));
		expect(decision?.chosen).toBe("true");
		expect(decision?.abstained).toBe(false);
		expect(decision?.answers.ok?.probability).toBe(0.91);
		expect(decision?.threshold_applied.ok).toEqual({ passAt: 0.85, failAt: 0.15 });
		expect(parseDecision({ ...fixtureSpan("decision"), output: undefined })).toBeNull();
		expect(parseDecision({ ...fixtureSpan("decision"), output: "{not json" })).toBeNull();
	});

	test("badges: confidence source and `engine · model id`; the requested model only when it differs", () => {
		const span = fixtureSpan("decision");
		expect(decisionBadges(span, parseDecision(span))).toEqual({
			confidenceSource: "native",
			engineModel: "jev · jev-1.13.0",
			requested: null,
		});

		const rerouted = withPayload(span, { requested_model: "typesafe/jev-latest" });
		expect(decisionBadges(rerouted, parseDecision(rerouted)).requested).toBe("typesafe/jev-latest");
		expect(modelId("typesafe/jev-1.13.0")).toBe("jev-1.13.0");
		expect(modelId("jev-1.13.0")).toBe("jev-1.13.0");
	});

	test("abstain facts: the reason, the engine error kind (malformed-answer included) and per-question reasons", () => {
		const low = fixtureSpan("abstain");
		expect(abstainFacts(low, parseDecision(low))).toEqual({
			reason: "low-confidence",
			errorKind: null,
			questions: [{ id: "ok", reason: "low-confidence" }],
		});

		const engineError = fixtureSpan("retryAttempt1");
		expect(abstainFacts(engineError, parseDecision(engineError))).toMatchObject({
			reason: "engine-error",
			errorKind: "http",
		});

		const malformed = withPayload(engineError, { error_kind: "malformed-answer" });
		expect(abstainFacts(malformed, parseDecision(malformed))?.errorKind).toBe("malformed-answer");

		const answered = fixtureSpan("decision");
		expect(abstainFacts(answered, parseDecision(answered))).toBeNull();
	});

	test("thresholdLabel names every threshold the decision was judged against", () => {
		expect(thresholdLabel({ passAt: 0.85, failAt: 0.15 })).toBe("pass ≥ 0.85 · fail ≤ 0.15");
		expect(thresholdLabel({ minTop: 0.5, minMargin: 0.1 })).toBe("floor 0.50 · margin 0.10");
		expect(thresholdLabel({ abstainBelow: 0.4 })).toBe("abstain below 0.40");
		expect(thresholdLabel({})).toBeUndefined();
	});

	test("the facts table carries thresholdApplied per question, routing and usage", () => {
		const span = fixtureSpan("choice");
		const rows = Object.fromEntries(decisionMetaRows(span, parseDecision(span)).map((row) => [row.key, row.value]));
		expect(rows).toMatchObject({
			decision_name: "ContinueOrStop",
			chosen: "continue",
			"threshold:next": "floor 0.50",
			engine: "jev",
			model: "typesafe/jev-1.13.0",
			route: "typesafe · typesafe-system-one",
			confidence_source: "native",
			duration: "110 ms",
			tokens: "1,204 in · 88 out",
			cost: "$0.0012",
		});
	});
});
