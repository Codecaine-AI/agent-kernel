"use client";

import cn from "classnames";
import { useMemo, useState, type ReactNode } from "react";
import { createPromptPreviewModel } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptView, type PromptViewSize } from "../trace-viewer/detail-panel/PromptView";
import { PromptInlineLab } from "./PromptInlineLab";
import type { AgentContextInputSummary, AgentViewerDefinition } from "./types";

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

type Scope = "system" | "context" | "combined";
type Form = "rendered" | "raw";
type SidebarTab = "files" | "variables" | "tools";
type FontScale = "small" | "medium" | "large";
type Tone = "green" | "amber" | "red" | "cyan" | "neutral";

const FONT_SCALE_TO_SIZE: Record<FontScale, PromptViewSize> = {
	small: "sm",
	medium: "md",
	large: "lg",
};

const TONE_LED: Record<Tone, string> = {
	green: "bg-status-success shadow-[0_0_4px_rgb(84_214_147/0.45)]",
	amber: "bg-status-warning shadow-[0_0_4px_rgb(220_167_76/0.4)]",
	red: "bg-destructive shadow-[0_0_4px_rgb(225_91_88/0.4)]",
	cyan: "bg-status-info shadow-[0_0_4px_rgb(84_211_224/0.4)]",
	neutral: "bg-muted-foreground/35",
};

// Static so Tailwind's JIT can see every class string (no dynamic construction).
const TONE_TEXT: Record<Tone, string> = {
	green: "text-status-success",
	amber: "text-status-warning",
	red: "text-destructive",
	cyan: "text-status-info",
	neutral: "text-muted-foreground",
};

function statusTone(status: string): Tone {
	if (status === "ok") return "green";
	if (status === "error") return "red";
	if (status === "empty") return "amber";
	return "neutral";
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

function substituteDefaults(
	body: string,
	variables: Record<string, { default: unknown }>,
): string {
	return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
		const decl = variables[key];
		if (!decl) return match;
		const value = decl.default;
		if (value === null || value === undefined) return "";
		if (typeof value === "string") return value;
		return JSON.stringify(value);
	});
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

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return value || "\"\"";
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === "object") return `{${Object.keys(value).length} keys}`;
	return String(value);
}

/**
 * Estimate token count from a byte size.
 *
 * Per-file content isn't captured in the kernel trace event (only byte sizes
 * are), so for the trace-level file list we can't run `estimateTokenCount` on
 * raw text. The `~4 chars/token` heuristic tracks tokenx's empirical output
 * (~3.8-4.7 chars/token on real text per its benchmarks). For inline blocks
 * parsed out of the rendered context string we DO have content and use real
 * `estimateTokenCount` directly (see collapseContextFiles).
 */
function estimateTokensFromBytes(bytes: number): number {
	if (!Number.isFinite(bytes) || bytes <= 0) return 0;
	return Math.round(bytes / 4);
}

function formatTimestamp(value: string | null | undefined): string {
	if (!value) return "not rendered";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

// ─── Context forms ───────────────────────────────────────────────
// The directory loader wraps each loaded file in <file path="…">BODY</file>
// (or <file path="…" error="…"/> on failure). For the Raw view we collapse each
// injected body to a self-closing stub, preserving order and surrounding text —
// the "shape" of the context before injection, paralleling how System Raw shows
// the unresolved {{variable}} template.
function collapseContextFiles(rendered: string): string {
	if (!rendered) return "";
	return rendered.replace(
		/<file\s+([^>]*?)\s*>([\s\S]*?)<\/file>/g,
		(_match, attrs: string) => `<file ${String(attrs).trim()} />`,
	);
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

function AgentDetail({
	agent,
	scope,
	onScopeChange,
	form,
	onFormChange,
	fontScale,
	onFontScaleChange,
}: {
	agent: AgentViewerDefinition;
	scope: Scope;
	onScopeChange: (scope: Scope) => void;
	form: Form;
	onFormChange: (form: Form) => void;
	fontScale: FontScale;
	onFontScaleChange: (scale: FontScale) => void;
}) {
	const size = FONT_SCALE_TO_SIZE[fontScale];
	const hasPromptAst = Boolean(agent.prompt);
	const inlinePrompt = form === "rendered" && scope === "system" ? agent.prompt : null;
	const declaredVariableNames = useMemo(() => Object.keys(agent.variables), [agent]);
	const editorVariables = useMemo(() => resolveEditorVariables(agent), [agent]);
	const { content, tokens } = useMemo(
		() => resolvePromptContent(agent, scope, form),
		[agent, scope, form],
	);
	const hasContent = content.trim().length > 0;
	const placeholder = scope === "context" ? "No context captured for this trace." : "No system prompt captured.";
	return (
		<>
			<div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<h2 className="text-lg leading-tight tracking-tight text-foreground">{agent.name}</h2>
					<span className="rounded-[2px] border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
						{agent.model}
					</span>
				</div>
				{agent.description && (
					<p className="text-[13px] leading-relaxed text-muted-foreground">{agent.description}</p>
				)}
			</div>
			{agent.warnings.length > 0 && <WarningsBlock warnings={agent.warnings} />}
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
				<ScopeTabBar
					scope={scope}
					onScopeChange={onScopeChange}
					form={form}
					onFormChange={onFormChange}
					fontScale={fontScale}
					onFontScaleChange={onFontScaleChange}
					tokens={tokens}
					hasPromptAst={hasPromptAst}
				/>
				<div
					className={cn(
						"min-h-0 flex-1 rounded-[3px] border border-border bg-muted/20",
						inlinePrompt ? "overflow-hidden" : "overflow-auto",
					)}
				>
					{inlinePrompt ? (
						<PromptInlineLab
							key={agent.name}
							prompt={inlinePrompt}
							declaredVariables={declaredVariableNames}
							renderVariables={editorVariables}
							className="h-full"
						/>
					) : hasContent ? (
						<PromptView bare content={content} title="Prompt" size={size} />
					) : (
						<div className="p-4">
							<PromptPlaceholder message={placeholder} />
						</div>
					)}
				</div>
			</div>
		</>
	);
}

function WarningsBlock({ warnings }: { warnings: string[] }) {
	return (
		<section className="border-b border-status-warning-border bg-status-warning-fill/20">
			<header className="flex h-8 items-center gap-2 border-b border-status-warning-border/60 px-4">
				<Led tone="amber" pulse />
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-status-warning">
					Warnings
				</span>
				<span className="ml-auto text-[10px] tabular-nums text-status-warning/70">
					{pad2(warnings.length)}
				</span>
			</header>
			<ul className="flex flex-col">
				{warnings.map((warning, idx) => (
					<li
						key={idx}
						className={cn(
							"flex items-start gap-2 px-4 py-1.5 text-[12px] leading-snug text-status-warning/90",
							idx > 0 && "border-t border-status-warning-border/30",
						)}
					>
						<span className="mt-1.5 h-px w-3 shrink-0 bg-status-warning/50" />
						<span>{warning}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function resolvePromptContent(
	agent: AgentViewerDefinition,
	scope: Scope,
	form: Form,
): { content: string; tokens: number } {
	const sourcePreview = agent.prompt ? createPromptPreviewModel(agent.prompt).rendered : null;
	const sourceBody = sourcePreview ?? agent.body;
	const systemRendered = agent.renderedPrompt?.content ?? substituteDefaults(sourceBody, agent.variables);
	const systemRaw = sourceBody;
	const contextRendered = agent.context?.renderedContext ?? "";
	const contextRaw = collapseContextFiles(contextRendered);
	const system = form === "rendered" ? systemRendered : systemRaw;
	const context = form === "rendered" ? contextRendered : contextRaw;
	let content: string;
	if (scope === "system") {
		content = system;
	} else if (scope === "context") {
		content = context;
	} else {
		content = [system, context].filter((part) => part.trim().length > 0).join("\n\n");
	}
	return { content, tokens: estimateTokenCount(content) };
}

function resolveEditorVariables(agent: AgentViewerDefinition): Record<string, unknown> {
	return {
		...Object.fromEntries(
			Object.entries(agent.variables).map(([name, declaration]) => [
				name,
				declaration.default,
			]),
		),
		...(agent.renderedPrompt?.resolvedVariables ?? {}),
	};
}

function ScopeTabBar({
	scope,
	onScopeChange,
	form,
	onFormChange,
	fontScale,
	onFontScaleChange,
	tokens,
	hasPromptAst,
}: {
	scope: Scope;
	onScopeChange: (scope: Scope) => void;
	form: Form;
	onFormChange: (form: Form) => void;
	fontScale: FontScale;
	onFontScaleChange: (scale: FontScale) => void;
	tokens: number;
	hasPromptAst: boolean;
}) {
	return (
		<div className="flex shrink-0 items-stretch overflow-hidden rounded-[3px] border border-border bg-background">
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex">
					<BarCell active={scope === "system"} onClick={() => onScopeChange("system")}>System</BarCell>
					<BarCell active={scope === "context"} onClick={() => onScopeChange("context")}>Context</BarCell>
					<BarCell active={scope === "combined"} onClick={() => onScopeChange("combined")}>Sys + Ctx</BarCell>
				</div>
				<div className="flex border-t border-border">
					<BarCell active={form === "rendered"} onClick={() => onFormChange("rendered")}>
						{hasPromptAst && scope === "system" ? "Inline" : "Rendered"}
					</BarCell>
					<BarCell active={form === "raw"} onClick={() => onFormChange("raw")}>Raw</BarCell>
				</div>
			</div>
			<div className="flex flex-col items-end justify-center gap-1.5 border-l border-border px-3 py-1.5">
				<span className="tabular-nums text-[11px] text-muted-foreground">
					{tokens.toLocaleString()}
					<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55">tok</span>
				</span>
				<FontScaleControl value={fontScale} onChange={onFontScaleChange} />
			</div>
		</div>
	);
}

function BarCell({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"flex h-8 flex-1 items-center justify-center border-r border-border text-[11px] uppercase tracking-[0.12em] transition-colors last:border-r-0",
				active
					? "bg-status-success-fill/40 text-status-success"
					: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function AgentInspectorSidebar({
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



function PromptPlaceholder({ message }: { message: string }) {
	return <p className="text-[12px] text-muted-foreground/70">{message}</p>;
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

function extensionLabel(ext: true | false | string[]): string {
	if (ext === true) return "all";
	if (ext === false) return "disabled";
	return ext.length > 0 ? ext.join(", ") : "none";
}

// ─── Instrument primitives ──────────────────────────────────────────────────

function Panel({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-border bg-card", className)}>
			{children}
		</section>
	);
}



function Led({ tone = "neutral", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", TONE_LED[tone], pulse && "tk-pulse", className)}
		/>
	);
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-[2px] border border-border bg-muted/30 px-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}

function ChannelBank({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("inline-flex overflow-hidden rounded-[3px] border border-border", className)}>{children}</div>;
}

function ChannelCell({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"flex h-7 items-center border-r border-border bg-background px-2.5 text-[11px] uppercase tracking-[0.1em] transition-colors last:border-r-0",
				active
					? "bg-status-success-fill/40 text-status-success"
					: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function FontScaleControl({
	value,
	onChange,
}: {
	value: FontScale;
	onChange: (scale: FontScale) => void;
}) {
	const options: Array<{ key: FontScale; label: string }> = [
		{ key: "small", label: "S" },
		{ key: "medium", label: "M" },
		{ key: "large", label: "L" },
	];
	return (
		<div
			className="inline-flex overflow-hidden rounded-[3px] border border-border bg-background"
			role="group"
			aria-label="Prompt text size"
		>
			{options.map((option) => {
				const active = option.key === value;
				return (
					<button
						key={option.key}
						type="button"
						onClick={() => onChange(option.key)}
						aria-pressed={active}
						title={`${option.key[0].toUpperCase()}${option.key.slice(1)} prompt text`}
						className={cn(
							"flex h-7 w-7 items-center justify-center border-r border-border text-[11px] font-medium uppercase leading-none transition-colors last:border-r-0",
							active
								? "bg-status-success-fill/50 text-status-success"
								: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
