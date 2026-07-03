import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
	spanIconFor,
	SPAN_ICON_KINDS,
	type NucleoIconVariant,
	type SpanIconKind,
} from "./span-icons";
import {
	resolveSpanIcon,
	type SpanDisplayType,
} from "./resolve-span-icon";

const VARIANTS: NucleoIconVariant[] = ["outline", "fill"];

describe("spanIconFor", () => {
	test("every display kind returns a renderable component in both variants", () => {
		for (const kind of SPAN_ICON_KINDS) {
			for (const variant of VARIANTS) {
				const Icon = spanIconFor(kind, variant);
				expect(typeof Icon).toBe("function");
				const markup = renderToStaticMarkup(createElement(Icon, { size: 13 }));
				expect(markup).toContain("<svg");
				expect(markup).toContain('viewBox="0 0 18 18"');
			}
		}
	});

	test("outline vs fill produce distinct markup for every kind", () => {
		for (const kind of SPAN_ICON_KINDS) {
			const outline = renderToStaticMarkup(
				createElement(spanIconFor(kind, "outline"), { size: 13 }),
			);
			const fill = renderToStaticMarkup(
				createElement(spanIconFor(kind, "fill"), { size: 13 }),
			);
			expect(outline).not.toBe(fill);
			// Outline glyphs stroke their paths; fill glyphs paint them.
			expect(outline).toContain('stroke="currentColor"');
		}
	});

	test("glyphs inherit currentColor (no hard-coded #000/black)", () => {
		for (const kind of SPAN_ICON_KINDS) {
			for (const variant of VARIANTS) {
				const markup = renderToStaticMarkup(
					createElement(spanIconFor(kind, variant), { size: 13 }),
				);
				expect(markup).not.toContain("#000");
				expect(markup.toLowerCase()).not.toContain('"black"');
			}
		}
	});

	test("size prop is applied to the svg", () => {
		const markup = renderToStaticMarkup(
			createElement(spanIconFor("tool", "outline"), { size: 13 }),
		);
		expect(markup).toContain('width="13"');
		expect(markup).toContain('height="13"');
	});

	test("unknown kind falls back to the generic glyph", () => {
		const fallback = spanIconFor("not-a-kind" as SpanIconKind, "outline");
		const markup = renderToStaticMarkup(createElement(fallback, { size: 13 }));
		expect(markup).toContain("<svg");
	});
});

describe("resolveSpanIcon", () => {
	const DISPLAY_TYPES: SpanDisplayType[] = [
		"user",
		"assistant",
		"tool",
		"spawner",
		"ui_ask",
		"agent",
		"lifecycle",
		"system",
		"container",
		"generic",
	];

	test("every display type resolves to a kind with a renderable icon and an accent class", () => {
		for (const displayType of DISPLAY_TYPES) {
			const descriptor = resolveSpanIcon({ displayType });
			expect(SPAN_ICON_KINDS).toContain(descriptor.kind);
			expect(descriptor.accentClassName.startsWith("text-")).toBe(true);
			const Icon = spanIconFor(descriptor.kind, "outline");
			expect(typeof Icon).toBe("function");
		}
	});

	test("error and warning status override the glyph regardless of type", () => {
		expect(resolveSpanIcon({ displayType: "tool", status: "error" })).toEqual({
			kind: "error",
			accentClassName: "text-destructive",
		});
		expect(resolveSpanIcon({ displayType: "agent", status: "warning" })).toEqual({
			kind: "warning",
			accentClassName: "text-status-warning",
		});
	});

	test("lifecycle labels split into run / phase / provisioning glyphs", () => {
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Agent Run Start" }).kind).toBe("run");
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Provisioning" }).kind).toBe("provisioning");
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Agent Session Start" }).kind).toBe("lifecycle");
	});
});
