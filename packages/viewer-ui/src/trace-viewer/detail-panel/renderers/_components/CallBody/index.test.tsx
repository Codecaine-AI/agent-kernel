import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import { DetailShell } from "../../../DetailShell";
import { buildCallView } from ".";

const OUTPUT = JSON.stringify({ kept: ["A1"], justification: "the cast is layout-safe" });

function render(name: "call" | "failedCall", blobs: Parameters<typeof buildCallView>[1]): string {
	const span = fixtureSpan(name);
	return renderToStaticMarkup(<DetailShell span={span} view={buildCallView(span, blobs)} />);
}

function blockIds(markup: string): string[] {
	return [...markup.matchAll(/data-detail-block="([^"]+)"/g)].map((match) => match[1]!);
}

describe("CallBody", () => {
	test("a loaded call shows its input, facts, the typed output field by field and the raw JSON", () => {
		const markup = render("call", {
			input: { phase: "loaded", hash: "b1-in-RK", text: '{"checkpoint":"cp-7"}' },
			output: { phase: "loaded", hash: "b1-out-RK", text: OUTPUT },
		});
		// The answer leads: output, raw JSON, then what was asked, then the facts.
		expect(blockIds(markup)).toEqual(["call-output", "call-output-json", "call-input", "call-summary"]);
		const output = markup.slice(markup.indexOf('data-detail-block="call-output"'));
		expect(output).toContain('data-field="kept"');
		expect(output).toContain("[&quot;A1&quot;]");
		expect(output).toContain('data-field="justification"');
		expect(output).toContain("the cast is layout-safe");
		// The raw JSON is a data figure, pretty-printed.
		expect(markup).toMatch(/data-detail-block="call-output-json"[\s\S]*data-doc-language="json"/);
		// The input args are a field view whose string values soft-wrap.
		const input = markup.slice(markup.indexOf('data-detail-block="call-input"'));
		expect(input).toContain('data-json-field="checkpoint"');
		expect(input).toContain("break-words text-syntax-string");
	});

	test("call-output renders only once the output has loaded", () => {
		const markup = render("call", {
			input: { phase: "loading", hash: "b1-in-RK" },
			output: { phase: "loading", hash: "b1-out-RK" },
		});
		expect(blockIds(markup)).toEqual(["call-output-pending", "call-input-pending", "call-summary"]);
		expect(markup).toContain("Loading trace blob b1-out-RK");
	});

	test("a failed call shows its error kind and the raw model output", () => {
		const markup = render("failedCall", {
			input: { phase: "loaded", hash: "b1-in-RF", text: "{}" },
			output: { phase: "loaded", hash: "b1-out-RF", text: "Sure! Here are the advisories:" },
		});
		expect(blockIds(markup)).toEqual(["call-error", "call-raw-output", "call-input", "call-summary"]);
		const error = markup.slice(markup.indexOf('data-detail-block="call-error"'));
		expect(error).toContain("Call failed");
		expect(error).toContain('data-field="error_kind"');
		expect(error).toContain(">parse</dd>");
		expect(error).toContain("expected object at $.advisories");
		expect(markup).toContain("Sure! Here are the advisories:");
		expect(markup).not.toContain('data-detail-block="call-output"');
	});

	test("a failed read leaves an unavailable stand-in, never a call-output block", () => {
		const markup = render("call", {
			input: { phase: "absent" },
			output: { phase: "error", hash: "b1-out-RK", message: "HTTP 404" },
		});
		expect(blockIds(markup)).toEqual(["call-output-unavailable", "call-summary"]);
		expect(markup).toContain("Trace blob b1-out-RK could not be read: HTTP 404.");
	});
});
