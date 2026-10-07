import cn from "classnames";

import { formatP, type BarMarker, type BarQuestion } from "./utils";

export type { BarAnswer, BarQuestion, BarThreshold } from "./utils";
export { gateQuestionBars, questionBars } from "./utils";

export type ProbabilityBarsProps = {
	question: BarQuestion;
};

const LABEL_TEXT = "font-mono text-[length:var(--ds-font-size-ui-xs)]";

/** Every distinct marker of the question, once, for the legend under the bars. */
function legendOf(question: BarQuestion): BarMarker[] {
	const seen = new Map<string, BarMarker>();
	for (const row of question.rows) {
		for (const marker of row.markers) seen.set(`${marker.kind}:${marker.label}`, marker);
	}
	return [...seen.values()];
}

/**
 * One decision question as probability bars in the decision hue, each with
 * its threshold or floor line in the strong border color, then the legend.
 */
export function ProbabilityBars({ question }: ProbabilityBarsProps) {
	const legend = legendOf(question);
	return (
		<div
			data-probability-bars={question.id}
			data-bars-state={question.empty ? "empty" : question.abstained ? "abstain" : "answered"}
			className="min-w-0 space-y-1.5"
		>
			<div className="flex min-w-0 items-baseline gap-2">
				<span title={question.id} className={cn(LABEL_TEXT, "min-w-0 truncate font-semibold text-foreground")}>
					{question.id}
				</span>
				<span className="text-[length:var(--ds-font-size-ui-2xs)] uppercase tracking-[var(--ds-letter-spacing-micro)] text-muted-foreground">
					{question.kind}
				</span>
				<span
					data-bars-outcome=""
					className={cn(
						LABEL_TEXT,
						"ml-auto",
						question.abstained ? "text-status-warning" : "text-foreground",
					)}
				>
					{question.outcome}
				</span>
			</div>
			{question.empty ? (
				<p className="text-[length:var(--ds-font-size-ui-xs)] text-muted-foreground">
					No probability came back for this question.
				</p>
			) : (
				question.rows.map((row) => (
					<div key={row.label} data-bar-row={row.label} className="flex min-w-0 items-center gap-2">
						<span title={row.label} className={cn(LABEL_TEXT, "w-24 shrink-0 truncate text-foreground")}>
							{row.label}
						</span>
						<span className="relative h-2 min-w-0 flex-1 rounded-pill bg-muted">
							<span
								data-bar-fill={row.chosen ? "chosen" : "other"}
								className={cn(
									"absolute inset-y-0 left-0 rounded-pill",
									row.chosen ? "bg-pink-solid" : "bg-pink-line",
								)}
								style={{ width: `${row.widthPct}%` }}
							/>
							{row.markers.map((marker) => (
								<span
									key={marker.kind}
									data-bar-marker={marker.kind}
									title={marker.label}
									className="absolute -inset-y-1 -translate-x-1/2 border-l-rail border-rule-strong"
									style={{ left: `${marker.positionPct}%` }}
								/>
							))}
						</span>
						<span className={cn(LABEL_TEXT, "w-10 shrink-0 text-right tabular-nums text-foreground")}>
							{row.value === null ? "—" : formatP(row.value)}
						</span>
					</div>
				))
			)}
			{legend.length > 0 ? (
				<div className="flex flex-wrap gap-x-3 text-[length:var(--ds-font-size-ui-2xs)] text-muted-foreground">
					{legend.map((marker) => (
						<span key={`${marker.kind}:${marker.label}`} data-bar-legend={marker.kind} className="flex items-center gap-1">
							<span aria-hidden="true" className="h-3 border-l-rail border-rule-strong" />
							{marker.label}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}
