"use client";

/**
 * CallBody — the detail body for a kernel.call row (call_container) and its
 * attempt rows (call_attempt): input args, the call's facts, then the typed
 * output field by field with the raw JSON, or on failure the error and the
 * raw model output. Args and output are content-addressed blobs, fetched on
 * demand; `call-output` renders only once the output has loaded.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import cn from "classnames";

import { readStringAttr } from "../../../../span-style";
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { jsonDocument } from "../../json-document";
import { blobStatusBlock, useTraceBlob, type TraceBlobState } from "../../useTraceBlob";
import { FieldTable } from "../FieldTable";
import { callErrorRows, callOutcome, callSummaryRows, outputFields } from "./utils";

export type CallBodyProps = RendererProps;

export type CallBlobs = { input: TraceBlobState; output: TraceBlobState };

function dataBlock(
	id: string,
	caption: string,
	slot: DetailBlockSpec["slot"],
	order: number,
	text: string,
): DetailBlockSpec {
	const doc = jsonDocument(text);
	return { id, slot, order, caption, body: doc.body, language: doc.language, clamp: CLAMP.block };
}

function outputBlocks(output: TraceBlobState): DetailBlockSpec[] {
	if (output.phase !== "loaded") {
		const status = blobStatusBlock(output, {
			id: "call-output",
			caption: "Output",
			slot: "output",
			order: 10,
		});
		return status ? [status] : [];
	}
	const fields = outputFields(output.text);
	if (!fields) return [dataBlock("call-output", "Output", "output", 10, output.text)];
	return [
		{
			id: "call-output",
			slot: "output",
			order: 10,
			caption: "Output",
			node: (
				<FieldTable
					rows={fields.map((field) => ({ key: field.key, label: field.key, value: field.value }))}
				/>
			),
		},
		dataBlock("call-output-json", "Raw JSON", "output", 20, output.text),
	];
}

function failureBlocks(span: TraceSpan, outcome: "error" | "aborted", output: TraceBlobState): DetailBlockSpec[] {
	const blocks: DetailBlockSpec[] = [
		{
			id: "call-error",
			slot: "output",
			order: 0,
			caption: outcome === "aborted" ? "Aborted" : "Error",
			expandable: false,
			node: (
				<div className="space-y-2">
					<p
						className={cn(
							"text-[length:var(--ds-font-size-ui-lg)] font-semibold",
							outcome === "aborted" ? "text-status-warning" : "text-destructive",
						)}
					>
						{outcome === "aborted" ? "Call aborted" : "Call failed"}
					</p>
					<FieldTable rows={callErrorRows(span)} />
				</div>
			),
		},
	];
	if (output.phase === "loaded") {
		blocks.push(dataBlock("call-raw-output", "Raw output", "output", 10, output.text));
	} else {
		const status = blobStatusBlock(output, {
			id: "call-raw-output",
			caption: "Raw output",
			slot: "output",
			order: 10,
		});
		if (status) blocks.push(status);
	}
	return blocks;
}

/** The call view for given blob states; CallBody feeds it the fetched blobs. */
export function buildCallView(span: TraceSpan, blobs: CallBlobs): DetailView {
	const blocks: DetailBlockSpec[] = [];
	if (blobs.input.phase === "loaded") {
		blocks.push(dataBlock("call-input", "Input", "input", 10, blobs.input.text));
	} else {
		const status = blobStatusBlock(blobs.input, {
			id: "call-input",
			caption: "Input",
			slot: "input",
			order: 10,
		});
		if (status) blocks.push(status);
	}

	blocks.push({
		id: "call-summary",
		slot: "content",
		order: 0,
		caption: "Call",
		expandable: false,
		node: <FieldTable rows={callSummaryRows(span)} />,
	});

	const outcome = callOutcome(span);
	if (outcome === "ok") blocks.push(...outputBlocks(blobs.output));
	if (outcome === "error" || outcome === "aborted") {
		blocks.push(...failureBlocks(span, outcome, blobs.output));
	}
	return { blocks };
}

export function CallBody({ span }: CallBodyProps): DetailView {
	const input = useTraceBlob(readStringAttr(span, "input_blob_hash"));
	const output = useTraceBlob(readStringAttr(span, "output_blob_hash"));
	return buildCallView(span, { input, output });
}
