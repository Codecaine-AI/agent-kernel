// Slice: node-id rename controller — commits as a path-addressed remove+insert
// step pair so an id change stays invertible.
"use client";

import { useEffect, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	applySteps,
	type PromptEditorTreeEntry,
	type PromptStep,
} from "@codecaine-ai/prompt-kit/ui";

import type { PromptFlowChangeHandler } from "../types";

/**
 * Node-id editing commits on blur/Enter as a remove+insert step pair at the
 * same path. An update-step keyed by node id cannot invert an id change (the
 * inverse lookup would miss), while path-addressed remove/insert steps undo
 * and redo cleanly. Empty ids are rejected — editor surfaces require ids.
 */
export function NodeIdField({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
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
