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

/**
 * A call, decision, step or gate row: kind badge, title, then the chips —
 * `×m` attempts on a retried node row, the result, the duration.
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
				style={CARD_LINE_LABEL}
				className={`${CARD_TYPE_LABEL} min-w-0 truncate font-medium`}
			>
				{display.title}
			</span>
			{display.attempts !== null ? (
				<ResultChip kind="attempts" tone="neutral" label={`×${display.attempts}`} />
			) : null}
			{display.result ? (
				<ResultChip kind="result" tone={display.result.tone} label={display.result.label} />
			) : null}
			{display.duration ? (
				<ResultChip kind="duration" tone="neutral" label={display.duration} />
			) : null}
		</TraceCard>
	);
}
