"use client";

/**
 * DecisionBody — the detail body for a kernel.decide row (decision_container)
 * and its attempt rows (decision_attempt). The answer leads: the verdict line
 * with the confidence-source and engine/model badges, why it abstained, the
 * probability bars per question against their thresholds; then the input
 * state the classifier read and the facts (thresholds applied, model routing,
 * usage). Everything but the input state comes from the row's decision_made
 * payload, so it renders without a fetch.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import type { RendererProps } from "../../../types";
import { blobStatusBlock, useTraceBlob, type TraceBlobState } from "../../useTraceBlob";
import { FieldTable } from "../FieldTable";
import { inputBlock } from "../JsonFields";
import { AbstainPanel } from "./_components/AbstainPanel";
import { DecisionSummary } from "./_components/DecisionSummary";
import { ProbabilityBars, questionBars } from "./_components/ProbabilityBars";
import { abstainFacts, decisionBadges, decisionMetaRows, decisionVerdict, parseDecision } from "./utils";

// The gate body draws its decide checks with the same bars.
export { ProbabilityBars, gateQuestionBars } from "./_components/ProbabilityBars";

export type DecisionBodyProps = RendererProps;

/** Reading order, all in the content slot: the answer, why it abstained, the bars, then the input and the facts. */
const ORDER = { summary: 0, abstain: 10, bars: 20, input: 30, meta: 40 } as const;

/** The decision view for a given input-state blob; DecisionBody feeds it the fetched one. */
export function buildDecisionView(span: TraceSpan, input: TraceBlobState): DetailView {
	const decision = parseDecision(span);
	const blocks: DetailBlockSpec[] = [
		{
			id: "decision-summary",
			slot: "content",
			order: ORDER.summary,
			caption: "Decision",
			expandable: false,
			node: (
				<DecisionSummary
					verdict={decisionVerdict(span, decision)}
					badges={decisionBadges(span, decision)}
				/>
			),
		},
	];

	const abstain = abstainFacts(span, decision);
	if (abstain) {
		blocks.push({
			id: "decision-abstain",
			slot: "content",
			order: ORDER.abstain,
			caption: "Abstained",
			expandable: false,
			node: <AbstainPanel facts={abstain} />,
		});
	}

	const questions = Object.entries(decision?.answers ?? {}).map(([id, answer]) =>
		questionBars(id, answer, decision?.threshold_applied[id]),
	);
	if (questions.some((question) => !question.empty)) {
		blocks.push({
			id: "decision-bars",
			slot: "content",
			order: ORDER.bars,
			caption: "Probabilities",
			expandable: false,
			node: (
				<div className="min-w-0 space-y-4">
					{questions.map((question) => (
						<ProbabilityBars key={question.id} question={question} />
					))}
				</div>
			),
		});
	}

	const inputSpec = { id: "decision-input", caption: "Input state", slot: "content" as const, order: ORDER.input };
	if (input.phase === "loaded") {
		blocks.push(inputBlock(inputSpec, input.text));
	} else {
		const status = blobStatusBlock(input, inputSpec);
		if (status) blocks.push(status);
	}

	blocks.push({
		id: "decision-meta",
		slot: "content",
		order: ORDER.meta,
		caption: "Facts",
		expandable: false,
		node: <FieldTable rows={decisionMetaRows(span, decision)} />,
	});

	return { blocks };
}

export function DecisionBody({ span }: DecisionBodyProps): DetailView {
	const input = useTraceBlob(readStringAttr(span, "input_blob_hash"));
	return buildDecisionView(span, input);
}
