/**
 * StepBody — the detail body for a kernel.step span (step_start paired with
 * step_end): the step's facts and check outcome, its attributes as a table,
 * its recorded events, its output summary, and the error when it threw.
 */
import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { jsonDocument } from "../../json-document";
import { FieldTable } from "../FieldTable";
import { stepAttributeRows, stepEventRows, stepSummaryRows } from "./utils";

export type StepBodyProps = RendererProps;

export function StepBody({ span }: StepBodyProps): DetailView {
	const blocks: DetailBlockSpec[] = [
		{
			id: "step-summary",
			slot: "content",
			order: 0,
			caption: "Step",
			expandable: false,
			node: <FieldTable rows={stepSummaryRows(span)} />,
		},
	];

	const attributes = stepAttributeRows(span);
	if (attributes.length > 0) {
		blocks.push({
			id: "step-attributes",
			slot: "content",
			order: 10,
			caption: "Attributes",
			node: <FieldTable rows={attributes} />,
		});
	}

	const events = stepEventRows(span);
	if (events.length > 0) {
		blocks.push({
			id: "step-events",
			slot: "content",
			order: 20,
			caption: "Events",
			node: <FieldTable rows={events} />,
		});
	}

	const error = readStringAttr(span, "error_message");
	if (error) {
		blocks.push({
			id: "step-error",
			slot: "output",
			order: 0,
			caption: "Error",
			body: error,
			language: "text",
			clamp: CLAMP.block,
		});
	}

	if (span.output?.trim()) {
		const summary = jsonDocument(span.output);
		blocks.push({
			id: "step-output",
			slot: "output",
			order: 10,
			caption: "Output summary",
			body: summary.body,
			language: summary.language,
			clamp: CLAMP.block,
		});
	}

	return { blocks };
}
