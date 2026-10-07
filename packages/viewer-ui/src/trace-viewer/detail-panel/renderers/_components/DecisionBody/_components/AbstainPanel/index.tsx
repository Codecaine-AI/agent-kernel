import type { AbstainFacts } from "../../utils";
import { FieldTable } from "../../../FieldTable";

export type AbstainPanelProps = {
	facts: AbstainFacts;
};

/** Why the decision abstained: the reason, the engine error kind, and each question's own reason. */
export function AbstainPanel({ facts }: AbstainPanelProps) {
	const rows = [
		{ key: "abstain_reason", label: "Reason", value: facts.reason },
		...(facts.errorKind ? [{ key: "error_kind", label: "Error", value: facts.errorKind }] : []),
		...facts.questions.map((question) => ({
			key: `question:${question.id}`,
			label: `Question · ${question.id}`,
			value: question.reason,
		})),
	];
	return (
		<div className="space-y-2 rounded-[var(--ds-radius-base)] border border-status-warning-border bg-status-warning-fill/30 p-3">
			<p className="text-[length:var(--ds-font-size-ui-xs)] font-medium uppercase tracking-[var(--ds-letter-spacing-micro)] text-status-warning">
				Abstained · {facts.reason}
			</p>
			<FieldTable rows={rows} />
		</div>
	);
}
