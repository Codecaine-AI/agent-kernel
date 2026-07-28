"use client";

import type { ReactNode } from "react";
import cn from "classnames";

import { isImageElisionMarker, isKernelAuthoredMessage } from "@agent-kernel/protocol";

import { DetailImageTrigger } from "../../DetailImageTrigger";
import { DocFigure } from "../../doc-figure/DocFigure";
import {
	GROUP_ACCENT,
	resolveSpanIcon,
	SPAN_CAP_SIZE,
	useTraceIconSettings,
	type SpanDisplayType,
} from "../../../icons";
import { TraceCard } from "../../../SpanCard/TraceCard";
import type {
	SanitizedContentBlock,
	SanitizedImageBlock,
	SanitizedMessage,
} from "../request-snapshot-api";
import { blobUrl } from "../request-snapshot-api";
import {
	contentBlocksOf,
	ImageElisionPlaceholder,
	messageFallbackText,
	KERNEL_ROLE_STYLE,
	roleStyleOf,
	stringifyArguments,
} from "../snapshot-message-view";

export const MESSAGE_ROLE_HEADER_CLASS =
	"shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em]";
export const MESSAGE_BLOCK_LIST_CLASS = "min-w-0 space-y-2 pl-2 pr-2 pb-2";
export const MESSAGE_LIST_CLASS = "min-w-0 space-y-4";

/**
 * A message wears the SAME card as its span in the tree: the message stream is
 * the same conversation, read at a different zoom. Rather than re-declare hues
 * here, each role maps to the tree's display type and the ONE resolver
 * (resolveSpanIcon) hands back the glyph + color group — so a user message is
 * the blue person card, an assistant reply the green chat card, and a tool
 * result the orange wrench card in both surfaces, forever, by construction.
 *
 * Kernel-authored lines are plumbing, not conversation: they resolve through
 * "lifecycle" to the neutral gear card, matching the KERNEL badge they wear.
 */
const MESSAGE_DISPLAY_TYPE: Record<string, SpanDisplayType> = {
	user: "user",
	assistant: "assistant",
	toolResult: "tool",
	bashExecution: "tool",
};

function messageDisplayTypeOf(
	message: SanitizedMessage,
	kernelBadged: boolean,
): SpanDisplayType {
	if (kernelBadged) return "lifecycle";
	return MESSAGE_DISPLAY_TYPE[message.role] ?? "generic";
}

export interface IndexedTurnMessage {
	index: number;
	message: SanitizedMessage;
}

export function imagesOf(
	message: SanitizedMessage,
): SanitizedImageBlock[] {
	return contentBlocksOf(message).flatMap((block) => {
		if (
			block.type !== "image" ||
			typeof (block as { blob_hash?: unknown }).blob_hash !== "string"
		) {
			return [];
		}
		return [block as SanitizedImageBlock];
	});
}

function isImageBlock(
	block: SanitizedContentBlock,
): block is SanitizedImageBlock {
	return (
		block.type === "image" &&
		typeof (block as { blob_hash?: unknown }).blob_hash === "string"
	);
}

function unknownBlockText(block: SanitizedContentBlock): string {
	try {
		return JSON.stringify(block, null, 2);
	} catch {
		return String(block);
	}
}

function dataLanguage(value: string): "json" | "text" {
	try {
		JSON.parse(value);
		return "json";
	} catch {
		return "text";
	}
}

/** Textual source represented by a message, excluding inline image payloads. */
export function sourceTextOf(message: SanitizedMessage): string {
	const parts = contentBlocksOf(message).flatMap((block) => {
		if (block.type === "image") return [];
		if (
			block.type === "text" &&
			typeof (block as { text?: unknown }).text === "string"
		) {
			return [(block as { text: string }).text];
		}
		if (
			block.type === "thinking" &&
			typeof (block as { thinking?: unknown }).thinking === "string"
		) {
			return [(block as { thinking: string }).thinking];
		}
		if (block.type === "toolCall") {
			const call = block as { name?: string; arguments?: unknown };
			const args = stringifyArguments(call.arguments);
			return [`${call.name ?? "tool"}${args ? `\n${args}` : ""}`];
		}
		return [unknownBlockText(block)];
	});
	if (parts.length > 0) return parts.join("\n\n");
	return messageFallbackText(message) ?? "";
}

export function joinMessageSource(entries: readonly IndexedTurnMessage[]): string {
	return entries
		.map(({ message }) => sourceTextOf(message))
		.filter((text) => text.length > 0)
		.join("\n\n");
}

function ContentValue({
	block,
	dataText,
	dataCaption,
}: {
	block: SanitizedContentBlock;
	dataText: boolean;
	dataCaption: string;
}): ReactNode {
	if (
		block.type === "text" &&
		typeof (block as { text?: unknown }).text === "string"
	) {
		const text = (block as { text: string }).text;
		if (isImageElisionMarker(text)) {
			return <ImageElisionPlaceholder text={text} />;
		}
		if (dataText) {
			return (
				<DocFigure
					caption={dataCaption}
					captionTier="subordinate"
					body={text}
					language={dataLanguage(text)}
					dedent={false}
				/>
			);
		}
		return (
			<p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
				{text}
			</p>
		);
	}
	if (
		block.type === "thinking" &&
		typeof (block as { thinking?: unknown }).thinking === "string"
	) {
		const thinking = (block as { thinking: string }).thinking;
		return (
			<DocFigure
				caption="Thinking"
				captionTier="subordinate"
				body={thinking}
				language={dataLanguage(thinking)}
				dedent={false}
			/>
		);
	}
	if (block.type === "toolCall") {
		const call = block as { name?: string; arguments?: unknown };
		const args = stringifyArguments(call.arguments);
		return (
			args ? (
				<DocFigure
					caption="Tool call"
					captionTier="subordinate"
					body={args}
					language={dataLanguage(args)}
					dedent={false}
				/>
			) : (
				<span className="font-mono text-sm font-medium text-trace-tool">
					{call.name ?? "tool"}
				</span>
			)
		);
	}
	const raw = unknownBlockText(block);
	return (
		<DocFigure
			caption="Content block"
			captionTier="subordinate"
			body={raw}
			language={dataLanguage(raw)}
			dedent={false}
		/>
	);
}

export function TurnMessage({
	entry,
	apiBase,
	kernelAuthored = false,
	flatView = false,
}: {
	entry: IndexedTurnMessage;
	apiBase: string;
	/** State-range messages are kernel-authored by position, independent of role. */
	kernelAuthored?: boolean;
	flatView?: boolean;
}) {
	const { message, index } = entry;
	const icons = useTraceIconSettings();
	// Positional authorship (the prop) OR a kernel: customType both badge KERNEL,
	// so both must also wear the kernel card — badge and chrome never disagree.
	const kernelBadged = kernelAuthored || isKernelAuthoredMessage(message);
	const roleLabel = kernelBadged
		? KERNEL_ROLE_STYLE.label
		: roleStyleOf(message).label;
	const descriptor = resolveSpanIcon({
		displayType: messageDisplayTypeOf(message, kernelBadged),
	});
	// The role's text hue is the group's accent — the same token the cap glyph
	// and the band border key off, so the three can never drift apart.
	const accent = GROUP_ACCENT[descriptor.group].text;
	const blocks = contentBlocksOf(message);
	const dataText =
		message.role === "toolResult" || message.role === "bashExecution";
	const dataCaption =
		message.role === "toolResult" ? "Tool result" : "Bash output";
	const contentRuns = blocks.reduce<
		Array<
			| { kind: "block"; block: SanitizedContentBlock; index: number }
			| { kind: "images"; images: SanitizedImageBlock[]; index: number }
		>
	>((runs, block, blockIndex) => {
		if (!isImageBlock(block)) {
			runs.push({ kind: "block", block, index: blockIndex });
			return runs;
		}
		const previous = runs[runs.length - 1];
		if (previous?.kind === "images") {
			previous.images.push(block);
		} else {
			runs.push({ kind: "images", images: [block], index: blockIndex });
		}
		return runs;
	}, []);

	return (
		<TraceCard
			as="article"
			size="box"
			fill
			kind={descriptor.kind}
			group={descriptor.group}
			side={icons.side}
			style={icons.style}
			label={`${roleLabel} message`}
			frameData={{
				"data-message-index": String(index),
				"data-message-role": message.role ?? "unknown",
				...(kernelAuthored ? { "data-message-author": "kernel" } : {}),
				...(flatView ? { "data-turn-view": "flat" } : {}),
			}}
		>
			{/* The role line sits on the cap's own row (SPAN_CAP_SIZE tall) so the
			    card reads exactly like a boxed span card: cap, then the identity of
			    what follows, then the content. */}
			<div
				data-message-role-header=""
				className="flex min-w-0 items-center gap-2"
				style={{ height: SPAN_CAP_SIZE }}
			>
				<span className={cn(MESSAGE_ROLE_HEADER_CLASS, accent)}>
					{roleLabel}
				</span>
				{typeof message.customType === "string" ? (
					<span className="truncate font-mono text-[10px] text-muted-foreground">
						{message.customType}
					</span>
				) : null}
			</div>
			{contentRuns.length > 0 ? (
				<div
					data-message-blocks=""
					className={cn("mt-1", MESSAGE_BLOCK_LIST_CLASS)}
				>
					{contentRuns.map((run) =>
						run.kind === "images" ? (
							<TurnThumbnails
								key={`images:${run.index}`}
								apiBase={apiBase}
								images={run.images}
							/>
						) : (
							<ContentValue
								key={`${run.block.type}:${run.index}`}
								block={run.block}
								dataText={dataText}
								dataCaption={dataCaption}
							/>
						),
					)}
				</div>
			) : (
				<p className="pb-2 pr-2 text-sm leading-7 text-muted-foreground">
					Empty message.
				</p>
			)}
		</TraceCard>
	);
}

export function TurnMessageList({
	entries,
	apiBase,
	kernelAuthored = false,
	subsection,
}: {
	entries: readonly IndexedTurnMessage[];
	apiBase: string;
	kernelAuthored?: boolean;
	subsection?: string;
}) {
	if (entries.length === 0) {
		return <p className="text-sm leading-7 text-muted-foreground">No messages.</p>;
	}
	return (
		<div
			{...(subsection ? { "data-turn-subsection": subsection } : {})}
			className={MESSAGE_LIST_CLASS}
		>
			{entries.map((entry) => (
				<TurnMessage
					key={entry.index}
					entry={entry}
					apiBase={apiBase}
					kernelAuthored={kernelAuthored}
				/>
			))}
		</div>
	);
}

/**
 * A bare grid of attached renders, reusable wherever the images belong to the
 * document rather than to a message — e.g. embedded at the `<views>` line of
 * the state figure.
 */
export function TurnThumbnails({
	apiBase,
	images,
}: {
	apiBase: string;
	images: readonly SanitizedImageBlock[];
}) {
	return (
		<div
			data-turn-thumbnails=""
			className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2"
		>
			{images.map((image, index) => (
				<Thumbnail
					key={`${image.blob_hash}:${index}`}
					apiBase={apiBase}
					image={image}
				/>
			))}
		</div>
	);
}

function Thumbnail({
	apiBase,
	image,
}: {
	apiBase: string;
	image: SanitizedImageBlock;
}) {
	const url = blobUrl(apiBase, image.blob_hash);
	const alt = image.mimeType
		? `${image.mimeType} attachment`
		: "image attachment";
	return (
		<DetailImageTrigger
			image={{ src: url, alt }}
			className="block min-w-0 cursor-zoom-in overflow-hidden rounded-[3px] border border-border/60 bg-muted/20 transition-colors hover:border-status-info-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
			imageClassName="h-28 w-full object-cover"
		/>
	);
}
