"use client";

/**
 * DecisionBody — the detail body for a kernel.decide row (decision_container)
 * and its attempt rows (decision_attempt): the input state the classifier
 * read, the confidence-source and engine/model badges, why it abstained, the
 * probability bars per question against their thresholds, then the facts
 * (thresholds applied, model routing, usage). Everything but the input state
 * comes from the row's decision_made payload, so it renders without a fetch.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { jsonDocument } from "../../json-document";
import { blobStatusBlock, useTraceBlob, type TraceBlobState } from "../../useTraceBlob";
import { FieldTable } from "../FieldTable";
import { AbstainPanel } from "./_components/AbstainPanel";
import { DecisionBadges } from "./_components/DecisionBadges";
import { ProbabilityBars, questionBars } from "./_components/ProbabilityBars";
import { abstainFacts, decisionBadges, decisionMetaRows, parseDecision } from "./utils";

// The gate body draws its decide checks with the same bars.
export { ProbabilityBars, gateQuestionBars } from "./_components/ProbabilityBars";

export type DecisionBodyProps = RendererProps;

/** The decision view for a given input-state blob; DecisionBody feeds it the fetched one. */
export function buildDecisionView(span: TraceSpan, input: TraceBlobState): DetailView {
	const decision = parseDecision(span);
	const blocks: DetailBlockSpec[] = [];

	if (input.phase === "loaded") {
		const doc = jsonDocument(input.text);
		blocks.push({
			id: "decision-input",
			slot: "input",
			order: 10,
			caption: "Input state",
			body: doc.body,
			language: doc.language,
			clamp: CLAMP.block,
		});
	} else {
		const status = blobStatusBlock(input, {
			id: "decision-input",
			caption: "Input state",
			slot: "input",
			order: 10,
		});
		if (status) blocks.push(status);
	}

	blocks.push({
		id: "decision-summary",
		slot: "content",
		order: 0,
		caption: "Decision",
		expandable: false,
		node: <DecisionBadges badges={decisionBadges(span, decision)} />,
	});

	const abstain = abstainFacts(span, decision);
	if (abstain) {
		blocks.push({
			id: "decision-abstain",
			slot: "content",
			order: 5,
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
			order: 10,
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

	blocks.push({
		id: "decision-meta",
		slot: "content",
		order: 20,
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
