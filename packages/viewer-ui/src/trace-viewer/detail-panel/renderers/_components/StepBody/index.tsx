/**
 * StepBody — the detail body for a kernel.step span (step_start paired with
 * step_end). The outcome leads: the step's facts and check result, the error
 * when it threw, its output summary; then its attributes and recorded events.
 */
import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { FieldTable } from "../FieldTable";
import { jsonBlock } from "../JsonFields";
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
			order: 30,
			caption: "Attributes",
			node: <FieldTable rows={attributes} />,
		});
	}

	const events = stepEventRows(span);
	if (events.length > 0) {
		blocks.push({
			id: "step-events",
			slot: "content",
			order: 40,
			caption: "Events",
			node: <FieldTable rows={events} />,
		});
	}

	const error = readStringAttr(span, "error_message");
	if (error) {
		blocks.push({
			id: "step-error",
			slot: "content",
			order: 10,
			caption: "Error",
			body: error,
			language: "text",
			clamp: CLAMP.block,
		});
	}

	if (span.output?.trim()) {
		blocks.push(jsonBlock({ id: "step-output", caption: "Output summary", slot: "content", order: 20 }, span.output));
	}

	return { blocks };
}
