import type { DetailBlockSpec, DetailZone } from "../../contract";
import { CLAMP } from "../../doc-figure/clamp";
import type { DocInlineRow } from "../../doc-figure/DocFigure";
import type { SanitizedMessage } from "../request-snapshot-api";
import { parseStateOutline } from "../state-outline";
import type { TurnMessageEntry } from "../turn-sections";
import {
	imagesOf,
	sourceTextOf,
	TurnMessageList,
	TurnThumbnails,
} from "./turn-block-content";

export interface StateSectionProps {
	state: readonly TurnMessageEntry<SanitizedMessage>[];
	tail: readonly TurnMessageEntry<SanitizedMessage>[];
	apiBase: string;
	stateOrder?: number;
	tailOrder?: number;
}

export interface StateSectionResult {
	blocks: DetailBlockSpec[];
	/** The tab's surfaces, shown one at a time through the shell's subtabs. */
	zones: DetailZone[];
}

const STATE_BLOCK_ID = "turn:state";
const MESSAGES_BLOCK_ID = "turn:recent-messages";

/**
 * Section ③. Authorship is positional: everything in `state` is output of
 * render(state), even when a provider transported an attached-render message
 * with role:"user". Only `tail` is conversation.
 *
 * The State tab rests as two SURFACES shown one at a time — State and Messages
 * (state-tab-options.html R2.1, as revised when the index rail and then the
 * focus posture were both cut on review).
 *
 * The state is ONE CONTINUOUS FIGURE. The attached renders are embedded INSIDE
 * it as an inline row at the `<views>` line rather than cut out into a second
 * card between a head and a tail — Ford, verbatim: "It's like focus state, the
 * attached renders, then state continued — this is really confusing. I'd like
 * the images to be almost in line." The payload is untouched: the figure's
 * source is the whole render, and the embedded row contributes no bytes. When
 * the payload cannot be indexed there is no `<views>` anchor, so the renders
 * settle at the document's foot and the figure still shows every byte.
 */
export function StateSection({
	state,
	tail,
	apiBase,
	stateOrder = 30,
	tailOrder = 40,
}: StateSectionProps): StateSectionResult {
	const blocks: DetailBlockSpec[] = [];
	const stateEntries =
		state.length > 0
			? state
			: [{ index: -1, message: { role: "custom", content: [] } }];

	const primary = stateEntries[0]!;
	// Positionally, the first state message is the render(state) payload — unless
	// it is itself an attachment carrier, in which case there is no figure to index.
	const primaryIsFigure = imagesOf(primary.message).length === 0;
	const primarySource = sourceTextOf(primary.message) || "No state rendered.";
	const outline = primaryIsFigure ? parseStateOutline(primarySource) : null;

	// Every attached render across the state range, embedded as ONE inline row.
	const renderEntries = stateEntries.filter(
		(entry) => imagesOf(entry.message).length > 0,
	);
	const renderImages = renderEntries.flatMap((entry) => imagesOf(entry.message));
	const embeddedIndices = new Set(renderEntries.map((entry) => entry.index));

	// The reference point: just after </views> when the payload is indexable,
	// otherwise the foot of the document (DocFigure clamps out-of-range rows).
	const views = outline?.blocks.find((block) => block.tag === "views");
	const anchorLine = views?.endLine ?? primarySource.split("\n").length;
	// The carrier's own text IS the kernel's caption for these pixels ("attached
	// renders, newest first: …"), so it rides along under the attribution rather
	// than being dropped with the card it used to arrive in. Its authorship is
	// positional: quiet document voice, never a USER badge.
	const renderCaption = renderEntries
		.map((entry) => sourceTextOf(entry.message).trim())
		.filter((text) => text.length > 0)
		.join(" · ");
	const inlineRows: DocInlineRow[] =
		renderImages.length === 0
			? []
			: [
					{
						afterLine: anchorLine,
						label: "Attached renders · kernel",
						node: (
							// Capped so the images stay read-in-place instead of
							// stretching to the width of the longest source line.
							<div className="min-w-0 max-w-[40rem] space-y-1.5">
								{renderCaption.length > 0 ? (
									<p className="whitespace-normal break-words text-[11px] leading-5 text-muted-foreground">
										{renderCaption}
									</p>
								) : null}
								<TurnThumbnails apiBase={apiBase} images={renderImages} />
							</div>
						),
					},
				];

	const stateBlockIds: string[] = [];

	stateEntries.forEach((entry, entryIndex) => {
		const isFigure = entryIndex === 0 && primaryIsFigure;
		if (!isFigure && embeddedIndices.has(entry.index)) return;
		const id = isFigure ? STATE_BLOCK_ID : `turn:state-message:${entry.index}`;
		stateBlockIds.push(id);
		blocks.push({
			id,
			slot: "content",
			caption: isFigure ? "State" : "State message",
			body: isFigure
				? primarySource
				: sourceTextOf(entry.message) || "No state rendered.",
			language: "xml",
			...(isFigure && inlineRows.length > 0 ? { inlineRows } : {}),
			// Deliberately no clamp: the state lives only in the Turn body, so it
			// INHERITS the primary-figure reading window (see primary-figure).
			// This is the inheritance path a future tab renderer takes.
			order: stateOrder + entryIndex,
			turnSection: "state",
		});
	});

	if (tail.length > 0) {
		// No wrapper figure: every message is already a card, so the stream floats
		// straight on the Messages surface (Ford, review 2026-07-28 — "the messages
		// can just be there floating because it is just the message itself").
		blocks.push({
			id: MESSAGES_BLOCK_ID,
			slot: "content",
			caption: "Messages",
			node: (
				<TurnMessageList
					entries={tail}
					apiBase={apiBase}
					subsection="tail"
				/>
			),
			selfFramed: true,
			clamp: CLAMP.none,
			expandable: false,
			order: tailOrder,
			turnSection: "state",
		});
	}

	// ─── Surfaces ─────────────────────────────────────────────────────────────
	// State and Messages are alternatives, shown one at a time (R2.1 as built).
	const zones: DetailZone[] = [
		{ id: "state", name: "State", blockIds: stateBlockIds },
	];
	if (tail.length > 0) {
		zones.push({
			id: "messages",
			name: "Messages",
			blockIds: [MESSAGES_BLOCK_ID],
		});
	}

	return { blocks, zones };
}
