import { useState } from "react";
import {
	AgentCatalogViewer,
	AgentPromptLabContainer,
	type AgentViewerDefinition
} from "@agent-kernel/viewer-ui";

type AgentsWorkspaceProps = {
	agents: AgentViewerDefinition[];
	selectedAgentName: string | null;
	onAgentSelect: (agentName: string) => void;
};

type AgentsView = "catalog" | "lab";

/**
 * Agents workspace: the read-only catalog viewer plus the prompt lab
 * (Phase 5). The lab talks to the kernel catalog API — served by the same
 * API server as the trace reads and reached through the Vite `/kernel`
 * proxy, hence the empty baseUrl — and saves land in prompt.json +
 * prompt_revisions with live registry hot-swap.
 */
export function AgentsWorkspace({
	agents,
	selectedAgentName,
	onAgentSelect
}: AgentsWorkspaceProps) {
	const [view, setView] = useState<AgentsView>("catalog");
	const labAgentName = selectedAgentName ?? agents[0]?.name ?? null;

	return (
		<div className="flex h-[var(--research-workspace-height)] min-h-[var(--research-workspace-min-height)] w-full flex-col gap-2">
			<div className="flex shrink-0 items-center gap-1 font-mono">
				<ViewTab active={view === "catalog"} onClick={() => setView("catalog")}>
					Catalog
				</ViewTab>
				<ViewTab active={view === "lab"} onClick={() => setView("lab")}>
					Prompt Lab
				</ViewTab>
				{view === "lab" && (
					<div className="ml-3 flex items-center gap-1">
						{agents.map((agent) => (
							<ViewTab
								key={agent.name}
								active={agent.name === labAgentName}
								onClick={() => onAgentSelect(agent.name)}
							>
								{agent.name}
							</ViewTab>
						))}
					</div>
				)}
			</div>

			<div className="min-h-0 flex-1">
				{view === "catalog" ? (
					<AgentCatalogViewer
						agents={agents}
						selectedName={selectedAgentName}
						onSelectedNameChange={onAgentSelect}
						className="h-full"
					/>
				) : labAgentName ? (
					<AgentPromptLabContainer
						key={labAgentName}
						baseUrl=""
						agentName={labAgentName}
						className="h-full overflow-hidden rounded-[3px] border border-border"
					/>
				) : (
					<div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
						No agents registered
					</div>
				)}
			</div>
		</div>
	);
}

function ViewTab({
	active,
	onClick,
	children
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={
				active
					? "rounded-[3px] border border-border bg-status-success-fill/40 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-status-success"
					: "rounded-[3px] border border-border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
			}
		>
			{children}
		</button>
	);
}
