"use client";

import cn from "classnames";
import { Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import { createPromptEditorModel, type PromptStep } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "./prompt-flow/PromptFlowInspector";
import { PromptFlowSections } from "./prompt-flow/PromptFlowSections";
import { PromptFlowXml } from "./prompt-flow/PromptFlowXml";
import type { PromptFlowMode } from "./prompt-flow/types";
import { createPromptLabHistory } from "./prompt-lab-history";

export type PromptSaveOutcome = { hash: string } | { errors: string[] };

export interface PromptInlineLabProps {
	prompt: PromptDocument;
	declaredVariables?: string[];
	renderVariables?: Record<string, unknown>;
	className?: string;
	onDraftChange?: (prompt: PromptDocument) => void;
	/**
	 * Persists the current draft. On `{ hash }` the draft becomes the new
	 * saved baseline (undo history survives the boundary); on `{ errors }`
	 * the messages render in the diagnostics footer. The lab never fetches —
	 * hosts wire this to the catalog write API (see AgentPromptLabContainer).
	 */
	onSave?: (doc: PromptDocument) => Promise<PromptSaveOutcome>;
	/** Content hash of the currently saved revision, shown as a chip. */
	savedHash?: string;
}

export function PromptInlineLab({
	prompt,
	declaredVariables = [],
	renderVariables,
	className,
	onDraftChange,
	onSave,
	savedHash,
}: PromptInlineLabProps) {
	const [history, setHistory] = useState(() => createPromptLabHistory(prompt));
	const [editVersion, setEditVersion] = useState(0);
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
	const [mode, setMode] = useState<PromptFlowMode>("sections");
	const [saving, setSaving] = useState(false);
	const [saveErrors, setSaveErrors] = useState<string[]>([]);
	const [currentSavedHash, setCurrentSavedHash] = useState(savedHash);

	const bump = useCallback(() => setEditVersion((version) => version + 1), []);

	useEffect(() => {
		setHistory(createPromptLabHistory(prompt));
		setSelectedNodeId(undefined);
		setSaveErrors([]);
	}, [prompt]);

	useEffect(() => {
		setCurrentSavedHash(savedHash);
	}, [savedHash]);

	// history.current() builds a fresh object; key the memo on the edit
	// version so the model (and the prompt identity handed to views) is
	// stable between edits.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const draftPrompt = useMemo(() => history.current(), [history, editVersion]);
	const model = useMemo(
		() =>
			createPromptEditorModel(draftPrompt, {
				selectedNodeId,
				declaredVariables,
				renderVariables,
			}),
		[draftPrompt, selectedNodeId, declaredVariables, renderVariables],
	);

	const dirty = history.isDirty();
	const diagnostics = model.validation.diagnostics;
	const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const tokenCount = useMemo(() => estimateTokenCount(model.rendered), [model.rendered]);
	const explicitSelectedEntry = selectedNodeId
		? model.tree.find((entry) => entry.id === selectedNodeId)
		: undefined;

	function handlePromptChange(
		nextPrompt: PromptDocument,
		nextSelectedNodeId?: string,
		steps?: PromptStep[],
	) {
		let changed: boolean;
		if (steps) {
			changed = steps.length > 0 && history.commitSteps(steps);
		} else {
			// Stepless calls carry document-metadata edits only (see
			// PromptFlowChangeHandler); node changes always arrive as steps.
			changed = history.commitMeta({
				title: nextPrompt.title,
				description: nextPrompt.description,
			});
		}
		setSelectedNodeId(nextSelectedNodeId);
		if (changed) {
			bump();
			onDraftChange?.(history.current());
		}
	}

	function undo() {
		if (!history.undo()) return;
		bump();
		onDraftChange?.(history.current());
	}

	function redo() {
		if (!history.redo()) return;
		bump();
		onDraftChange?.(history.current());
	}

	function resetDraft() {
		setHistory(createPromptLabHistory(prompt));
		setSelectedNodeId(undefined);
		setSaveErrors([]);
		onDraftChange?.(prompt);
	}

	async function handleSave() {
		if (!onSave || saving || !dirty) return;
		setSaving(true);
		try {
			const outcome = await onSave(history.current());
			if ("hash" in outcome) {
				history.markSaved();
				setCurrentSavedHash(outcome.hash);
				setSaveErrors([]);
				bump();
			} else {
				setSaveErrors(outcome.errors);
			}
		} catch (error) {
			setSaveErrors([error instanceof Error ? error.message : "Save failed"]);
		} finally {
			setSaving(false);
		}
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		const mod = event.metaKey || event.ctrlKey;
		if (!mod || event.key.toLowerCase() !== "z") return;
		event.preventDefault();
		if (event.shiftKey) redo();
		else undo();
	}

	return (
		<section
			onKeyDown={handleKeyDown}
			className={cn("@container flex h-full min-h-0 flex-1 flex-col bg-card font-mono", className)}
		>
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
						{currentSavedHash && (
							<StatusChip tone="neutral">
								<span className="normal-case" title={currentSavedHash}>
									{shortHash(currentSavedHash)}
								</span>
							</StatusChip>
						)}
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
					<IconButton
						onClick={undo}
						disabled={!history.canUndo()}
						title="Undo (mod+z)"
						ariaLabel="Undo"
					>
						<Undo2 size={13} />
					</IconButton>
					<IconButton
						onClick={redo}
						disabled={!history.canRedo()}
						title="Redo (mod+shift+z)"
						ariaLabel="Redo"
					>
						<Redo2 size={13} />
					</IconButton>
					<IconButton onClick={resetDraft} disabled={!dirty} title="Reset draft" ariaLabel="Reset draft">
						<RotateCcw size={13} />
					</IconButton>
					{onSave && (
						<button
							type="button"
							onClick={() => void handleSave()}
							disabled={!dirty || saving}
							className={cn(
								"inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] uppercase tracking-[0.1em] transition-colors",
								dirty && !saving
									? "border-status-success-border bg-status-success-fill/40 text-status-success hover:bg-status-success-fill/60"
									: "cursor-not-allowed border-border bg-background text-muted-foreground opacity-45",
							)}
						>
							<Save size={13} />
							{saving ? "Saving…" : "Save"}
						</button>
					)}
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
							onPromptChange={handlePromptChange}
						/>
					) : (
						<PromptFlowXml
							prompt={model.prompt}
							model={model}
							selectedEntry={explicitSelectedEntry}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
							onPromptChange={handlePromptChange}
						/>
					)}
				</div>
				<PromptFlowInspector
					prompt={model.prompt}
					model={model}
					selectedEntry={explicitSelectedEntry}
					onPromptChange={handlePromptChange}
				/>
			</div>

			{(diagnostics.length > 0 || saveErrors.length > 0) && (
				<footer className="max-h-24 shrink-0 overflow-auto border-t border-border bg-background/80">
					{saveErrors.map((message, index) => (
						<DiagnosticRow
							key={`save:${index}`}
							code="save"
							message={message}
							severity="error"
							bordered={index > 0}
						/>
					))}
					{diagnostics.map((diagnostic, index) => (
						<DiagnosticRow
							key={`${diagnostic.code}:${index}`}
							code={diagnostic.code}
							message={diagnostic.message}
							severity={diagnostic.severity === "error" ? "error" : "warning"}
							bordered={index > 0 || saveErrors.length > 0}
						/>
					))}
				</footer>
			)}
		</section>
	);
}

function shortHash(hash: string): string {
	const bare = hash.startsWith("pk1-") ? hash.slice(4) : hash;
	return bare.slice(0, 10);
}

function DiagnosticRow({
	code,
	message,
	severity,
	bordered,
}: {
	code: string;
	message: string;
	severity: "error" | "warning";
	bordered: boolean;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2 px-3 py-1.5 text-[11px]",
				bordered && "border-t border-border/60",
				severity === "error" ? "text-destructive" : "text-status-warning",
			)}
		>
			<span className="mt-1 h-px w-3 shrink-0 bg-current opacity-60" />
			<span className="min-w-0 flex-1">
				<span className="font-medium uppercase tracking-[0.1em]">{code}</span>
				<span className="mx-1 text-muted-foreground/60">/</span>
				{message}
			</span>
		</div>
	);
}

function IconButton({
	onClick,
	disabled,
	title,
	ariaLabel,
	children,
}: {
	onClick: () => void;
	disabled: boolean;
	title: string;
	ariaLabel: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-background disabled:hover:text-muted-foreground"
			title={title}
			aria-label={ariaLabel}
		>
			{children}
		</button>
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
