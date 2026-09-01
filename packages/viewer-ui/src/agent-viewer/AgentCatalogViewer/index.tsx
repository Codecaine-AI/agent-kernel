"use client";

// Composition root: the agent list/grouping (navigation) beside the prompt
// lab shell (editor + AGENT/VIEW/PROMPT/DETAILS sidebar) for the selected
// agent. The catalog/lab split collapsed into a single surface.

import cn from "classnames";
import { useMemo, useState, type ReactNode } from "react";

import { AgentPromptLabContainer } from "../AgentPromptLabContainer";
import type {
	LabConfigZone,
	LabContextPreview,
	LabToolsZone,
} from "@codecaine-ai/prompt-kit/ui/lab";
import type { PromptStyleSettings } from "@codecaine-ai/prompt-kit/ui/style";
import type { AgentViewerDefinition } from "../types";
import { Panel } from "./primitives";

const GROUP_ORDER = ["intake", "spec", "plan", "build", "docs", "research", "other"] as const;
const GROUP_LABEL: Record<string, string> = {
	intake: "Intake",
	spec: "Spec",
	plan: "Plan",
	build: "Build",
	docs: "Docs",
	research: "Research",
	other: "Other",
};

export interface AgentCatalogViewerProps {
	agents: AgentViewerDefinition[];
	/** Kernel API origin for the catalog read/write endpoints (defaults to ""). */
	baseUrl?: string;
	selectedName?: string | null;
	onSelectedNameChange?: (name: string) => void;
	className?: string;
	emptyState?: ReactNode;
	/** Labels to add to or override the built-in catalog group labels. */
	groupLabels?: Record<string, string>;
	/** Groups to show first, followed by built-in and otherwise unknown groups. */
	groupOrder?: string[];
	/** Static TOOLS zone or a zone derived from the selected agent. */
	toolsZone?: LabToolsZone | ((agent: AgentViewerDefinition) => LabToolsZone | undefined);
	/** Static inline CONFIG zone or a zone derived from the selected agent. */
	configZone?: LabConfigZone | ((agent: AgentViewerDefinition) => LabConfigZone | undefined);
	/** Viewer-only style settings passed to the prompt lab. */
	styleSettings?: PromptStyleSettings;
	/** Whether prompt and manifest editing is enabled. Defaults to true. */
	editable?: boolean;
	/** Use each catalog definition's parsed prompt instead of fetching agent detail. */
	useAgentDefinitions?: boolean;
}

function groupKey(agent: AgentViewerDefinition, knownGroups: readonly string[]): string {
	if (agent.group) return agent.group;
	const match = agent.agentFile.match(/\/agents\/([^/]+)\//);
	const segment = match?.[1];
	if (segment && knownGroups.includes(segment)) return segment;
	return "other";
}

function groupAgents(agents: AgentViewerDefinition[], order: readonly string[]) {
	const groups = new Map<string, AgentViewerDefinition[]>();
	for (const agent of agents) {
		const key = groupKey(agent, order);
		const bucket = groups.get(key) ?? [];
		bucket.push(agent);
		groups.set(key, bucket);
	}

	const ordered: Array<{ group: string; agents: AgentViewerDefinition[] }> = [];
	for (const group of order) {
		const bucket = groups.get(group);
		if (bucket?.length) ordered.push({ group, agents: bucket });
	}
	for (const [group, bucket] of groups) {
		if (!order.includes(group)) ordered.push({ group, agents: bucket });
	}
	return ordered;
}

function contextPreviewFor(agent: AgentViewerDefinition): LabContextPreview | undefined {
	if (!agent.context) return undefined;
	return {
		renderedContext: agent.context.renderedContext,
		inputs: agent.context.inputs,
		modulePath: agent.context.modulePath ?? agent.contextModulePath,
	};
}

export function AgentCatalogViewer({
	agents,
	baseUrl = "",
	selectedName,
	onSelectedNameChange,
	className,
	emptyState,
	groupLabels,
	groupOrder,
	toolsZone,
	configZone,
	styleSettings,
	editable = true,
	useAgentDefinitions = false,
}: AgentCatalogViewerProps) {
	const [internalSelectedName, setInternalSelectedName] = useState<string | null>(null);
	const effectiveGroupLabels = useMemo(
		() => ({ ...GROUP_LABEL, ...groupLabels }),
		[groupLabels],
	);
	const effectiveGroupOrder = useMemo(
		() => Array.from(new Set([...(groupOrder ?? []), ...GROUP_ORDER])),
		[groupOrder],
	);
	const grouped = useMemo(
		() => groupAgents(agents, effectiveGroupOrder),
		[agents, effectiveGroupOrder],
	);
	const effectiveSelectedName = selectedName ?? internalSelectedName ?? agents[0]?.name ?? null;
	const selectedAgent = agents.find((agent) => agent.name === effectiveSelectedName) ?? agents[0] ?? null;

	const setSelectedName = (name: string) => {
		setInternalSelectedName(name);
		onSelectedNameChange?.(name);
	};

	if (agents.length === 0 || !selectedAgent) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70",
					className,
				)}
			>
				{emptyState ?? "No agents registered"}
			</div>
		);
	}

	const selectedToolsZone =
		typeof toolsZone === "function" ? toolsZone(selectedAgent) : toolsZone;
	const selectedConfigZone =
		typeof configZone === "function" ? configZone(selectedAgent) : configZone;

	return (
		<div className={cn("@container flex min-h-0 w-full gap-3 font-mono", className)}>
			{/* ── Catalog navigation ──────────────────────────────── */}
			<Panel className="w-60 shrink-0">
				<nav aria-label="Agents" className="min-h-0 flex-1 overflow-auto">
					<div className="flex flex-col">
						{grouped.map(({ group, agents: groupAgentsList }) => (
							<section
								key={group}
								className="[&+&]:border-t [&+&]:border-border"
							>
								<h2 className="px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-foreground/70">
									{effectiveGroupLabels[group] ?? group}
								</h2>
								<ul className="flex flex-col">
									{groupAgentsList.map((agent) => {
										const isSelected = agent.name === selectedAgent.name;
										return (
											<li key={agent.name}>
												<button
													type="button"
													onClick={() => setSelectedName(agent.name)}
													aria-pressed={isSelected}
													className={cn(
														"relative w-full py-2 pl-7 pr-4 text-left text-xs font-semibold transition-colors",
														isSelected
															? "bg-muted text-foreground"
															: "text-muted-foreground hover:bg-muted/50",
													)}
												>
													{isSelected && (
														<span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
													)}
													<span className="block truncate">{agent.name}</span>
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				</nav>
			</Panel>

			{/* ── Lab shell ───────────────────────────────────────── */}
			<Panel className="min-w-0 flex-1">
				<AgentPromptLabContainer
					key={selectedAgent.name}
					baseUrl={baseUrl}
					agentName={selectedAgent.name}
					definition={useAgentDefinitions ? selectedAgent : undefined}
					context={contextPreviewFor(selectedAgent)}
					toolsZone={selectedToolsZone}
					configZone={selectedConfigZone}
					styleSettings={styleSettings}
					editable={editable}
					className="h-full"
				/>
			</Panel>
		</div>
	);
}
