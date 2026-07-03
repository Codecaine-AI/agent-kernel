"use client";

// The prompt lab shell: LEFT is the pure editor surface (or the read-only
// context surface); RIGHT is a stacked sidebar — AGENT, VIEW, PROMPT, DETAILS.

import cn from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import { createPromptEditorModel, type PromptStep } from "@codecaine-ai/prompt-kit/ui";
import { estimateTokenCount } from "tokenx";

import { PromptFlowInspector } from "../prompt-flow/PromptFlowInspector";
import { PromptFlowXml } from "../prompt-flow/PromptFlowXml";
import { createPromptLabHistory } from "../prompt-lab-history";
import { AgentZone } from "./AgentZone";
import { ContextSurface, type LabContextPreview } from "./ContextSurface";
import { DiagnosticsFooter } from "./DiagnosticsFooter";
import { PinnedChrome } from "./PinnedChrome";
import { ViewZone, type LabView } from "./ViewZone";

export type PromptSaveOutcome = { hash: string } | { errors: string[] };
export type ManifestSaveOutcome = { ok: true } | { errors: string[] };

/** AGENT-zone manifest fields surfaced + editable in the sidebar. */
export interface LabManifest {
	name: string;
	model: string;
	description: string;
	modelAliases: string[];
	/** When false the AGENT-zone inputs are read-only (no save endpoint). */
	editable: boolean;
}

export interface PromptInlineLabProps {
	prompt: PromptDocument;
	declaredVariables?: string[];
	renderVariables?: Record<string, unknown>;
	className?: string;
	onDraftChange?: (prompt: PromptDocument) => void;
	/**
	 * Persists the current prompt draft. On `{ hash }` the draft becomes the
	 * new saved baseline (undo history survives); on `{ errors }` the messages
	 * render in the diagnostics footer. The lab never fetches.
	 */
	onSave?: (doc: PromptDocument) => Promise<PromptSaveOutcome>;
	/** Content hash of the currently saved prompt revision, shown as a chip. */
	savedHash?: string;
	/** AGENT-zone manifest data (name/model/description + alias suggestions). */
	manifest?: LabManifest;
	/** Persists AGENT-zone edits (model/description). */
	onManifestSave?: (patch: { model: string; description: string }) => Promise<ManifestSaveOutcome>;
	/** Read-only context preview shown when the VIEW zone selects CONTEXT. */
	context?: LabContextPreview;
}

export function PromptInlineLab({
	prompt,
	declaredVariables = [],
	renderVariables,
	className,
	onDraftChange,
	onSave,
	savedHash,
	manifest,
	onManifestSave,
	context,
}: PromptInlineLabProps) {
	const [history, setHistory] = useState(() => createPromptLabHistory(prompt));
	const [editVersion, setEditVersion] = useState(0);
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const [saveErrors, setSaveErrors] = useState<string[]>([]);
	const [currentSavedHash, setCurrentSavedHash] = useState(savedHash);
	const [view, setView] = useState<LabView>("system");

	// AGENT-zone local edit state (model/description), reset when the source
	// manifest identity changes.
	const [model, setModel] = useState(manifest?.model ?? "");
	const [description, setDescription] = useState(manifest?.description ?? "");
	const [manifestSaving, setManifestSaving] = useState(false);
	const [manifestError, setManifestError] = useState<string | undefined>(undefined);

	const bump = useCallback(() => setEditVersion((version) => version + 1), []);

	useEffect(() => {
		setHistory(createPromptLabHistory(prompt));
		setSelectedNodeId(undefined);
		setSaveErrors([]);
	}, [prompt]);

	useEffect(() => {
		setCurrentSavedHash(savedHash);
	}, [savedHash]);

	useEffect(() => {
		setModel(manifest?.model ?? "");
		setDescription(manifest?.description ?? "");
		setManifestError(undefined);
	}, [manifest?.name, manifest?.model, manifest?.description]);

	// history.current() builds a fresh object; key the memo on the edit
	// version so the model (and prompt identity handed to views) stays stable
	// between edits.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const draftPrompt = useMemo(() => history.current(), [history, editVersion]);
	const model_ = useMemo(
		() =>
			createPromptEditorModel(draftPrompt, {
				selectedNodeId,
				declaredVariables,
				renderVariables,
			}),
		[draftPrompt, selectedNodeId, declaredVariables, renderVariables],
	);

	const dirty = history.isDirty();
	const diagnostics = model_.validation.diagnostics;
	const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const tokenCount = useMemo(() => estimateTokenCount(model_.rendered), [model_.rendered]);
	const explicitSelectedEntry = selectedNodeId
		? model_.tree.find((entry) => entry.id === selectedNodeId)
		: undefined;

	const manifestDirty = Boolean(
		manifest && (model !== manifest.model || description !== manifest.description),
	);
	const inContext = view === "context";

	function handlePromptChange(
		nextPrompt: PromptDocument,
		nextSelectedNodeId?: string,
		steps?: PromptStep[],
	) {
		let changed: boolean;
		if (steps) {
			changed = steps.length > 0 && history.commitSteps(steps);
		} else {
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

	async function handleManifestSave() {
		if (!onManifestSave || manifestSaving || !manifestDirty) return;
		setManifestSaving(true);
		setManifestError(undefined);
		try {
			const outcome = await onManifestSave({ model, description });
			if (!("ok" in outcome)) {
				setManifestError(outcome.errors.join("; "));
			}
		} catch (error) {
			setManifestError(error instanceof Error ? error.message : "Save failed");
		} finally {
			setManifestSaving(false);
		}
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		const mod = event.metaKey || event.ctrlKey;
		if (!mod || event.key.toLowerCase() !== "z") return;
		if (inContext) return;
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
				{/* LEFT: the editor surface — nothing else. In context view the
				    read-only context surface takes its place. */}
				<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
					{inContext ? (
						<ContextSurface context={context} />
					) : (
						<PromptFlowXml
							prompt={model_.prompt}
							model={model_}
							selectedEntry={explicitSelectedEntry}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
							onPromptChange={handlePromptChange}
						/>
					)}
				</div>

				{/* RIGHT: sidebar — AGENT, VIEW, PROMPT zones (pinned) above the
				    DETAILS inspector (scrolls beneath). */}
				<div className="flex w-72 shrink-0 flex-col border-l border-border bg-card @[72rem]:w-80">
					{manifest && (
						<AgentZone
							name={manifest.name}
							model={model}
							description={description}
							modelAliases={manifest.modelAliases}
							dirty={manifestDirty}
							saving={manifestSaving}
							canSave={manifest.editable && Boolean(onManifestSave)}
							onModelChange={setModel}
							onDescriptionChange={setDescription}
							onSave={() => void handleManifestSave()}
							error={manifestError}
						/>
					)}

					<ViewZone view={view} onViewChange={setView} />

					<PinnedChrome
						dirty={dirty}
						errorCount={errorCount}
						warningCount={warningCount}
						tokenCount={tokenCount}
						savedHash={currentSavedHash}
						canUndo={history.canUndo()}
						canRedo={history.canRedo()}
						saving={saving}
						hasSave={Boolean(onSave)}
						disabled={inContext}
						onUndo={undo}
						onRedo={redo}
						onReset={resetDraft}
						onSave={() => void handleSave()}
					/>

					<PromptFlowInspector
						prompt={model_.prompt}
						model={model_}
						selectedEntry={explicitSelectedEntry}
						onPromptChange={handlePromptChange}
					/>
				</div>
			</div>

			<DiagnosticsFooter diagnostics={inContext ? [] : diagnostics} saveErrors={saveErrors} />
		</section>
	);
}
