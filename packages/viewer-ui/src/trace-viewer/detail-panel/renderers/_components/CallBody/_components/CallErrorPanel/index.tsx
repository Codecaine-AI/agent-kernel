import cn from "classnames";

import type { FactRow } from "../../../../node-facts";
import { FieldTable } from "../../../FieldTable";

export type CallErrorPanelProps = {
	outcome: "error" | "aborted";
	rows: readonly FactRow[];
};

/** Why the call failed (red) or was aborted (amber): the engine's error kind, message and HTTP status. */
export function CallErrorPanel({ outcome, rows }: CallErrorPanelProps) {
	const aborted = outcome === "aborted";
	return (
		<div
			className={cn(
				"space-y-2 rounded-[var(--ds-radius-base)] border p-3",
				aborted
					? "border-status-warning-border bg-status-warning-fill/30"
					: "border-destructive/60 bg-destructive/10",
			)}
		>
			<p
				className={cn(
					"text-[length:var(--ds-font-size-ui-xs)] font-medium uppercase tracking-[var(--ds-letter-spacing-micro)]",
					aborted ? "text-status-warning" : "text-destructive",
				)}
			>
				{aborted ? "Call aborted" : "Call failed"}
			</p>
			<FieldTable rows={rows} />
		</div>
	);
}
