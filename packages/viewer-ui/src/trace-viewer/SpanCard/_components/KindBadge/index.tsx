import type { NodeDisplayType } from "../../../icons";
import type { NodeKindBadge } from "../../node-display";
import { CARD_LINE_META, CARD_TYPE_META } from "../../variants/card-type";

/**
 * The kind tile always wears the kind's own hue (design-system hue tokens,
 * categorical), even when status recolors the row frame red or amber, so a
 * failed call still reads CALL in teal. A gate stays neutral like its frame.
 */
const BADGE_CLASS: Record<NodeDisplayType, string> = {
	call: "bg-teal-soft text-teal",
	decision: "bg-pink-soft text-pink",
	step: "bg-gray-soft text-gray",
	gate: "bg-muted text-muted-foreground",
};

export type KindBadgeProps = {
	type: NodeDisplayType;
	label: NodeKindBadge;
};

/** The CALL / DECIDE / STEP / GATE tile that leads a model-node row. */
export function KindBadge({ type, label }: KindBadgeProps) {
	return (
		<span
			data-node-kind-badge={type}
			style={CARD_LINE_META}
			className={`${CARD_TYPE_META} shrink-0 rounded-[var(--ds-radius-base)] px-1 py-0.5 font-semibold uppercase tracking-[var(--ds-letter-spacing-micro-wide)] ${BADGE_CLASS[type]}`}
		>
			{label}
		</span>
	);
}
