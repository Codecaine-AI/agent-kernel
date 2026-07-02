"use client";

import cn from "classnames";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import { createPromptEditorModel } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "./prompt-flow/PromptFlowInspector";
import { PromptFlowSections } from "./prompt-flow/PromptFlowSections";
import { PromptFlowXml } from "./prompt-flow/PromptFlowXml";
import type { PromptFlowMode } from "./prompt-flow/types";

export interface PromptInlineLabProps {
	prompt: PromptDocument;
	declaredVariables?: string[];
	renderVariables?: Record<string, unknown>;
	className?: string;
	onDraftChange?: (prompt: PromptDocument) => void;
}

export function PromptInlineLab({
	prompt,
	declaredVariables = [],
	renderVariables,
	className,
	onDraftChange,
}: PromptInlineLabProps) {
	const [draftPrompt, setDraftPrompt] = useState<PromptDocument>(() =>
		createPromptEditorModel(prompt, { declaredVariables, renderVariables }).prompt,
	);
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
	const [mode, setMode] = useState<PromptFlowMode>("sections");
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		const next = createPromptEditorModel(prompt, {
			declaredVariables,
			renderVariables,
		});
		setDraftPrompt(next.prompt);
		setSelectedNodeId(undefined);
		setDirty(false);
	}, [prompt, declaredVariables, renderVariables]);

	const model = useMemo(
		() =>
			createPromptEditorModel(draftPrompt, {
				selectedNodeId,
				declaredVariables,
				renderVariables,
			}),
		[draftPrompt, selectedNodeId, declaredVariables, renderVariables],
	);

	const diagnostics = model.validation.diagnostics;
	const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const tokenCount = useMemo(() => estimateTokenCount(model.rendered), [model.rendered]);
	const explicitSelectedEntry = selectedNodeId
		? model.tree.find((entry) => entry.id === selectedNodeId)
		: undefined;

	function commit(nextPrompt: PromptDocument, nextSelectedNodeId = selectedNodeId) {
		const nextModel = createPromptEditorModel(nextPrompt, {
			selectedNodeId: nextSelectedNodeId,
			declaredVariables,
			renderVariables,
		});
		setDraftPrompt(nextModel.prompt);
		setSelectedNodeId(nextSelectedNodeId);
		setDirty(true);
		onDraftChange?.(nextModel.prompt);
	}

	function resetDraft() {
		const next = createPromptEditorModel(prompt, {
			declaredVariables,
			renderVariables,
		});
		setDraftPrompt(next.prompt);
		setSelectedNodeId(undefined);
		setDirty(false);
		onDraftChange?.(next.prompt);
	}

	return (
		<section className={cn("@container flex h-full min-h-0 flex-1 flex-col bg-card font-mono", className)}>
			<header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
				<div className="mr-auto min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
							Prompt Editor
						</span>
						<StatusChip tone={dirty ? "amber" : "neutral"}>{dirty ? "draft" : "source"}</StatusChip>
						<StatusChip tone={errorCount > 0 ? "red" : warningCount > 0 ? "amber" : "green"}>
							{errorCount > 0 ? `${errorCount} err` : warningCount > 0 ? `${warningCount} warn` : "valid"}
						</StatusChip>
						<span className="tabular-nums text-[11px] text-muted-foreground">
							{tokenCount.toLocaleString()}
							<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55">tok</span>
						</span>
					</div>
					<p className="mt-1 max-w-[56rem] truncate text-[11px] text-muted-foreground/70">
						{mode === "sections"
							? "Edit the prompt as a rendered section flow with inline insert and drag/drop."
							: "Edit the same prompt through the agent-facing XML Markdown flow."}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-1">
					<ModeButton active={mode === "sections"} onClick={() => setMode("sections")}>
						Sections
					</ModeButton>
					<ModeButton active={mode === "xml"} onClick={() => setMode("xml")}>
						Agent XML
					</ModeButton>
					<button
						type="button"
						onClick={resetDraft}
						disabled={!dirty}
						className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-background disabled:hover:text-muted-foreground"
						title="Reset draft"
						aria-label="Reset draft"
					>
						<RotateCcw size={13} />
					</button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
					{mode === "sections" ? (
						<PromptFlowSections
							prompt={model.prompt}
							model={model}
							selectedEntry={explicitSelectedEntry}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
							onPromptChange={commit}
						/>
					) : (
						<PromptFlowXml
							prompt={model.prompt}
							model={model}
							selectedEntry={explicitSelectedEntry}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
							onPromptChange={commit}
						/>
					)}
				</div>
				<PromptFlowInspector
					prompt={model.prompt}
					model={model}
					selectedEntry={explicitSelectedEntry}
					onPromptChange={commit}
				/>
			</div>

			{diagnostics.length > 0 && (
				<footer className="max-h-24 shrink-0 overflow-auto border-t border-border bg-background/80">
					{diagnostics.map((diagnostic, index) => (
						<div
							key={`${diagnostic.code}:${index}`}
							className={cn(
								"flex items-start gap-2 px-3 py-1.5 text-[11px]",
								index > 0 && "border-t border-border/60",
								diagnostic.severity === "error" ? "text-destructive" : "text-status-warning",
							)}
						>
							<span className="mt-1 h-px w-3 shrink-0 bg-current opacity-60" />
							<span className="min-w-0 flex-1">
								<span className="font-medium uppercase tracking-[0.1em]">{diagnostic.code}</span>
								<span className="mx-1 text-muted-foreground/60">/</span>
								{diagnostic.message}
							</span>
						</div>
					))}
				</footer>
			)}
		</section>
	);
}

function ModeButton({
	active,
	onClick,
	children,
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
			className={cn(
				"flex h-7 items-center rounded-[2px] border px-2 text-[11px] uppercase tracking-[0.1em] transition-colors",
				active
					? "border-status-success-border bg-status-success-fill/40 text-status-success"
					: "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function StatusChip({
	tone,
	children,
}: {
	tone: "green" | "amber" | "red" | "neutral";
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-[2px] border px-1.5 text-[10px] uppercase tracking-[0.08em]",
				tone === "green" && "border-status-success-border bg-status-success-fill/30 text-status-success",
				tone === "amber" && "border-status-warning-border bg-status-warning-fill/30 text-status-warning",
				tone === "red" && "border-destructive/45 bg-destructive/10 text-destructive",
				tone === "neutral" && "border-border bg-muted/30 text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}
