import type { PillTone } from "../../utils";

const TONE_CLASS: Record<PillTone, string> = {
	success: "bg-status-success-fill text-status-success",
	danger: "bg-destructive/10 text-destructive",
	warning: "bg-status-warning-fill text-status-warning",
	neutral: "bg-muted text-muted-foreground",
};

export type ResultPillProps = {
	label: string;
	tone: PillTone;
	/** "verdict" for the gate's own pill, "check" for a check row's. */
	kind: "verdict" | "check";
};

/** A gate verdict or check result pill (the WarningRenderer check-badge pattern). */
export function ResultPill({ label, tone, kind }: ResultPillProps) {
	return (
		<span
			data-gate-pill={kind}
			data-gate-pill-tone={tone}
			className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[length:var(--ds-font-size-ui-xs)] font-medium ${TONE_CLASS[tone]}`}
		>
			{label}
		</span>
	);
}
