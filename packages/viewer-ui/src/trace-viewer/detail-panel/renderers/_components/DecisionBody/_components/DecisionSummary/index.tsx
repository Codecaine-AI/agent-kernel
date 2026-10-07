import type { DecisionBadgeSet } from "../../utils";

export type DecisionBadgesProps = {
	badges: DecisionBadgeSet;
};

const BADGE =
	"rounded-[var(--ds-radius-base)] px-1.5 py-0.5 font-mono text-[length:var(--ds-font-size-ui-2xs)]";

/**
 * The decision's provenance at a glance: its confidence source (`native`) in
 * the decision hue, the engine with the served model (`jev · jev-1.13.0`),
 * and the requested model when routing served another.
 */
export function DecisionBadges({ badges }: DecisionBadgesProps) {
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			{badges.confidenceSource ? (
				<span data-decision-badge="confidence" title="Confidence source" className={`${BADGE} bg-pink-soft text-pink`}>
					{badges.confidenceSource}
				</span>
			) : null}
			{badges.engineModel ? (
				<span data-decision-badge="engine" title="Engine · served model" className={`${BADGE} bg-muted text-foreground`}>
					{badges.engineModel}
				</span>
			) : null}
			{badges.requested ? (
				<span data-decision-badge="requested" title="Requested model" className={`${BADGE} bg-muted text-muted-foreground`}>
					requested {badges.requested}
				</span>
			) : null}
		</div>
	);
}
