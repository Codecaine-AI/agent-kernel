export type RunArtifactsProps = {
	scoutReportCount: number;
	reportCount: number;
};

/** "Artifacts": the counts of scout reports and reports. */
export function RunArtifacts({ scoutReportCount, reportCount }: RunArtifactsProps) {
	return (
		<div>
			<div className="mb-2 text-ui-xs font-bold uppercase text-muted-foreground">Artifacts</div>
			<div className="grid grid-cols-2 gap-2 text-ui-lg">
				<div className="rounded border border-border bg-background/25 px-3.5 py-3">
					<div className="text-ui-lg font-bold">{scoutReportCount}</div>
					<div className="mt-0.5 text-ui-xs text-muted-foreground">scout reports</div>
				</div>
				<div className="rounded border border-border bg-background/25 px-3.5 py-3">
					<div className="text-ui-lg font-bold">{reportCount}</div>
					<div className="mt-0.5 text-ui-xs text-muted-foreground">reports</div>
				</div>
			</div>
		</div>
	);
}
