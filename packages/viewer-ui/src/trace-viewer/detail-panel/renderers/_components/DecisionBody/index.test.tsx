import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { fixtureSpan, type FixtureRow } from "../../../../__fixtures__/model-node-trace";
import { SpanDetailPanel } from "../../../../SpanDetailPanel";
import { DetailShell } from "../../../DetailShell";
import { buildDecisionView } from ".";

function render(name: FixtureRow): string {
	return renderToStaticMarkup(<SpanDetailPanel span={fixtureSpan(name)} />);
}

function block(markup: string, id: string): string {
	const start = markup.indexOf(`data-detail-block="${id}"`);
	if (start < 0) throw new Error(`block ${id} not rendered`);
	const next = markup.indexOf("data-detail-block=", start + 1);
	return markup.slice(start, next < 0 ? undefined : next);
}

describe("DecisionBody", () => {
	test("DecisionBody shows engine/model badge, confidence source, abstain reason and the route block ids", () => {
		const accepted = render("decision");
		// The answer leads: verdict and badges, the bars, then the input state and the facts.
		expect([...accepted.matchAll(/data-detail-block="([^"]+)"/g)].map((match) => match[1])).toEqual([
			"decision-summary",
			"decision-bars",
			"decision-input-unavailable",
			"decision-meta",
		]);
		const summary = block(accepted, "decision-summary");
		expect(summary).toMatch(/data-decision-verdict="success"[^>]*>pass · p=0.91</);
		expect(summary).toContain('data-decision-badge="confidence"');
		expect(summary).toContain(">native</span>");
		expect(summary).toContain('data-decision-badge="engine"');
		expect(summary).toContain(">jev · jev-1.13.0</span>");
		expect(summary).not.toContain('data-decision-badge="requested"');
		expect(accepted).toContain('data-detail-block="decision-bars"');
		expect(accepted).not.toContain('data-detail-block="decision-abstain"');

		const abstained = render("abstain");
		const abstain = block(abstained, "decision-abstain");
		expect(abstain).toContain("Abstained · low-confidence");
		expect(abstain).toContain('data-field="abstain_reason"');
		// A low-confidence abstain still has a probability, so its bars render too.
		expect(abstained).toContain('data-detail-block="decision-bars"');
		expect(block(abstained, "decision-bars")).toContain('data-bars-state="abstain"');
	});

	test("a judged bool draws p(true) against its pass and fail lines", () => {
		const bars = block(render("decision"), "decision-bars");
		expect(bars).toContain('data-probability-bars="ok"');
		expect(bars).toMatch(/data-bar-fill="chosen"[^>]*style="width:91%"/);
		expect(bars).toMatch(/data-bar-marker="pass"[^>]*style="left:85%"/);
		expect(bars).toMatch(/data-bar-marker="fail"[^>]*style="left:15%"/);
		expect(bars).toContain("pass ≥ 0.85");
		expect(bars).toContain(">0.91</span>");
		expect(bars).toContain("bg-pink-solid");
		expect(bars).toContain("border-rule-strong");
	});

	test("a choice draws one bar per option with the floor line, the chosen option solid", () => {
		const bars = block(render("choice"), "decision-bars");
		for (const label of ["stop", "continue", "escalate"]) {
			expect(bars).toContain(`data-bar-row="${label}"`);
		}
		expect(bars.match(/data-bar-fill="chosen"/g)).toHaveLength(1);
		expect(bars.match(/data-bar-marker="floor"[^>]*style="left:50%"/g)).toHaveLength(3);
		expect(bars).toContain("floor 0.50");
		expect(bars).toContain(">continue</span>");
		// One shared grid holds every row, and each label keeps its full text as a
		// tooltip. Alignment and wrapping are proven by the DS screenshots, not here.
		expect(bars.match(/data-bars-grid=""/g)).toHaveLength(1);
		expect(bars.match(/data-bar-row="/g)).toHaveLength(3);
		expect(bars).toMatch(/<span title="escalate"[^>]*>escalate<\/span>/);
	});

	test("an engine-error attempt has no bars: it says why it abstained and which error", () => {
		const markup = render("retryAttempt1");
		expect(markup).not.toContain('data-detail-block="decision-bars"');
		const abstain = block(markup, "decision-abstain");
		expect(abstain).toContain("Abstained · engine-error");
		expect(abstain).toContain(">http</dd>");
		expect(block(markup, "decision-summary")).toContain(">none</span>");
	});

	test("a recovered decision whose only input is the claim-time placeholder says the input was not recorded", () => {
		// Stale recovery wrote an aborted call_end without a final input, so the row
		// falls back to call_start's `{ pending: true }`: status, not input.
		const base = fixtureSpan("retryAttempt1");
		const recovered = {
			...base,
			status: "warning" as const,
			attributes: (base.attributes ?? []).map((attribute) =>
				attribute.key === "status"
					? { key: "status", value: { stringValue: "aborted" } }
					: attribute.key === "error_kind"
						? { key: "error_kind", value: { stringValue: "abandoned" } }
						: attribute,
			),
		};
		const markup = renderToStaticMarkup(
			<DetailShell
				span={recovered}
				view={buildDecisionView(recovered, { phase: "loaded", hash: "b1-in-RD2a", text: '{"pending":true}' })}
			/>,
		);
		expect(markup).not.toContain('data-detail-block="decision-input"');
		const status = block(markup, "decision-input-unrecorded");
		expect(status).toContain("Input not recorded: the run ended before its final input was written.");
		expect(status).not.toContain("data-json-field");
	});

	test("an older trace whose call_start held the real context still shows it as input", () => {
		const span = fixtureSpan("decision");
		const markup = renderToStaticMarkup(
			<DetailShell
				span={span}
				view={buildDecisionView(span, {
					phase: "loaded",
					hash: "b1-in-RD1",
					text: JSON.stringify({ state: { advisory: "A1" }, questions: [{ id: "ok", type: "bool" }] }),
				})}
			/>,
		);
		const input = block(markup, "decision-input");
		expect(input).toContain('data-json-field="state"');
		expect(input).toContain("A1");
		expect(markup).not.toContain("decision-input-unrecorded");
	});
});
