/**
 * Decision request and config validation (plan §4.3): every issue listed,
 * thresholds checked after merging with the kernel's defaults, nothing
 * written before a request is valid.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createKernel } from "../../index";
import { createTempKernel, disableNetwork, type TempKernel } from "../__fixtures__/temp-kernel";
import { KernelDecideValidationError, type DecisionQuestion } from "../types";
import { answeringEngine, boolQ, choiceQ, countRows, FAKE_REF, scoreQ } from "./__fixtures__/decide-harness";
import { DEFAULT_THRESHOLDS } from "./thresholds";
import { checkState, decideConfigIssues, questionIssues } from "./validate";

let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
});
afterAll(() => {
	restoreFetch();
});

const defaults = { ...DEFAULT_THRESHOLDS };

function issuesFor(questions: Record<string, object>): string[] {
	return questionIssues(questions, defaults);
}

describe("questionIssues", () => {
	test("validate rejects: bool without criteria, empty instructions, choice with one label, score with 1 or 11 levels, passAt ≤ failAt, threshold on wrong type", () => {
		const { criteria: _dropped, ...boolWithoutCriteria } = boolQ();
		const cases: Array<[string, object, RegExp]> = [
			["bool without criteria", boolWithoutCriteria, /criteria must be \{ true, false \}/],
			["empty instructions", boolQ({ instructions: "  " }), /instructions must be a non-empty string/],
			["choice with one label", choiceQ(["only"]), /choice needs 2–255 labels \(got 1\)/],
			["score with 1 level", scoreQ(1), /score needs 2–10 levels \(got 1\)/],
			["score with 11 levels", scoreQ(11), /score needs 2–10 levels \(got 11\)/],
			["passAt ≤ failAt", boolQ({ passAt: 0.4, failAt: 0.4 }), /requires 0 ≤ failAt < passAt ≤ 1/],
			["threshold on wrong type", { ...boolQ(), minTop: 0.5 }, /minTop is not allowed on a bool question/],
		];
		for (const [label, question, pattern] of cases) {
			const issues = issuesFor({ q: question });
			expect(issues, label).toHaveLength(1);
			expect(issues[0], label).toMatch(pattern);
		}
	});

	test("ids, instruction length, choice descriptions and an empty set are checked", () => {
		expect(issuesFor({})).toEqual(["at least one question is required"]);
		expect(issuesFor({ BadId: boolQ() })[0]).toMatch(/id must match/);
		expect(issuesFor({ q: boolQ({ instructions: "x".repeat(4_001) }) })[0]).toMatch(/exceed 4000 characters/);
		expect(issuesFor({ q: choiceQ(["a", "b"], { criteria: { a: "first", b: "" } }) })[0]).toMatch(
			/description of label "b"/,
		);
		expect(issuesFor({ q: { ...scoreQ(), abstainBelow: Number.NaN } })[0]).toMatch(/abstainBelow must be a finite number/);
		// Every issue across questions is listed, not just the first.
		expect(issuesFor({ a: boolQ({ instructions: "" }), b: scoreQ(1) })).toHaveLength(2);
	});

	test("effective thresholds are validated after merging defaults", () => {
		// A partial override inverting the pair against the default failAt 0.15.
		expect(issuesFor({ q: boolQ({ passAt: 0.1 }) })[0]).toMatch(/failAt 0.15, passAt 0.1/);
		expect(issuesFor({ q: boolQ({ failAt: 0.9 }) })[0]).toMatch(/failAt 0.9, passAt 0.85/);
		expect(issuesFor({ q: choiceQ(undefined, { minTop: 0 }) })[0]).toMatch(/0 < minTop ≤ 1/);
		expect(issuesFor({ q: choiceQ(undefined, { minMargin: 1 }) })[0]).toMatch(/0 ≤ minMargin < 1/);
		expect(issuesFor({ q: scoreQ(4, { abstainBelow: 1.2 }) })[0]).toMatch(/0 ≤ abstainBelow ≤ 1/);
		expect(issuesFor({ q: boolQ({ passAt: 0.5, failAt: 0.4 }) })).toEqual([]);
		// The same override is valid against other defaults.
		expect(questionIssues({ q: boolQ({ passAt: 0.1 }) }, { ...defaults, failAt: 0.05 })).toEqual([]);
	});
});

describe("checkState", () => {
	test("string state is wrapped as {text}", () => {
		expect(checkState("plain text")).toMatchObject({ ok: true, state: { text: "plain text" } });
		expect(checkState({ a: 1 })).toMatchObject({ ok: true, state: { a: 1 } });
		expect(checkState([1, 2] as never)).toEqual({ ok: false, issues: ["state must be a plain JSON object or a string"] });
		const big = checkState({ text: "x".repeat(2 * 1024 * 1024) });
		expect(big.ok).toBe(false);
	});
});

describe("decideConfigIssues", () => {
	test("accepts the documented defaults and rejects broken sets", () => {
		expect(decideConfigIssues({ defaults: { ...DEFAULT_THRESHOLDS } })).toEqual([]);
		expect(decideConfigIssues({ defaults: { ...DEFAULT_THRESHOLDS, passAt: 0.1 } })[0]).toMatch(/failAt < passAt/);
		const partial = { passAt: 0.9, failAt: 0.1 } as unknown as typeof DEFAULT_THRESHOLDS;
		expect(decideConfigIssues({ defaults: partial })).toEqual([
			"config.decide.defaults: minTop is required",
			"config.decide.defaults: minMargin is required",
			"config.decide.defaults: abstainBelow is required",
		]);
		expect(decideConfigIssues({ maxRetries: 1.5, timeoutMs: 0, maxRetryDelayMs: -1 })).toHaveLength(3);
	});
});

describe("through the kernel", () => {
	let temp: TempKernel | undefined;
	beforeEach(() => {
		temp = undefined;
	});
	afterEach(() => {
		temp?.cleanup();
	});

	test("an invalid request throws before any row and never reaches the engine", async () => {
		const engine = answeringEngine({});
		temp = await createTempKernel({ decide: { engine }, models: { defaults: { decide: FAKE_REF } } });
		const before = countRows(temp.tempDb.db, "trace_events");
		const questions: Record<string, DecisionQuestion> = { q: boolQ({ passAt: 0.1 }), other: scoreQ(1) };
		let thrown: unknown;
		try {
			await temp.kernel.decide("d", { a: 1 }, { containerId: temp.tempDb.containerId, questions });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(KernelDecideValidationError);
		expect((thrown as KernelDecideValidationError).issues).toHaveLength(2);
		expect(engine.requests).toHaveLength(0);
		expect(countRows(temp.tempDb.db, "trace_events")).toBe(before);
		expect(countRows(temp.tempDb.db, "agent_runs")).toBe(0);
	});

	test("string state reaches the engine as {text}", async () => {
		const engine = answeringEngine({ q: { type: "bool", probability: 0.9 } });
		temp = await createTempKernel({ decide: { engine }, models: { defaults: { decide: FAKE_REF } } });
		const outcome = await temp.kernel.decide("d", "the cast is fine", {
			containerId: temp.tempDb.containerId,
			questions: { q: boolQ() },
		});
		expect(engine.requests[0]!.state).toEqual({ text: "the cast is fine" });
		expect(outcome.answers.q.verdict).toBe("pass");
	});

	test("createKernel throws on invalid decide defaults and wire precision", () => {
		expect(() => createKernel({ decide: { defaults: { ...DEFAULT_THRESHOLDS, failAt: 0.9 } } })).toThrow(
			KernelDecideValidationError,
		);
		for (const step of [0, -1, Number.NaN, 2]) {
			expect(() => createKernel({ decide: { wirePrecision: { "*": step } } })).toThrow(KernelDecideValidationError);
		}
		expect(() => createKernel({ decide: { wirePrecision: { "*": 0.001 } } })).not.toThrow();
	});
});
