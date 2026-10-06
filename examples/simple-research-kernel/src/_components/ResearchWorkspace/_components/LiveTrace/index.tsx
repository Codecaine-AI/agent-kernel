import { KernelTraceViewer, type KernelTraceViewerProps } from "@agent-kernel/viewer-shell";

import { KERNEL_TRACE_API_BASE } from "@/shared/api";
import type { TraceIconSettings } from "@/shared/style-settings";

export type LiveTraceProps = {
	loading: boolean;
	hasActiveRun: boolean;
	hasActiveDetail: boolean;
	spans: KernelTraceViewerProps["spans"];
	traceIcons: TraceIconSettings;
};

/** The live trace beside the run column, or the state that stands in for it. */
export function LiveTrace({ loading, hasActiveRun, hasActiveDetail, spans, traceIcons }: LiveTraceProps) {
	return (
		<div className="min-h-0 overflow-hidden">
			{loading && hasActiveRun && !hasActiveDetail ? (
				<div className="flex h-full items-center justify-center text-ui-lg text-muted-foreground">
					Loading live trace...
				</div>
			) : !hasActiveRun ? (
				<div className="flex h-full items-center justify-center text-ui-lg text-muted-foreground">
					Start a research run.
				</div>
			) : !hasActiveDetail ? (
				<div className="flex h-full items-center justify-center text-ui-lg text-muted-foreground">
					Waiting for live trace...
				</div>
			) : (
				<KernelTraceViewer
					className="flex h-full flex-col"
					spans={spans}
					initialTraceLevel={3}
					apiBase={KERNEL_TRACE_API_BASE}
					iconSide={traceIcons.side}
					iconStyle={traceIcons.style}
				/>
			)}
		</div>
	);
}
