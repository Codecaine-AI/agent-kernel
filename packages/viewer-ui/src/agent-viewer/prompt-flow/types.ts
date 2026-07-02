"use client";

import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	PromptEditorModel,
	PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

export type PromptFlowMode = "sections" | "xml";

export interface PromptFlowViewProps {
	prompt: PromptDocument;
	model: PromptEditorModel;
	selectedEntry?: PromptEditorTreeEntry;
	selectedNodeId?: string;
	onSelectNode: (id: string | undefined) => void;
	onPromptChange: (prompt: PromptDocument, selectedNodeId?: string) => void;
}
