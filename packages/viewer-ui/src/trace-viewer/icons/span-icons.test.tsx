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
	GROUP_ACCENT,
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

	test("every display type resolves to a kind, group, and matching accent/border classes", () => {
		for (const displayType of DISPLAY_TYPES) {
			const descriptor = resolveSpanIcon({ displayType });
			expect(SPAN_ICON_KINDS).toContain(descriptor.kind);
			expect(descriptor.accentClassName.startsWith("text-")).toBe(true);
			expect(descriptor.borderClassName.startsWith("border-")).toBe(true);
			// Accent + border draw from the same group token family.
			expect(descriptor.accentClassName).toBe(GROUP_ACCENT[descriptor.group].text);
			expect(descriptor.borderClassName).toBe(GROUP_ACCENT[descriptor.group].border);
			const Icon = spanIconFor(descriptor.kind, "outline");
			expect(typeof Icon).toBe("function");
		}
	});

	test("semantic groups: tool=tool, agent/spawner=orchestration, user/assistant own hues", () => {
		expect(resolveSpanIcon({ displayType: "tool" }).group).toBe("tool");
		expect(resolveSpanIcon({ displayType: "agent" }).group).toBe("orchestration");
		expect(resolveSpanIcon({ displayType: "spawner" }).group).toBe("orchestration");
		expect(resolveSpanIcon({ displayType: "user" }).group).toBe("user");
		expect(resolveSpanIcon({ displayType: "assistant" }).group).toBe("assistant");
		expect(resolveSpanIcon({ displayType: "system" }).group).toBe("lifecycle");
		expect(resolveSpanIcon({ displayType: "container" }).group).toBe("lifecycle");
		expect(resolveSpanIcon({ displayType: "generic" }).group).toBe("meta");
	});

	test("amber/red are reserved: only warning/error status reaches those groups", () => {
		for (const displayType of DISPLAY_TYPES) {
			const group = resolveSpanIcon({ displayType }).group;
			expect(group).not.toBe("warning");
			expect(group).not.toBe("error");
		}
		expect(resolveSpanIcon({ displayType: "tool", status: "error" })).toEqual({
			kind: "error",
			group: "error",
			accentClassName: "text-destructive",
			borderClassName: "border-destructive",
		});
		expect(resolveSpanIcon({ displayType: "agent", status: "warning" })).toEqual({
			kind: "warning",
			group: "warning",
			accentClassName: "text-status-warning",
			borderClassName: "border-status-warning-border",
		});
	});

	test("lifecycle labels split into run / phase / provisioning glyphs", () => {
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Agent Run Start" }).kind).toBe("run");
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Provisioning" }).kind).toBe("provisioning");
		expect(resolveSpanIcon({ displayType: "lifecycle", lifecycleLabel: "Agent Session Start" }).kind).toBe("lifecycle");
	});
});
