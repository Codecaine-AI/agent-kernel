import { AgentCatalogViewer, type AgentViewerDefinition } from "@agent-kernel/viewer-ui";

type AgentsWorkspaceProps = {
	agents: AgentViewerDefinition[];
	selectedAgentName: string | null;
	onAgentSelect: (agentName: string) => void;
};

export function AgentsWorkspace({
	agents,
	selectedAgentName,
	onAgentSelect
}: AgentsWorkspaceProps) {
	return (
		<div className="h-[calc(100vh-2rem)] min-h-[620px] w-full">
			<AgentCatalogViewer
				agents={agents}
				selectedName={selectedAgentName}
				onSelectedNameChange={onAgentSelect}
				className="h-full"
			/>
		</div>
	);
}
