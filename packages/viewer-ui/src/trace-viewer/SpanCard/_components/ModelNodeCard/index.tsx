import type { CSSProperties } from "react";

import type { IconSide, IconStyle, SpanIconDescriptor } from "../../../icons";
import type { NodeSpanDisplay } from "../../node-display";
import { TraceCard } from "../../TraceCard";
import { CARD_LINE_LABEL, CARD_TYPE_LABEL } from "../../variants/card-type";
import { KindBadge } from "../KindBadge";
import { ResultChip } from "../ResultChip";

export type ModelNodeCardProps = {
	display: NodeSpanDisplay;
	/** The shared card chrome SpanCard resolves for every row (status wins). */
	chrome: {
		descriptor: SpanIconDescriptor;
		side: IconSide;
		style: IconStyle;
		label: string;
	};
};

/** Names up to this many characters never truncate; longer ones keep at least this many. */
const NAME_MIN_CH = 18;

/**
 * Width goes in this order when a row is narrow: the duration chip first, then
 * a long name down to NAME_MIN_CH characters, then the attempts chip, and the
 * result chip last. Flex-shrink weights far apart make that order (almost)
 * strict; chips that no longer fit wrap below their 18px line (the label line,
 * CARD_LINE_LABEL) and are clipped, so a chip is shown whole or not at all.
 */
const SHRINK = { duration: 1_000_000, name: 1000, chips: 1 } as const;

/** Kept geometry: one 18px chip line; anything that wraps below it is clipped. */
const CHIP_LINE_HEIGHT = "18px";

const CHIP_LINE_CLASS = "flex min-w-0 flex-wrap items-center overflow-hidden";

/** The name keeps NAME_MIN_CH mono characters (`ch` is exact); a short name never shrinks. */
function nameStyle(title: string): CSSProperties {
	return title.length <= NAME_MIN_CH
		? { ...CARD_LINE_LABEL, flexShrink: 0 }
		: { ...CARD_LINE_LABEL, minWidth: `${NAME_MIN_CH}ch`, flexShrink: SHRINK.name };
}

/**
 * A call, decision, step or gate row: kind badge, name (full name in its
 * tooltip), then the chips — the result, `×m` attempts on a retried node row,
 * the duration.
 */
export function ModelNodeCard({ display, chrome }: ModelNodeCardProps) {
	return (
		<TraceCard
			kind={chrome.descriptor.kind}
			group={chrome.descriptor.group}
			side={chrome.side}
			style={chrome.style}
			label={chrome.label}
			frameData={{ "data-node-kind": display.type }}
		>
			<KindBadge type={display.type} label={display.badge} />
			<span
				data-node-name=""
				title={display.tooltip}
				style={nameStyle(display.title)}
				className={`${CARD_TYPE_LABEL} truncate font-medium`}
			>
				{display.title}
			</span>
			<span
				data-node-chips=""
				className={`${CHIP_LINE_CLASS} gap-x-1.5`}
				style={{ height: CHIP_LINE_HEIGHT, flexShrink: SHRINK.chips }}
			>
				{display.result ? (
					<ResultChip kind="result" tone={display.result.tone} label={display.result.label} />
				) : null}
				{display.attempts !== null ? (
					<ResultChip kind="attempts" tone="neutral" label={`×${display.attempts}`} />
				) : null}
			</span>
			{display.duration ? (
				<span
					data-node-duration=""
					className={CHIP_LINE_CLASS}
					style={{ height: CHIP_LINE_HEIGHT, flexShrink: SHRINK.duration }}
				>
					{/* A zero-width, full-height first item holds line one, so the chip wraps out
					    whole (onto the clipped second line) instead of shrinking to a sliver. */}
					<span aria-hidden="true" className="h-full w-0" />
					<ResultChip kind="duration" tone="neutral" label={display.duration} />
				</span>
			) : null}
		</TraceCard>
	);
}
