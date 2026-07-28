import type { DetailBlockSpec } from "../../contract";
import { shouldClamp, type ClampPolicy } from "../../doc-figure/clamp";
import { PRIMARY_FIGURE_CLAMP } from "../primary-figure";
import type { TurnMessageEntry } from "../turn-sections";
import type { SanitizedMessage } from "../request-snapshot-api";
import {
	imagesOf,
	joinMessageSource,
	TurnMessageList,
} from "./turn-block-content";

export interface ContextSectionProps {
	entries: readonly TurnMessageEntry<SanitizedMessage>[];
	apiBase: string;
	id?: string;
	caption?: "Context" | "Rendered context";
	body?: string;
	/** Section markers are only emitted for tagged, three-section snapshots. */
	tagged?: boolean;
	language?: DetailBlockSpec["language"];
	clamp?: ClampPolicy;
	expandable?: boolean;
	order?: number;
}

/** Section ②: rebuilt context content, including images at message position. */
export function ContextSection({
	entries,
	apiBase,
	id = "turn:context",
	caption = "Context",
	body: bodyOverride,
	tagged = true,
	language = "prompt",
	clamp = PRIMARY_FIGURE_CLAMP,
	expandable = true,
	order,
}: ContextSectionProps): DetailBlockSpec[] {
	const body = bodyOverride === undefined
		? joinMessageSource(entries) || "No rendered context captured for this turn."
		: bodyOverride;
	const imageEntries = entries.flatMap((entry) => {
		const images = imagesOf(entry.message);
		if (images.length === 0) return [];
		return [
			{
				...entry,
				message: { ...entry.message, content: images },
			},
		];
	});
	const charCount = body.length;
	const renderedContextNeedsDisclosure =
		!tagged &&
		caption === "Rendered context" &&
		shouldClamp(clamp, Math.max(1, body.split("\n").length), charCount);
	return [
		{
			id,
			slot: "content",
			caption,
			body,
			language,
			...(bodyOverride === undefined && imageEntries.length > 0
				? {
						attachments: (
							<TurnMessageList
								entries={imageEntries}
								apiBase={apiBase}
								kernelAuthored
								subsection="context"
							/>
						),
					}
				: {}),
			clamp,
			expandable,
			...(renderedContextNeedsDisclosure
				? { collapsible: true, defaultOpen: false }
				: {}),
			order,
			...(tagged ? { turnSection: "context" as const } : {}),
		},
	];
}
