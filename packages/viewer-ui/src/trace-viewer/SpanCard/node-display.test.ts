import { describe, expect, test } from "bun:test";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { fixtureSpan, modelNodeSpans } from "../__fixtures__/model-node-trace";
import { getNodeSpanDisplay } from "./node-display";

function display(span: TraceSpan) {
	const result = getNodeSpanDisplay(span);
	if (!result) throw new Error(`${span.id} is not a model-node row`);
	return result;
}

describe("getNodeSpanDisplay", () => {
	test("each kind gets its badge and a result chip read from the span", () => {
		const call = display(fixtureSpan("call"));
		expect(call).toMatchObject({ type: "call", badge: "CALL", title: "ExtractCheckpointKnowledge (R1)" });
		expect(call.result).toEqual({ label: "ok", tone: "success" });

		const decision = display(fixtureSpan("decision"));
		expect(decision).toMatchObject({ type: "decision", badge: "DECIDE" });
		expect(decision.result).toEqual({ label: "pass p=0.91", tone: "success" });

		const step = display(fixtureSpan("step"));
		expect(step).toMatchObject({ type: "step", badge: "STEP", title: "validate" });
		// A step's chip is the first value of its output summary.
		expect(step.result?.label).toBe("objdiff 100");

		const gate = display(fixtureSpan("gate"));
		expect(gate).toMatchObject({ type: "gate", badge: "GATE", title: "llm-review-advisories" });
		expect(gate.result).toEqual({ label: "pass", tone: "success" });
	});

	test("a choice decision shows the chosen label with its probability, an abstain says abstain", () => {
		expect(display(fixtureSpan("choice")).result).toEqual({ label: "continue p=0.71", tone: "success" });
		// Status wins: an abstained decision is a warning row.
		expect(display(fixtureSpan("abstain")).result).toEqual({ label: "abstain", tone: "warning" });
	});

	test("a failed call names its error kind on a danger chip", () => {
		expect(display(fixtureSpan("failedCall")).result).toEqual({ label: "error · parse", tone: "danger" });
	});

	test("duration chips read duration_ms: milliseconds under a second, else seconds", () => {
		expect(display(fixtureSpan("decision")).duration).toBe("110 ms");
		expect(display(fixtureSpan("call")).duration).toBe("1.8 s");
		expect(display(fixtureSpan("gate")).duration).toBe("460 ms");
	});

	test("a retried decision: the node row carries ×2 and attempt 2's verdict; attempt rows read `attempt n` and why they failed", () => {
		const row = display(fixtureSpan("retry"));
		expect(row.attempts).toBe(2);
		expect(row.title).toBe("JudgeAdvisory:A2");
		expect(row.tooltip).toBe("JudgeAdvisory:A2");
		expect(row.result).toEqual({ label: "pass p=0.88", tone: "success" });

		const first = display(fixtureSpan("retryAttempt1"));
		expect(first.title).toBe("attempt 1 · 503");
		expect(first.tooltip).toBe("attempt 1 of 2 · http · upstream 503");
		expect(first.attempts).toBeNull();
		expect(first.result).toEqual({ label: "abstain", tone: "danger" });

		const second = display(fixtureSpan("retryAttempt2"));
		expect(second.title).toBe("attempt 2");
		expect(second.tooltip).toBe("attempt 2 of 2");
		expect(second.result?.label).toBe("pass p=0.88");

		// A stale attempt names its error kind when it has no HTTP status.
		expect(display(fixtureSpan("retriedCallAttempt1")).title).toBe("attempt 1 · abandoned");

		// Single-attempt rows carry no attempts chip.
		expect(display(fixtureSpan("decision")).attempts).toBeNull();
	});

	test("every other span is not a node row", () => {
		const worker = modelNodeSpans()[0]!;
		expect(worker.id).toBe("pi:W");
		expect(getNodeSpanDisplay(worker)).toBeNull();
	});

	test("a running call shows no duration and a neutral `running` chip", () => {
		const running: TraceSpan = {
			...fixtureSpan("call"),
			status: "pending",
			attributes: [
				{ key: "event_type", value: { stringValue: "call_container" } },
				{ key: "status", value: { stringValue: "running" } },
			],
		};
		expect(display(running)).toMatchObject({
			duration: null,
			result: { label: "running", tone: "neutral" },
		});
	});
});
