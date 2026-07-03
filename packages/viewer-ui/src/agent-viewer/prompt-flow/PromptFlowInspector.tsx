"use client";

import cn from "classnames";
import { useEffect, useState, type ReactNode } from "react";
import type {
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	PromptBlockNode,
	PromptDocument,
	RawNode,
	SectionNode,
} from "@codecaine-ai/prompt-kit";
import {
	applySteps,
	inlineToEditableText,
	updatePromptBlockNodeByIdWithStep,
	type PromptEditorModel,
	type PromptEditorTreeEntry,
	type PromptStep,
} from "@codecaine-ai/prompt-kit/ui";

import type { PromptFlowChangeHandler } from "./types";

export interface PromptFlowInspectorProps {
	prompt: PromptDocument;
	model: PromptEditorModel;
	selectedEntry?: PromptEditorTreeEntry;
	onPromptChange: PromptFlowChangeHandler;
}

export function PromptFlowInspector({
	prompt,
	model,
	selectedEntry,
	onPromptChange,
}: PromptFlowInspectorProps) {
	const diagnostics = selectedEntry
		? model.validation.diagnostics.filter(
				(diagnostic) =>
					diagnostic.nodeId === selectedEntry.id ||
					diagnostic.path?.join(".").startsWith(selectedEntry.path.join(".")),
			)
		: [];

	return (
		<aside className="flex min-h-0 flex-1 flex-col bg-card">
			<header className="flex h-10 shrink-0 items-center border-b border-border bg-muted/20 px-3">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					Details
				</span>
			</header>

			{!selectedEntry ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-5">
					<p className="max-w-52 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						Select a prompt block to inspect its structure, metadata, and validation notes.
					</p>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-auto p-3">
					<div className="flex flex-col gap-4">
						<InspectorSection title="Selected">
							<MiniField label="type" value={selectedEntry.node.type} />
							<MiniField label="path" value={selectedEntry.path.join(".")} />
							<MiniField label="position" value={`${selectedEntry.index + 1}/${selectedEntry.siblingCount}`} />
							<MiniField label="depth" value={String(selectedEntry.depth)} />
						</InspectorSection>

						<InspectorSection title="Identity">
							<NodeIdField
								entry={selectedEntry}
								prompt={prompt}
								onPromptChange={onPromptChange}
							/>
						</InspectorSection>

						<NodeDetails
							entry={selectedEntry}
							prompt={prompt}
							onPromptChange={onPromptChange}
						/>

						<InspectorSection title="Preview">
							<p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground">
								{previewText(selectedEntry.node) || "No preview content"}
							</p>
						</InspectorSection>

						<InspectorSection title="Diagnostics">
							{diagnostics.length === 0 ? (
								<p className="text-[12px] text-muted-foreground/70">No issues for this block</p>
							) : (
								<ul className="flex flex-col">
									{diagnostics.map((diagnostic, index) => (
										<li
											key={`${diagnostic.code}:${index}`}
											className={cn(
												"border-b border-border/60 py-2 text-[12px] leading-relaxed last:border-b-0",
												diagnostic.severity === "error"
													? "text-destructive"
													: "text-status-warning",
											)}
										>
											<span className="block text-[10px] font-medium uppercase tracking-[0.12em]">
												{diagnostic.code}
											</span>
											{diagnostic.message}
										</li>
									))}
								</ul>
							)}
						</InspectorSection>
					</div>
				</div>
			)}
		</aside>
	);
}

function NodeDetails({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowInspectorProps["onPromptChange"];
}) {
	const node = entry.node;

	if (node.type === "section") {
		return (
			<InspectorSection title="Section">
				<TextInput
					label="tag"
					value={node.tag}
					onChange={(tag) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section"
								? ({ ...current, tag } satisfies SectionNode)
								: current,
						)
					}
				/>
				<TextInput
					label="title"
					value={node.title ?? ""}
					onChange={(title) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section"
								? ({ ...current, title: title || undefined } satisfies SectionNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "field") {
		return (
			<InspectorSection title="Field">
				<TextInput
					label="label"
					value={node.label}
					onChange={(label) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field"
								? ({ ...current, label } satisfies FieldNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children?.length ?? 0)} />
			</InspectorSection>
		);
	}

	if (node.type === "codeBlock") {
		return (
			<InspectorSection title="Code">
				<TextInput
					label="language"
					value={node.language ?? ""}
					onChange={(language) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "codeBlock"
								? ({ ...current, language: language || undefined } satisfies CodeBlockNode)
								: current,
						)
					}
				/>
			</InspectorSection>
		);
	}

	if (node.type === "example") {
		return (
			<InspectorSection title="Example">
				<TextInput
					label="title"
					value={node.title ?? ""}
					onChange={(title) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "example"
								? ({ ...current, title: title || undefined } satisfies ExampleNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "contextUsage") {
		return (
			<InspectorSection title="Context">
				<TextInput
					label="context id"
					value={node.contextId}
					onChange={(contextId) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, contextId } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<TextInput
					label="tag"
					value={node.tag ?? ""}
					onChange={(tag) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, tag: tag || undefined } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<MiniField label="instructions" value={String(node.instructions.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "raw") {
		return (
			<InspectorSection title="Raw">
				<MiniField label="chars" value={String(node.value.length)} />
			</InspectorSection>
		);
	}

	return null;
}

function updateNode(
	prompt: PromptDocument,
	entry: PromptEditorTreeEntry,
	onPromptChange: PromptFlowInspectorProps["onPromptChange"],
	updater: (node: PromptBlockNode) => PromptBlockNode,
) {
	const result = updatePromptBlockNodeByIdWithStep(prompt, entry.id, updater);
	if (!result.step) return;
	onPromptChange(result.prompt, entry.id, [result.step]);
}

/**
 * Node-id editing commits on blur/Enter as a remove+insert step pair at the
 * same path. An update-step keyed by node id cannot invert an id change (the
 * inverse lookup would miss), while path-addressed remove/insert steps undo
 * and redo cleanly. Empty ids are rejected — editor surfaces require ids.
 */
function NodeIdField({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowInspectorProps["onPromptChange"];
}) {
	const [draftId, setDraftId] = useState(entry.node.id ?? "");

	useEffect(() => {
		setDraftId(entry.node.id ?? "");
	}, [entry.id, entry.node.id]);

	function commitRename() {
		const nextId = draftId.trim();
		if (!nextId || nextId === entry.node.id) {
			setDraftId(entry.node.id ?? "");
			return;
		}
		const steps: PromptStep[] = [
			{ op: "remove", path: entry.path, removed: entry.node },
			{ op: "insert", path: entry.path, node: { ...entry.node, id: nextId } },
		];
		onPromptChange(applySteps(prompt, steps), nextId, steps);
	}

	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
				node id
			</span>
			<input
				value={draftId}
				onChange={(event) => setDraftId(event.target.value)}
				onBlur={commitRename}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitRename();
					}
				}}
				className="h-8 rounded-[2px] border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-status-success"
				spellCheck={false}
			/>
		</label>
	);
}

function previewText(node: PromptBlockNode): string {
	switch (node.type) {
		case "section":
			return `<${node.tag}>`;
		case "paragraph":
			return inlineToEditableText(node.content);
		case "bulletList":
		case "orderedList":
			return node.items
				.slice(0, 6)
				.map((item, index) => `${node.type === "orderedList" ? `${(node.start ?? 1) + index}.` : "-"} ${inlineToEditableText(item.content)}`)
				.join("\n");
		case "field":
			return `${node.label}: ${inlineToEditableText(node.value)}`;
		case "codeBlock":
			return node.code;
		case "raw":
			return node.value;
		case "example":
			return node.title ?? "Example";
		case "contextUsage":
			return `${node.contextId}${node.tag ? ` as <${node.tag}>` : ""}`;
	}
}

function TextInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
				{label}
			</span>
			<input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-8 rounded-[2px] border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-status-success"
			/>
		</label>
	);
}

function InspectorSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section>
			<h3 className="mb-2 flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					{title}
				</span>
				<span className="h-px flex-1 bg-border" />
			</h3>
			<div className="flex flex-col gap-2">{children}</div>
		</section>
	);
}

function MiniField({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
			<span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
			<span className="max-w-[62%] break-all text-right text-[12px] tabular-nums text-foreground">{value}</span>
		</div>
	);
}
