import {
	AgentCatalogViewer,
	type AgentViewerDefinition
} from "@agent-kernel/viewer-ui";

type AgentsWorkspaceProps = {
	agents: AgentViewerDefinition[];
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
	selectedAgentName,
	onAgentSelect
}: AgentsWorkspaceProps) {
	return (
		<div className="flex h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] w-full flex-col">
			<AgentCatalogViewer
				agents={agents}
				baseUrl=""
				selectedName={selectedAgentName}
				onSelectedNameChange={onAgentSelect}
				className="h-full"
			/>
		</div>
	);
}
