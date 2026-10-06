import { useMemo } from "react";
import type { KernelTraceSessionDetail } from "@agent-kernel/viewer-core";
import { AgentCatalogViewer } from "@agent-kernel/viewer-ui";

import type { ResearchAgentSummary } from "@/shared/types";
import { toAgentViewerDefinitions } from "./agent-viewer-adapter";
import { collectLatestContextPreviews, collectLatestRenderedPrompts } from "./trace-selectors";

export type AgentsWorkspaceProps = {
	agents: ResearchAgentSummary[] | undefined;
	detail: KernelTraceSessionDetail | null;
	selectedAgentName: string | null;
	onAgentSelect: (agentName: string) => void;
};

/**
 * Agents workspace: a single surface — the agent list (navigation) beside the
 * prompt lab shell (pure editor + AGENT/VIEW/PROMPT/DETAILS sidebar). The lab
 * talks to the kernel catalog API — served by the same API server as the trace
 * reads and reached through the Vite `/kernel` proxy, hence the empty baseUrl —
 * and prompt/manifest edits land on disk with live registry hot-swap.
 */
export function AgentsWorkspace({
	agents,
	detail,
	selectedAgentName,
	onAgentSelect
}: AgentsWorkspaceProps) {
	const renderedPrompts = useMemo(() => collectLatestRenderedPrompts(detail), [detail]);
	const contextPreviews = useMemo(() => collectLatestContextPreviews(detail), [detail]);
	const agentViewerDefinitions = useMemo(
		() => toAgentViewerDefinitions(agents ?? [], renderedPrompts, contextPreviews),
		[contextPreviews, agents, renderedPrompts]
	);

	return (
		<div className="flex h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] w-full flex-col">
			<AgentCatalogViewer
				agents={agentViewerDefinitions}
				baseUrl=""
				selectedName={selectedAgentName}
				onSelectedNameChange={onAgentSelect}
				className="h-full"
			/>
		</div>
	);
}
