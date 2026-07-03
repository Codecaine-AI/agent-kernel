/**
 * UsageAggregateRenderer — the PRIMARY tab for container / phase / agent-session
 * / run spans.
 *
 * These spans carry no input/output of their own, so the BaseRenderer used to
 * dead-end them at "No input or output for this event." Instead we fold the
 * runs that fall under the span (matched by the workspace's runs/container data,
 * threaded in via RendererProps.usageContext) into a usage aggregate: totals,
 * a per-agent breakdown, and the run rows.
 *
 * Falls back to BaseRenderer when there is no usage context (the viewer was
 * rendered without one) or the scope catches no runs.
 */
import type { RendererProps } from "../types";
import { BaseRenderer } from "./BaseRenderer";
import { TotalsStrip, AgentBreakdown, RunsTable } from "../../UsageSummaryPanel";
import { aggregateUsageForScope, usageScopeForSpanId } from "../../usage-summary";

const META = "font-mono text-[11px] leading-[14px]";

function scopeLabel(kind: string): string {
	switch (kind) {
		case "container":
			return "Container usage";
		case "phase":
			return "Phase usage";
		case "session":
			return "Session usage";
		case "run":
			return "Run usage";
		default:
			return "Usage";
	}
}

export function UsageAggregateRenderer({ span, usageContext }: RendererProps) {
	const scope = usageScopeForSpanId(span.id);
	if (!usageContext || !scope) return <BaseRenderer span={span} />;

	const aggregate = aggregateUsageForScope({
		scope,
		runs: usageContext.runs,
		container: usageContext.container ?? null,
	});
	if (!aggregate) return <BaseRenderer span={span} />;

	return (
		<div className="flex flex-col gap-3">
			<span className={`${META} uppercase tracking-[0.12em] text-muted-foreground`}>
				{scopeLabel(scope.kind)}
			</span>
			<TotalsStrip totals={aggregate.totals} />
			<AgentBreakdown byAgent={aggregate.byAgent} />
			<RunsTable runs={aggregate.runs} onRunSelect={usageContext.onRunSelect} />
		</div>
	);
}
