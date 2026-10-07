import cn from "classnames";

import type { DecisionBadgeSet, VerdictTone } from "../../utils";

export type DecisionSummaryProps = {
	verdict: { label: string; tone: VerdictTone };
	badges: DecisionBadgeSet;
};

const VERDICT_TONE: Record<VerdictTone, string> = {
	success: "text-status-success",
	danger: "text-destructive",
	warning: "text-status-warning",
	neutral: "text-foreground",
};

const BADGE =
	"rounded-[var(--ds-radius-base)] px-1.5 py-0.5 font-mono text-[length:var(--ds-font-size-ui-2xs)]";

/**
 * The decision at a glance: its answer (`pass · p=0.91`), then its provenance:
 * the confidence source (`native`) in the decision hue, the engine with the
 * served model (`jev · jev-1.13.0`), and the requested model when routing
 * served another.
 */
export function DecisionSummary({ verdict, badges }: DecisionSummaryProps) {
	return (
		<div className="min-w-0 space-y-2">
			<p
				data-decision-verdict={verdict.tone}
				className={cn(
					"font-mono text-[length:var(--ds-font-size-ui-lg)] font-semibold",
					VERDICT_TONE[verdict.tone],
				)}
			>
				{verdict.label}
			</p>
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
		</div>
	);
}
