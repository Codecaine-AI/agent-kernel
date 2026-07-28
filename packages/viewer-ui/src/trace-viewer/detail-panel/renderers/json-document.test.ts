import { describe, expect, test } from "bun:test";

import { jsonDocument, prettyJson } from "./json-document";

/** The real minified update_sticky arguments as the provider serializes them. */
const UPDATE_STICKY_INPUT =
	'{"raw":{"stickyId":"sticky-memory-bank","patch":{"geometry":{"x":3968,"y":864,"width":544,"height":336}},"view":"section-memory-bank"}}';

describe("prettyJson", () => {
	test("expands the real minified tool-call payload to indented lines", () => {
		const pretty = prettyJson(UPDATE_STICKY_INPUT);

		expect(pretty.split("\n").length).toBeGreaterThan(1);
		expect(pretty).toBe(
			[
				"{",
				'  "raw": {',
				'    "stickyId": "sticky-memory-bank",',
				'    "patch": {',
				'      "geometry": {',
				'        "x": 3968,',
				'        "y": 864,',
				'        "width": 544,',
				'        "height": 336',
				"      }",
				"    },",
				'    "view": "section-memory-bank"',
				"  }",
				"}",
			].join("\n"),
		);
	});

	test("indents exactly two spaces per level", () => {
		const lines = prettyJson(UPDATE_STICKY_INPUT).split("\n");

		expect(lines[1]).toStartWith('  "raw"');
		expect(lines[2]).toStartWith('    "stickyId"');
		expect(lines[5]).toStartWith('        "x"');
	});

	test("preserves key order as parsed rather than sorting", () => {
		const pretty = prettyJson('{"zebra":1,"alpha":2,"middle":3}');

		expect(pretty).toBe('{\n  "zebra": 1,\n  "alpha": 2,\n  "middle": 3\n}');
	});

	test("preserves every value byte-for-byte, including escapes and precision", () => {
		const source = {
			text: 'line1\nline2\t"quoted"',
			unicode: "héllo → ✓",
			big: 1234567890123,
			float: 0.1,
			negativeZeroish: -0,
			nothing: null,
			flag: false,
			empty: "",
		};
		const pretty = prettyJson(JSON.stringify(source));

		expect(JSON.parse(pretty)).toEqual(JSON.parse(JSON.stringify(source)));
		expect(pretty).toContain('"line1\\nline2\\t\\"quoted\\""');
		expect(pretty).toContain('"héllo → ✓"');
		expect(pretty).toContain("1234567890123");
	});

	test("keeps arrays multi-line instead of collapsing them", () => {
		expect(prettyJson('{"tags":["alpha","beta"]}')).toBe(
			'{\n  "tags": [\n    "alpha",\n    "beta"\n  ]\n}',
		);
	});

	test("returns the raw string unchanged when parsing fails", () => {
		for (const raw of [
			"{ malformed input",
			"APPLIED · update_sticky sticky-memory-bank",
			"",
			"   ",
			"{'single':'quotes'}",
			'{"trailing":1,}',
		]) {
			expect(prettyJson(raw)).toBe(raw);
		}
	});

	test("is idempotent — re-formatting already pretty JSON is a no-op", () => {
		const once = prettyJson(UPDATE_STICKY_INPUT);

		expect(prettyJson(once)).toBe(once);
	});

	test("handles JSON scalars and empty containers without inventing whitespace", () => {
		expect(prettyJson("null")).toBe("null");
		expect(prettyJson("42")).toBe("42");
		expect(prettyJson('"bare string"')).toBe('"bare string"');
		expect(prettyJson("{}")).toBe("{}");
		expect(prettyJson("[]")).toBe("[]");
	});
});

describe("jsonDocument", () => {
	test("tags parsed content json and pretty-prints its body", () => {
		const doc = jsonDocument(UPDATE_STICKY_INPUT);

		expect(doc.language).toBe("json");
		expect(doc.body).toBe(prettyJson(UPDATE_STICKY_INPUT));
		expect(doc.body).toContain("\n");
	});

	test("tags unparseable content text and passes the body through", () => {
		const raw = "APPLIED · update_sticky sticky-memory-bank";
		const doc = jsonDocument(raw);

		expect(doc).toEqual({ body: raw, language: "text" });
	});
});
