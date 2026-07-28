"use client";

/**
 * BoardRenderBody — detail body for "app:board-render" events: the host's
 * end-of-turn full-board raster, referenced by content hash. The image is
 * fetched from the kernel blob route only here, in the detail panel that a
 * click on the event row opens — nothing renders in the tree rows, so the
 * viewer's no-unprompted-inline-images rule holds.
 */
import { readNumberAttr, readStringAttr } from "../../span-style";
import type { DetailBlockSpec, DetailView } from "../contract";
import type { RendererProps } from "../types";
import { useTraceViewerApi } from "../TraceViewerApiContext";
import { hasApiBase } from "./request-snapshot-api";
import { BlobImage } from "./snapshot-message-view";

export function BoardRenderBody({ span }: RendererProps): DetailView {
	const { apiBase } = useTraceViewerApi();
	const blobHash = readStringAttr(span, "blob_hash");
	const mimeType = readStringAttr(span, "mime_type") ?? undefined;
	const n = readNumberAttr(span, "n");
	// 0-based pi numbering, matching the "Turn N" span this event nests under.
	const turnNumber = readNumberAttr(span, "turn_number");
	const summary = readStringAttr(span, "summary");

	const facts: string[] = [
		n === undefined ? "Board render" : `Board after change ${n}`,
		...(turnNumber === undefined ? [] : [`Turn ${turnNumber}`]),
		...(summary ? [`Summary: ${summary}`] : []),
	];

	const blocks: DetailBlockSpec[] = [
		{
			id: "facts",
			slot: "content",
			order: -100,
			caption: "Facts",
			node: (
				<ul
					data-fact-list=""
					className="space-y-1 text-sm leading-relaxed text-foreground"
				>
					{facts.map((fact, index) => (
						<li key={`${index}:${fact}`} className="break-words">
							{fact}
						</li>
					))}
				</ul>
			),
			expandable: false,
		},
	];

	if (blobHash) {
		blocks.push({
			id: "board-image",
			slot: "media",
			caption: "Board",
			node: hasApiBase(apiBase) ? (
				<BlobImage apiBase={apiBase} blobHash={blobHash} mimeType={mimeType} />
			) : (
				<span className="break-words text-xs leading-5 text-muted-foreground">
					The board raster is stored in the kernel blob store ({blobHash});
					connect the trace read API to view it.
				</span>
			),
			expandable: false,
		});
	}

	return { blocks };
}
