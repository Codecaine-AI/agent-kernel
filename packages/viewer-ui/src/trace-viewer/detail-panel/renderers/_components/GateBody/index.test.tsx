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
		// The decide check's question: p against its pass and fail lines.
		expect(markup).toMatch(/data-gate-check="judge:A1"[\s\S]*data-probability-bars="ok"/);
		expect(markup).toContain("2 checks · 460 ms");
	});
});
