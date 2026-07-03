"use client";

// Composition root: agent list/grouping, three-panel layout, and view-mode state wiring.

import cn from "classnames";
import { useMemo, useState, type ReactNode } from "react";

import type { AgentViewerDefinition } from "../types";
import { AgentDetail } from "./AgentDetail";
import { AgentInspectorSidebar } from "./AgentInspectorSidebar";
import { Led, Panel } from "./primitives";
import type { FontScale, Form, Scope, SidebarTab } from "./shared";

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
	selectedName?: string | null;
	onSelectedNameChange?: (name: string) => void;
	className?: string;
	emptyState?: ReactNode;
}

function groupKey(agent: AgentViewerDefinition): string {
	if (agent.group) return agent.group;
	const match = agent.agentFile.match(/\/agents\/([^/]+)\//);
	const segment = match?.[1];
	if (segment && (GROUP_ORDER as readonly string[]).includes(segment)) return segment;
	return "other";
}

function groupAgents(agents: AgentViewerDefinition[]) {
	const groups = new Map<string, AgentViewerDefinition[]>();
	for (const agent of agents) {
		const key = groupKey(agent);
		const bucket = groups.get(key) ?? [];
		bucket.push(agent);
		groups.set(key, bucket);
	}

	const ordered: Array<{ group: string; agents: AgentViewerDefinition[] }> = [];
	for (const group of GROUP_ORDER) {
		const bucket = groups.get(group);
		if (bucket?.length) ordered.push({ group, agents: bucket });
	}
	for (const [group, bucket] of groups) {
		if (!(GROUP_ORDER as readonly string[]).includes(group)) ordered.push({ group, agents: bucket });
	}
	return ordered;
}

export function AgentCatalogViewer({
	agents,
	selectedName,
	onSelectedNameChange,
	className,
	emptyState,
}: AgentCatalogViewerProps) {
	const [internalSelectedName, setInternalSelectedName] = useState<string | null>(null);
	const [scope, setScope] = useState<Scope>("system");
	const [form, setForm] = useState<Form>("rendered");
	const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
	const [fontScale, setFontScale] = useState<FontScale>("small");
	const grouped = useMemo(() => groupAgents(agents), [agents]);
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

	return (
		<div className={cn("@container flex min-h-0 w-full gap-3 font-mono", className)}>
			{/* ── Catalog ─────────────────────────────────────────── */}
			<Panel className="w-60 shrink-0">
				<div className="min-h-0 flex-1 overflow-auto">
					<div className="flex flex-col gap-2 p-2">
						{grouped.map(({ group, agents: groupAgentsList }) => (
							<section
								key={group}
								className="overflow-hidden rounded-[3px] border border-border bg-background/40"
							>
								<h2 className="flex h-6 items-center border-b border-border px-2.5">
									<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
										{GROUP_LABEL[group] ?? group}
									</span>
								</h2>
								<ul className="flex flex-col">
									{groupAgentsList.map((agent, idx) => {
										const isSelected = agent.name === selectedAgent.name;
										return (
											<li key={agent.name}>
												<button
													type="button"
													onClick={() => setSelectedName(agent.name)}
													aria-pressed={isSelected}
													className={cn(
														"flex w-full items-center gap-2 px-2.5 text-left transition-colors",
														idx > 0 && "border-t border-border/60",
														isSelected
															? "bg-status-success-fill/40 text-foreground"
															: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
													)}
													style={{ height: 32 }}
												>
													<span className="inline-flex w-1.5 shrink-0 justify-center">
														{isSelected && <Led tone="green" pulse />}
													</span>
													<span className="min-w-0 flex-1 truncate text-[13px]">
														{agent.name}
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				</div>
			</Panel>

			{/* ── Detail ──────────────────────────────────────────── */}
			<Panel className="min-w-0 flex-1">
				<AgentDetail
					agent={selectedAgent}
					scope={scope}
					onScopeChange={setScope}
					form={form}
					onFormChange={setForm}
					fontScale={fontScale}
					onFontScaleChange={setFontScale}
				/>
			</Panel>

			{/* ── Inspector ───────────────────────────────────────── */}
			<Panel className="hidden w-[30rem] shrink-0 @[78rem]:flex">
				<AgentInspectorSidebar agent={selectedAgent} tab={sidebarTab} onTabChange={setSidebarTab} />
			</Panel>
		</div>
	);
}
