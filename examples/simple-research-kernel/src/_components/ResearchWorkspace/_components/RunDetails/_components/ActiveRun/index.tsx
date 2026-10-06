import type { ResearchRunSummary } from "@/shared/types";

export type ActiveRunProps = {
	activeRun: ResearchRunSummary;
	activeRunError: string | null;
};

/** "Active Run": the run's status with a live pulse, its prompt and its error. */
export function ActiveRun({ activeRun, activeRunError }: ActiveRunProps) {
	return (
		<div>
			<div className="mb-2 text-ui-xs font-bold uppercase text-muted-foreground">Active Run</div>
			<div
				className={`rounded border px-3.5 py-3.5 text-ui-lg ${
					activeRun.status === "error"
						? "border-destructive/40 bg-destructive/10 text-destructive"
						: "border-status-info-border bg-status-info-fill text-status-info"
				}`}
			>
				<div className="flex items-center gap-2 font-bold">
					<span
						className={`h-1.5 w-1.5 rounded-full ${
							activeRun.status === "error" ? "bg-destructive" : "bg-status-info tk-pulse"
						}`}
						aria-hidden
					/>
					<span>{activeRun.status}</span>
				</div>
				<div className="mt-1 line-clamp-3 text-ui-xs leading-[var(--ds-space-5)]">{activeRun.prompt}</div>
				{activeRunError && (
					<div className="mt-2 rounded border border-current/25 bg-background/45 px-2 py-1.5 text-ui-xs leading-[var(--ds-space-5)]">
						{activeRunError}
					</div>
				)}
			</div>
		</div>
	);
}
