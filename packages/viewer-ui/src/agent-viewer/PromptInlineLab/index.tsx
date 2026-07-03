"use client";

// The prompt lab: split editor/inspector layout with undo/redo history + save state.

import cn from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import { createPromptEditorModel, type PromptStep } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "../prompt-flow/PromptFlowInspector";
import { PromptFlowSections } from "../prompt-flow/PromptFlowSections";
import { PromptFlowXml } from "../prompt-flow/PromptFlowXml";
import type { PromptFlowMode } from "../prompt-flow/types";
import { createPromptLabHistory } from "../prompt-lab-history";
import { DiagnosticsFooter } from "./DiagnosticsFooter";
import { PinnedChrome } from "./PinnedChrome";

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
	// Agent XML is the primary editing surface: it is shaped like what the
	// agent actually receives. Sections is the secondary, human-convenience
	// arrangement of the same blocks.
	const [mode, setMode] = useState<PromptFlowMode>("xml");
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
			<div className="flex min-h-0 flex-1 overflow-hidden">
				{/* Left column is exclusively the editor surface — gutter + lines,
				    full height, no competing chrome. */}
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

				{/* Right column: a PINNED chrome zone (status + controls) above the
				    inspector, which scrolls beneath it. All the editor chrome that
				    used to sit atop the editor now lives here so the editor stays
				    pure. */}
				<div className="flex w-72 shrink-0 flex-col border-l border-border bg-card @[72rem]:w-80">
					<PinnedChrome
						mode={mode}
						onMode={setMode}
						dirty={dirty}
						errorCount={errorCount}
						warningCount={warningCount}
						tokenCount={tokenCount}
						savedHash={currentSavedHash}
						canUndo={history.canUndo()}
						canRedo={history.canRedo()}
						saving={saving}
						hasSave={Boolean(onSave)}
						onUndo={undo}
						onRedo={redo}
						onReset={resetDraft}
						onSave={() => void handleSave()}
					/>
					<PromptFlowInspector
						prompt={model.prompt}
						model={model}
						selectedEntry={explicitSelectedEntry}
						onPromptChange={handlePromptChange}
					/>
				</div>
			</div>

			<DiagnosticsFooter diagnostics={diagnostics} saveErrors={saveErrors} />
		</section>
	);
}
