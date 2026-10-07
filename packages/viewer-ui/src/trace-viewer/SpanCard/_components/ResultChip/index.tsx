import type { NodeChipTone } from "../../node-display";
import { CARD_LINE_META, CARD_TYPE_META } from "../../variants/card-type";

/** Status tones from the host contract's status roles; neutral is the code-chip fill. */
const TONE_CLASS: Record<NodeChipTone, string> = {
	success: "bg-status-success-fill text-status-success",
	danger: "bg-destructive/10 text-destructive",
	warning: "bg-status-warning-fill text-status-warning",
	neutral: "bg-agentprism-code-base text-agentprism-muted-foreground",
};

export type ResultChipProps = {
	label: string;
	tone: NodeChipTone;
	/** What the chip reports; a stable DOM hook for tests and routes. */
	kind: "result" | "duration" | "attempts";
};

/** One inline chip on a model-node row: the result, the duration, or the attempt count. */
export function ResultChip({ label, tone, kind }: ResultChipProps) {
	return (
		<span
			data-node-chip={kind}
			data-node-chip-tone={tone}
			style={CARD_LINE_META}
			className={`${CARD_TYPE_META} shrink-0 whitespace-nowrap rounded-[var(--ds-radius-base)] px-1.5 py-0.5 tabular-nums ${TONE_CLASS[tone]}`}
		>
			{label}
		</span>
	);
}
