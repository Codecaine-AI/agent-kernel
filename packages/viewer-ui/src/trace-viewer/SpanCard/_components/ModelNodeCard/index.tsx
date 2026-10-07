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
 * A long name starts from the spacing token `space.1 × 36` (about 18 label
 * characters) and grows into whatever the chips leave; a short name keeps its
 * own width.
 */
const LONG_NAME_CLASS = "min-w-0 grow basis-36 truncate";
const SHORT_NAME_CLASS = "shrink-0";

/** Names this long or shorter never need truncating, so they never take the flex basis. */
const SHORT_NAME_CHARS = 18;

/**
 * A call, decision, step or gate row: kind badge, name (full name in its
 * tooltip), then the chips — the result, `×m` attempts on a retried node row,
 * the duration.
 *
 * The chips are required, so they never shrink, truncate or clip: they sit in
 * their own non-shrinking, non-wrapping slot outside the name, and only the
 * name truncates. When even the name's basis and the chips do not fit on one
 * line, the row wraps and the chips move, whole, to a visible second line.
 */
export function ModelNodeCard({ display, chrome }: ModelNodeCardProps) {
	const longName = display.title.length > SHORT_NAME_CHARS;
	return (
		<TraceCard
			kind={chrome.descriptor.kind}
			group={chrome.descriptor.group}
			side={chrome.side}
			style={chrome.style}
			label={chrome.label}
			frameData={{ "data-node-kind": display.type }}
		>
			<div data-node-row="" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
				<KindBadge type={display.type} label={display.badge} />
				<span
					data-node-name=""
					title={display.tooltip}
					style={CARD_LINE_LABEL}
					className={`${CARD_TYPE_LABEL} font-medium ${longName ? LONG_NAME_CLASS : SHORT_NAME_CLASS}`}
				>
					{display.title}
				</span>
				<span data-node-chips="" className="flex shrink-0 flex-nowrap items-center gap-1.5">
					{display.result ? (
						<ResultChip kind="result" tone={display.result.tone} label={display.result.label} />
					) : null}
					{display.attempts !== null ? (
						<ResultChip kind="attempts" tone="neutral" label={`×${display.attempts}`} />
					) : null}
					{display.duration ? (
						<ResultChip kind="duration" tone="neutral" label={display.duration} />
					) : null}
				</span>
			</div>
		</TraceCard>
	);
}
