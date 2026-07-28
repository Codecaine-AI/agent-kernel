"use client";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { readStringAttr } from "./span-style";
import { DetailShell } from "./detail-panel/DetailShell";
import type { DetailBodyRenderer } from "./detail-panel/contract";
import { resolveRenderer } from "./detail-panel/rendererRegistry";
import type { UsageContext } from "./detail-panel/types";

interface Props {
	span: TraceSpan | null;
	usageContext?: UsageContext;
}

function ResolvedDetailBody({
	span,
	usageContext,
	renderer,
}: {
	span: TraceSpan;
	usageContext?: UsageContext;
	renderer: DetailBodyRenderer;
}) {
	// A renderer returns data, but may itself use hooks (TurnBody fetches). This
	// call therefore deliberately occurs inside a component, never in a registry
	// resolver or event handler.
	const view = renderer({ span, usageContext });
	return <DetailShell span={span} view={view} />;
}

export function SpanDetailPanel({ span, usageContext }: Props) {
	if (!span) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Select an event to inspect
			</div>
		);
	}

	const eventType = readStringAttr(span, "event_type") ?? span.type;
	const renderer = resolveRenderer(eventType);
	return (
		<ResolvedDetailBody
			// Different event types select functions with different hook shapes. A
			// span-keyed remount makes that variable hook order safe by construction.
			key={span.id}
			span={span}
			usageContext={usageContext}
			renderer={renderer}
		/>
	);
}
