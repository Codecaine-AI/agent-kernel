// Slice: inspector composition root — the Details aside: selection summary,
// identity, per-type details, preview, and diagnostics.
"use client";

import cn from "classnames";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	PromptEditorModel,
	PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import type { PromptFlowChangeHandler } from "../types";
import { InspectorSection, MiniField, previewText } from "./fields";
import { NodeDetails } from "./NodeDetails";
import { NodeIdField } from "./NodeIdField";

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
