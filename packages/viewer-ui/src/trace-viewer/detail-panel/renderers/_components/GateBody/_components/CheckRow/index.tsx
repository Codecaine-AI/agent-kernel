import { gateQuestionBars, ProbabilityBars } from "../../../DecisionBody";
import { pillTone, type GateCheck } from "../../utils";
import { ResultPill } from "../ResultPill";

export type CheckRowProps = {
	check: GateCheck;
};

/**
 * One gate check: its result pill, name and kind, the value or reason it
 * recorded, and for a decide check each question's probability against its
 * pass and fail lines.
 */
export function CheckRow({ check }: CheckRowProps) {
	const note = check.error ?? check.reason ?? check.value;
	return (
		<li data-gate-check={check.name} data-gate-check-result={check.result} className="min-w-0 space-y-2">
			<div className="flex min-w-0 items-center gap-2">
				<ResultPill kind="check" label={check.result} tone={pillTone(check.result)} />
				<span className="min-w-0 truncate font-mono text-[length:var(--ds-font-size-ui-xs)] font-semibold text-foreground">
					{check.name}
				</span>
				<span className="shrink-0 text-[length:var(--ds-font-size-ui-2xs)] uppercase tracking-[var(--ds-letter-spacing-micro)] text-muted-foreground">
					{check.kind}
				</span>
				{note ? (
					<span
						data-gate-check-note=""
						className={`ml-auto min-w-0 truncate font-mono text-[length:var(--ds-font-size-ui-xs)] ${check.error ? "text-destructive" : "text-muted-foreground"}`}
					>
						{note}
					</span>
				) : null}
			</div>
			{check.questions.length > 0 ? (
				<div className="min-w-0 space-y-2 pl-2">
					{check.questions.map((question) => (
						<ProbabilityBars key={question.question_id} question={gateQuestionBars(question)} />
					))}
				</div>
			) : null}
		</li>
	);
}
