"use client";

/**
 * CallBody — the detail body for a kernel.call row (call_container) and its
 * attempt rows (call_attempt). The answer leads: the typed output field by
 * field with the raw JSON, or on failure the error and the raw model output;
 * then the input args and the call's facts. Args and output are
 * content-addressed blobs, fetched on demand; `call-output` renders only once
 * the output has loaded.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { jsonDocument } from "../../json-document";
import { blobStatusBlock, useTraceBlob, type TraceBlobState } from "../../useTraceBlob";
import { FieldTable } from "../FieldTable";
import { inputBlock } from "../JsonFields";
import { CallErrorPanel } from "./_components/CallErrorPanel";
import { callErrorRows, callOutcome, callSummaryRows, outputFields } from "./utils";

export type CallBodyProps = RendererProps;

export type CallBlobs = { input: TraceBlobState; output: TraceBlobState };

/** Reading order, all in the content slot: the answer, then what was asked, then the facts. */
const ORDER = { error: 0, output: 10, outputJson: 20, input: 30, summary: 40 } as const;

function dataBlock(id: string, caption: string, order: number, text: string): DetailBlockSpec {
	const doc = jsonDocument(text);
	return { id, slot: "content", order, caption, body: doc.body, language: doc.language, clamp: CLAMP.block };
}

function blobBlocks(
	state: TraceBlobState,
	spec: { id: string; caption: string; order: number },
	loaded: (text: string) => DetailBlockSpec[],
): DetailBlockSpec[] {
	if (state.phase === "loaded") return loaded(state.text);
	const status = blobStatusBlock(state, { ...spec, slot: "content" });
	return status ? [status] : [];
}

function outputBlocks(output: TraceBlobState): DetailBlockSpec[] {
	return blobBlocks(output, { id: "call-output", caption: "Output", order: ORDER.output }, (text) => {
		const fields = outputFields(text);
		if (!fields) return [dataBlock("call-output", "Output", ORDER.output, text)];
		return [
			{
				id: "call-output",
				slot: "content",
				order: ORDER.output,
				caption: "Output",
				node: (
					<FieldTable
						rows={fields.map((field) => ({ key: field.key, label: field.key, value: field.value }))}
					/>
				),
			},
			dataBlock("call-output-json", "Raw JSON", ORDER.outputJson, text),
		];
	});
}

function failureBlocks(span: TraceSpan, outcome: "error" | "aborted", output: TraceBlobState): DetailBlockSpec[] {
	return [
		{
			id: "call-error",
			slot: "content",
			order: ORDER.error,
			caption: outcome === "aborted" ? "Aborted" : "Error",
			expandable: false,
			node: <CallErrorPanel outcome={outcome} rows={callErrorRows(span)} />,
		},
		...blobBlocks(output, { id: "call-raw-output", caption: "Raw output", order: ORDER.output }, (text) => [
			dataBlock("call-raw-output", "Raw output", ORDER.output, text),
		]),
	];
}

/** The call view for given blob states; CallBody feeds it the fetched blobs. */
export function buildCallView(span: TraceSpan, blobs: CallBlobs): DetailView {
	const outcome = callOutcome(span);
	const blocks: DetailBlockSpec[] = [];
	if (outcome === "ok") blocks.push(...outputBlocks(blobs.output));
	if (outcome === "error" || outcome === "aborted") {
		blocks.push(...failureBlocks(span, outcome, blobs.output));
	}
	blocks.push(
		...blobBlocks(blobs.input, { id: "call-input", caption: "Input", order: ORDER.input }, (text) => [
			inputBlock({ id: "call-input", caption: "Input", slot: "content", order: ORDER.input }, text),
		]),
		{
			id: "call-summary",
			slot: "content",
			order: ORDER.summary,
			caption: "Call",
			expandable: false,
			node: <FieldTable rows={callSummaryRows(span)} />,
		},
	);
	return { blocks };
}

export function CallBody({ span }: CallBodyProps): DetailView {
	const input = useTraceBlob(readStringAttr(span, "input_blob_hash"));
	const output = useTraceBlob(readStringAttr(span, "output_blob_hash"));
	return buildCallView(span, { input, output });
}
