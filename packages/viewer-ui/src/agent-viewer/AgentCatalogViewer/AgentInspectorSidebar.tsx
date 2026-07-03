// The right-hand inspector: Files/Vars/Tools tabs over context sources, variables, and runtime config.

import cn from "classnames";
import { type ReactNode } from "react";

import type { AgentContextInputSummary, AgentViewerDefinition } from "../types";
import { ChannelBank, ChannelCell, Chip, statusTone, TONE_TEXT } from "./primitives";
import {
	estimateTokensFromBytes,
	extensionLabel,
	formatTimestamp,
	formatValue,
	type SidebarTab,
} from "./shared";

export function AgentInspectorSidebar({
	agent,
	tab,
	onTabChange,
}: {
	agent: AgentViewerDefinition;
	tab: SidebarTab;
	onTabChange: (tab: SidebarTab) => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="h-9 shrink-0 border-b border-border bg-muted/30 p-1">
				<ChannelBank className="h-full">
					<ChannelCell active={tab === "files"} onClick={() => onTabChange("files")}>
						Files
					</ChannelCell>
					<ChannelCell active={tab === "variables"} onClick={() => onTabChange("variables")}>
						Vars
					</ChannelCell>
					<ChannelCell active={tab === "tools"} onClick={() => onTabChange("tools")}>
						Tools
					</ChannelCell>
				</ChannelBank>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{tab === "files" && <FilesSidebarTab agent={agent} />}
				{tab === "variables" && <VariablesSidebarTab agent={agent} />}
				{tab === "tools" && <ToolsSidebarTab agent={agent} />}
			</div>
		</div>
	);
}

function FilesSidebarTab({ agent }: { agent: AgentViewerDefinition }) {
	const inputs = agent.context?.inputs ?? [];
	return (
		<div className="flex flex-col gap-4">
			<InspectorSection title="Loaded Context">
				<SourcesSummary inputs={inputs} />
			</InspectorSection>
			<InspectorSection title="Context Module">
				<div className="flex flex-col">
					<MiniField label="module" value={agent.context?.modulePath ?? agent.contextModulePath ?? "none"} />
					<MiniField label="build" value={formatTimestamp(agent.context?.timestamp)} />
				</div>
			</InspectorSection>
		</div>
	);
}

function VariablesSidebarTab({ agent }: { agent: AgentViewerDefinition }) {
	const resolvedVariables = agent.renderedPrompt?.resolvedVariables ?? {};
	const variableNames = Object.keys(agent.variables);
	return (
		<InspectorSection title="Variables">
			{variableNames.length > 0 ? (
				<ul className="flex flex-col">
					{variableNames.map((name, idx) => {
						const resolved = Object.hasOwn(resolvedVariables, name);
						const value = resolved ? resolvedVariables[name] : agent.variables[name]?.default;
						return (
							<li
								key={name}
								className={cn(
									"flex flex-col gap-1 py-2",
									idx > 0 && "border-t border-border/60",
								)}
							>
								<div className="flex items-center gap-2">
									<span className="text-[11px] uppercase tracking-[0.12em] text-foreground">{name}</span>
									{!resolved && (
										<span className="rounded-[2px] border border-border bg-muted/40 px-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
											default
										</span>
									)}
								</div>
								<span className="break-words text-[12px] text-muted-foreground">{formatValue(value)}</span>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="text-[12px] text-muted-foreground/70">No variables defined</p>
			)}
		</InspectorSection>
	);
}

function ToolsSidebarTab({ agent }: { agent: AgentViewerDefinition }) {
	return (
		<div className="flex flex-col gap-4">
			<InspectorSection title="Available Tools">
				{agent.tools.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{agent.tools.map((tool) => (
							<Chip key={tool}>{tool}</Chip>
						))}
					</div>
				) : (
					<p className="text-[12px] text-muted-foreground/70">No tools declared</p>
				)}
				{agent.disallowedTools.length > 0 && (
					<div className="mt-3">
						<p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
							Disallowed
						</p>
						{renderStringList(agent.disallowedTools)}
					</div>
				)}
			</InspectorSection>

			<InspectorSection title="Runtime">
				<div className="flex flex-col">
					<MiniField label="model" value={agent.model} />
					<MiniField label="source" value={agent.source ?? "markdown"} />
					{agent.prompt?.schemaVersion && (
						<MiniField label="schema" value={agent.prompt.schemaVersion} />
					)}
					{agent.maxTurns !== null && (
						<MiniField label="max turns" value={agent.maxTurns.toString()} />
					)}
					<MiniField label="thinking" value={agent.thinking ?? "default"} />
					<MiniField label="background" value={String(agent.runInBackground)} />
					<MiniField label="extensions" value={extensionLabel(agent.extensions)} />
					<MiniField label="can spawn" value={String(agent.canSpawnSubagent)} />
					<MiniField label="rendered" value={formatTimestamp(agent.renderedPrompt?.timestamp)} />
				</div>
			</InspectorSection>

			<InspectorSection title="Files">
				<div className="flex flex-col">
					<MiniField label="agent_file" value={agent.agentFile} />
					<MiniField label="context_module" value={agent.contextModulePath ?? "none"} />
				</div>
			</InspectorSection>
		</div>
	);
}

function SourcesSummary({ inputs }: { inputs: AgentContextInputSummary[] }) {
	if (inputs.length === 0) {
		return <p className="text-[12px] text-muted-foreground/70">No sources loaded</p>;
	}

	const totalBytes = inputs.reduce((sum, input) => sum + (input.bytes ?? 0), 0);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
				<span>
					{inputs.length} source{inputs.length === 1 ? "" : "s"}
				</span>
				<span className="tabular-nums">{estimateTokensFromBytes(totalBytes).toLocaleString()}</span>
			</div>
			<div className="max-h-48 overflow-y-auto">
				<table className="w-full border-collapse">
					<tbody>
						{inputs.map((input, idx) => {
							const tone = statusTone(input.status);
							return (
								<tr
									key={`${input.loaderKind}:${input.inputRef}:${idx}`}
									className={cn("align-middle", idx > 0 && "border-t border-border/60")}
								>
									<td className="py-1.5 pr-2">
										<span className={cn("text-[10px] uppercase tracking-[0.1em]", TONE_TEXT[tone])}>
											{input.status}
										</span>
									</td>
									<td className="py-1.5 pr-2 text-[11px] text-muted-foreground">{input.loaderKind}</td>
									<td className="max-w-0 py-1.5 pr-2">
										<span className="block truncate text-[11px] text-foreground" title={input.inputRef}>
											{input.inputRef}
										</span>
									</td>
									<td className="py-1.5 text-right tabular-nums text-[11px] text-muted-foreground">
										{estimateTokensFromBytes(input.bytes).toLocaleString()}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function renderStringList(items: string[]): ReactNode {
	if (items.length === 0) return <span className="font-mono text-xs text-muted-foreground/60">none</span>;
	return (
		<div className="flex flex-wrap gap-1">
			{items.map((item) => (
				<Chip key={item}>{item}</Chip>
			))}
		</div>
	);
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section>
			<h3 className="mb-2 flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					{title}
				</span>
				<span className="h-px flex-1 bg-border" />
			</h3>
			{children}
		</section>
	);
}

function MiniField({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
			<span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
			<span className="max-w-[60%] break-all text-right text-[12px] tabular-nums text-foreground">{value}</span>
		</div>
	);
}
