import { describe, expect, test } from "bun:test";

import type { ParsedAgent } from "../types";
import { resolveSystemPrompt } from "./resolve-system-prompt";
import { AgentVariableError, resolveVariables } from "./resolve-variables";

function captureVariableError(run: () => unknown): AgentVariableError {
	try {
		run();
	} catch (err) {
		expect(err).toBeInstanceOf(AgentVariableError);
		return err as AgentVariableError;
	}
	throw new Error("expected an AgentVariableError");
}

function parsedAgent(
	variables: ParsedAgent["config"]["variables"],
	body: string,
): ParsedAgent {
	return {
		config: {
			name: "variable-agent",
			description: "Variable resolution test agent.",
			model: "test/model",
			tools: [],
			variables,
		},
		body,
	};
}

describe("resolveVariables", () => {
	test("caller value wins over the declared default", () => {
		expect(
			resolveVariables({ topic: { default: "fallback" } }, { topic: "given" }),
		).toEqual({ topic: "given" });
	});

	test("falls back to the declared default, and passes undeclared caller values through", () => {
		expect(
			resolveVariables({ topic: { default: "fallback" } }, { extra: 1 }),
		).toEqual({ topic: "fallback", extra: 1 });
	});

	test("a variable without required: true may resolve to undefined", () => {
		expect(
			resolveVariables({ plain: {}, flagged: { optional: true } }),
		).toEqual({ plain: undefined, flagged: undefined });
	});

	test("required: false is not enforced", () => {
		expect(resolveVariables({ topic: { required: false } })).toEqual({
			topic: undefined,
		});
	});

	test("throws MISSING_REQUIRED_VARIABLES listing every missing name, sorted", () => {
		const err = captureVariableError(() =>
			resolveVariables(
				{
					zeta: { required: true },
					alpha: { required: true },
					given: { required: true },
					loose: {},
				},
				{ given: "value" },
			),
		);

		expect(err.code).toBe("MISSING_REQUIRED_VARIABLES");
		expect(err.missing).toEqual(["alpha", "zeta"]);
		expect(err.message).toBe("Missing required variables: alpha, zeta");
	});

	test("a default satisfies required", () => {
		expect(
			resolveVariables({ topic: { required: true, default: "fallback" } }),
		).toEqual({ topic: "fallback" });
	});

	test("falsy caller values and defaults satisfy required", () => {
		expect(
			resolveVariables(
				{
					text: { required: true },
					count: { required: true, default: 0 },
					flag: { required: true },
				},
				{ text: "", flag: false },
			),
		).toEqual({ text: "", count: 0, flag: false });
	});

	test("a null caller value or null default does not satisfy required", () => {
		const fromCaller = captureVariableError(() =>
			resolveVariables({ topic: { required: true } }, { topic: null }),
		);
		expect(fromCaller.missing).toEqual(["topic"]);

		const fromDefault = captureVariableError(() =>
			resolveVariables({ topic: { required: true, default: null } }),
		);
		expect(fromDefault.missing).toEqual(["topic"]);
	});
});

describe("resolveSystemPrompt", () => {
	const runtime = { cwd: "/work", platform: "test-os" };

	test("substitutes caller values, defaults, and runtime variables", () => {
		const resolved = resolveSystemPrompt({
			parsed: parsedAgent(
				{ topic: { required: true }, tone: { default: "dry" } },
				"{{topic}} / {{tone}} / {{cwd}} / {{platform}}",
			),
			callerVariables: { topic: "indexes" },
			runtime,
		});

		expect(resolved.systemPrompt).toBe("indexes / dry / /work / test-os");
		expect(resolved.variables).toEqual({ topic: "indexes", tone: "dry" });
	});

	test("a declared variable with no value and no default renders as an empty string", () => {
		const resolved = resolveSystemPrompt({
			parsed: parsedAgent({ tone: { optional: true } }, "[{{tone}}]"),
			runtime,
		});

		expect(resolved.systemPrompt).toBe("[]");
	});

	test("a missing required variable fails the spawn instead of rendering empty", () => {
		const err = captureVariableError(() =>
			resolveSystemPrompt({
				parsed: parsedAgent({ topic: { required: true } }, "[{{topic}}]"),
				runtime,
			}),
		);

		expect(err.code).toBe("MISSING_REQUIRED_VARIABLES");
		expect(err.missing).toEqual(["topic"]);
	});

	test("an undeclared placeholder still throws UNRESOLVED_PLACEHOLDER", () => {
		const err = captureVariableError(() =>
			resolveSystemPrompt({
				parsed: parsedAgent({}, "[{{nope}}]"),
				runtime,
			}),
		);

		expect(err.code).toBe("UNRESOLVED_PLACEHOLDER");
		expect(err.placeholders).toEqual(["nope"]);
	});
});
