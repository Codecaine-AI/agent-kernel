/**
 * tokenize.test — losslessness and classification coverage for doc figure syntax.
 *
 * These tests treat byte-for-byte reconstruction as the primary contract,
 * exercise generated hostile inputs in every language, and pin the distinctions
 * that the UI relies on for JSON keys and prompt-only prose decoration.
 */

import { describe, expect, test } from "bun:test";

import { tokenize, type DocLanguage, type Token } from "./tokenize";

const LANGUAGES: DocLanguage[] = ["xml", "json", "prompt", "text"];

function reconstructed(tokens: Token[]): string {
	return tokens.map((token) => token.value).join("");
}

function generatedSources(count: number): string[] {
	const alphabet = [
		"<",
		">",
		"/",
		'"',
		"'",
		"\\",
		"*",
		"_",
		"#",
		":",
		",",
		"{",
		"}",
		"[",
		"]",
		"\n",
		"\r",
		"\t",
		" ",
		"a",
		"Z",
		"0",
		"9",
		"&",
		"→",
		"💥",
	];
	let seed = 0x51a7e;
	const next = (): number => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed;
	};

	return Array.from({ length: count }, (_, sourceIndex) => {
		const length = next() % (sourceIndex + 80);
		let source = "";
		for (let index = 0; index < length; index += 1) {
			source += alphabet[next() % alphabet.length]!;
		}
		return source;
	});
}

describe("tokenize reconstruction property", () => {
	test("every generated source round-trips in every language", () => {
		const sources = [
			"",
			"<state unbalanced",
			"prose compares 1 < 2 and never closes <purpose",
			'{"escaped":"say \\"hello\\"","broken":"still open',
			"# Heading\ninline # not a heading\n**bold** and __strong__",
			...generatedSources(240),
		];

		for (const language of LANGUAGES) {
			for (const source of sources) {
				expect(reconstructed(tokenize(source, language))).toBe(source);
			}
		}
	});

	test("stays lossless and terminates on a large state-shaped source", () => {
		const source = [
			'<state v="21">',
			...Array.from(
				{ length: 360 },
				(_, index) =>
					`  <item id="${index}">line ${index}: ${"x".repeat(96)} **bold** & 1 < 2</item>`,
			),
			"  <unbalanced",
		].join("\n");
		expect(source.length).toBeGreaterThan(32_000);

		for (const language of LANGUAGES) {
			expect(reconstructed(tokenize(source, language))).toBe(source);
		}
	});
});

describe("JSON tokenization", () => {
	test("distinguishes object keys from strings and classifies scalar values", () => {
		const source =
			'{"name":"Ada","escaped\\"key":"say \\"hi\\"","age":42,"ratio":-1.25e+2,"ok":true,"off":false,"none":null}';
		const tokens = tokenize(source, "json");

		expect(tokens.filter((token) => token.type === "key").map((token) => token.value)).toEqual([
			'"name"',
			'"escaped\\"key"',
			'"age"',
			'"ratio"',
			'"ok"',
			'"off"',
			'"none"',
		]);
		expect(tokens.filter((token) => token.type === "string").map((token) => token.value)).toEqual([
			'"Ada"',
			'"say \\"hi\\""',
		]);
		expect(tokens.filter((token) => token.type === "number").map((token) => token.value)).toEqual([
			"42",
			"-1.25e+2",
		]);
		expect(tokens.filter((token) => token.type === "literal").map((token) => token.value)).toEqual([
			"true",
			"false",
			"null",
		]);
		expect(reconstructed(tokens)).toBe(source);
	});
});

describe("prompt tokenization", () => {
	test("decorates headings only at the start of a source line", () => {
		const source = [
			"<purpose>",
			"# First heading",
			"prose # inline",
			" ## indented",
			"## Second heading",
			"### Third-level heading",
			'<board_model note="# attribute **value**"># after a tag</board_model>',
			"body has **bold text** and __strong text__",
			"<!-- # comment with **markers** -->",
			"</purpose>",
		].join("\n");
		const tokens = tokenize(source, "prompt");

		expect(tokens.filter((token) => token.type === "heading").map((token) => token.value)).toEqual([
			"# First heading",
			"## Second heading",
		]);
		expect(tokens.filter((token) => token.type === "emphasis").map((token) => token.value)).toEqual([
			"**bold text**",
			"__strong text__",
		]);
		expect(tokens.filter((token) => token.type === "attrValue").map((token) => token.value)).toContain(
			'"# attribute **value**"',
		);
		expect(tokens.filter((token) => token.type === "comment").map((token) => token.value)).toEqual([
			"<!-- # comment with **markers** -->",
		]);
		expect(reconstructed(tokens)).toBe(source);
	});
});

describe("plain text tokenization", () => {
	test("returns exactly one token, including for empty text", () => {
		expect(tokenize("", "text")).toEqual([{ type: "text", value: "" }]);
		expect(tokenize("# **literal**", "text")).toEqual([
			{ type: "text", value: "# **literal**" },
		]);
	});
});
