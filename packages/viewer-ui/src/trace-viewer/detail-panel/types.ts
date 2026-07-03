import type { TraceSpan } from "@evilmartians/agent-prism-types";

import type { AgentRun, KernelContainerSummary } from "@agent-kernel/viewer-core";

import type { RunUsageRow } from "../usage-summary";

/**
 * The workspace-level usage data a container/phase/session/run renderer needs
 * to fold its own aggregate. Optional everywhere: renderers fall back to their
 * plain behavior when it is absent.
 */
export type UsageContext = {
	runs: AgentRun[];
	container?: KernelContainerSummary | null;
	/** Select a run's span in the tree from an aggregate's run row. */
	onRunSelect?: (row: RunUsageRow) => void;
};

export type RendererProps = {
	span: TraceSpan;
	usageContext?: UsageContext;
};
