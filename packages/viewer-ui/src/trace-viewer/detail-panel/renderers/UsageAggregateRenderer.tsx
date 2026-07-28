/**
 * UsageAggregateRenderer — the detail body for container / phase / agent-session
 * / run spans.
 *
 * These spans carry no input/output of their own. Instead we fold the
 * runs that fall under the span (matched by the workspace's runs/container data,
 * threaded in via RendererProps.usageContext) into a usage aggregate: totals,
 * a per-agent breakdown, and the run rows.
 *
 * Falls back to FactCard when there is no usage context (the viewer was
 * rendered without one) or the scope catches no runs.
 */
import type { RendererProps } from "../types";
import type { DetailView } from "../contract";
import { FactCard } from "./FactCard";
import { TotalsStrip, AgentBreakdown, RunsTable } from "../../UsageSummaryPanel";
import { aggregateUsageForScope, usageScopeForSpanId } from "../../usage-summary";

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

export function UsageAggregateRenderer({ span, usageContext }: RendererProps): DetailView {
	const scope = usageScopeForSpanId(span.id);
	if (!usageContext || !scope) return FactCard({ span });

	const aggregate = aggregateUsageForScope({
		scope,
		runs: usageContext.runs,
		container: usageContext.container ?? null,
	});
	if (!aggregate) return FactCard({ span });

	return {
		blocks: [
			{
				id: "usage",
				slot: "content",
				caption: scopeLabel(scope.kind),
				node: (
					<div className="flex flex-col gap-3">
						<TotalsStrip totals={aggregate.totals} />
						<AgentBreakdown byAgent={aggregate.byAgent} />
						<RunsTable runs={aggregate.runs} onRunSelect={usageContext.onRunSelect} />
					</div>
				),
			},
		],
	};
}
