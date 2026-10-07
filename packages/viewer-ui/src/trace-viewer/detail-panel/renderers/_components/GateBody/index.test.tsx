import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { fixtureSpan } from "../../../../__fixtures__/model-node-trace";
import { SpanDetailPanel } from "../../../../SpanDetailPanel";

describe("GateBody", () => {
	test("the gate card renders the verdict pill and one row per check", () => {
		const markup = renderToStaticMarkup(<SpanDetailPanel span={fixtureSpan("gate")} />);
		expect(markup).toContain('data-detail-block="gate-checks"');
		expect(markup).toMatch(/data-gate-pill="verdict"[^>]*data-gate-pill-tone="success"[^>]*>pass</);
		expect(markup.match(/data-gate-check="/g)).toHaveLength(2);
		expect(markup).toContain('data-gate-check="judge:A1"');
		// Check names keep their full text as a tooltip; a check's note is shown in full
		// on its own line (its wrapping is proven by the DS screenshots, not here).
		expect(markup).toContain('title="justification:A1"');
		expect(markup).toMatch(/<p data-gate-check-note=""[^>]*>true<\/p>/);
		// The decide check's question: p against its pass and fail lines.
		expect(markup).toMatch(/data-gate-check="judge:A1"[\s\S]*data-probability-bars="ok"/);
		expect(markup).toContain("2 checks · 460 ms");
		// The checks lead; the planned checks fold away once gate_end recorded them.
		expect(markup.indexOf('data-detail-block="gate-checks"')).toBeLessThan(
			markup.indexOf('data-detail-block="gate-planned"'),
		);
		expect(markup).toMatch(/data-detail-block="gate-planned"[^>]*data-block-open="false"/);
	});

	test("an open gate (no gate_end) shows its planned checks", () => {
		const open = {
			...fixtureSpan("gate"),
			output: undefined,
			attributes: fixtureSpan("gate").attributes?.filter((attr) => attr.key !== "verdict"),
		};
		const markup = renderToStaticMarkup(<SpanDetailPanel span={open} />);
		expect(markup).toMatch(/data-detail-block="gate-planned"(?![^>]*data-block-open)/);
		expect(markup).toMatch(/data-gate-pill="verdict"[^>]*>pending</);
	});
});
