// The prompt pane: header, warnings, tab strip, and the inline lab / rendered prompt surface.

import cn from "classnames";
import { useMemo } from "react";
import { createPromptPreviewModel } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptView } from "../../trace-viewer/detail-panel/PromptView";
import { PromptInlineLab } from "../PromptInlineLab";
import type { AgentViewerDefinition } from "../types";
import { Led } from "./primitives";
import { ScopeTabBar } from "./ScopeTabBar";
import { FONT_SCALE_TO_SIZE, pad2, type FontScale, type Form, type Scope } from "./shared";

export function AgentDetail({
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

function PromptPlaceholder({ message }: { message: string }) {
	return <p className="text-[12px] text-muted-foreground/70">{message}</p>;
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
