import { canonicalizePrompt, type PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	createTransactionLog,
	type PromptStep,
	type PromptTransaction,
	type PromptTransactionLog,
} from "@codecaine-ai/prompt-kit/ui";

/**
 * Undoable edit history for the prompt lab, built on prompt-kit's
 * createTransactionLog.
 *
 * Two edit channels share one undo/redo stack:
 * - Block edits arrive as PromptStep[] (produced by the *WithStep editor
 *   wrappers) and are committed to the inner transaction log.
 * - Document-metadata edits (title/description — not representable as
 *   PromptSteps, which are node-scoped) are kept in an overlay with their
 *   own before/after entries.
 *
 * The unified stack interleaves both kinds; step entries delegate to the
 * inner log's undo/redo (both stacks are LIFO, so the relative order of step
 * entries always matches), metadata entries restore the overlay.
 *
 * Save boundaries: `markSaved()` only moves the dirty baseline — the log and
 * the unified stack are untouched, so undo keeps working across a save (and
 * undoing past the save point makes the draft dirty again). This is the
 * "keep the old log, track the saved state separately" option: the committed
 * transaction API has no rebase, and it does not need one for this.
 *
 * Hashing: the inner log's content hash is overridden with a cheap local
 * FNV-1a over the canonical serialization ("local-..." prefix), so the
 * browser never calls the node:crypto-backed hashPrompt. These local hashes
 * only provide transaction lineage; server hashes come from the save API.
 */
export interface PromptLabMetaPatch {
	title?: string;
	description?: string;
}

export interface PromptLabHistory {
	/** Current document: inner log document with the metadata overlay applied. */
	current(): PromptDocument;
	/** Commits block-edit steps; returns false for an empty/no-op commit. */
	commitSteps(steps: readonly PromptStep[]): boolean;
	/** Commits a title/description change; returns false when nothing changed. */
	commitMeta(patch: PromptLabMetaPatch): boolean;
	undo(): boolean;
	redo(): boolean;
	canUndo(): boolean;
	canRedo(): boolean;
	/** True when the current document differs from the saved baseline. */
	isDirty(): boolean;
	/** Moves the dirty baseline to the current document; history survives. */
	markSaved(): void;
	/** Committed step transactions from the inner log, oldest first. */
	transactions(): PromptTransaction[];
}

type HistoryEntry =
	| { kind: "steps" }
	| { kind: "meta"; before: PromptLabMetaPatch; after: PromptLabMetaPatch };

export function createPromptLabHistory(
	baseDoc: PromptDocument,
): PromptLabHistory {
	const log: PromptTransactionLog = createTransactionLog(baseDoc, {
		hash: localPromptHash,
	});
	let meta: PromptLabMetaPatch = {
		title: baseDoc.title,
		description: baseDoc.description,
	};
	const undoStack: HistoryEntry[] = [];
	const redoStack: HistoryEntry[] = [];

	const current = () => applyMeta(log.current(), meta);
	let savedCanonical = canonicalizePrompt(current());

	return {
		current,
		commitSteps(steps) {
			const transaction = log.commit([...steps]);
			if (!transaction) return false;
			undoStack.push({ kind: "steps" });
			redoStack.length = 0;
			return true;
		},
		commitMeta(patch) {
			const after: PromptLabMetaPatch = { ...meta, ...patch };
			if (metaEquals(meta, after)) return false;
			undoStack.push({ kind: "meta", before: meta, after });
			redoStack.length = 0;
			meta = after;
			return true;
		},
		undo() {
			const entry = undoStack.pop();
			if (!entry) return false;
			if (entry.kind === "steps") log.undo();
			else meta = entry.before;
			redoStack.push(entry);
			return true;
		},
		redo() {
			const entry = redoStack.pop();
			if (!entry) return false;
			if (entry.kind === "steps") log.redo();
			else meta = entry.after;
			undoStack.push(entry);
			return true;
		},
		canUndo() {
			return undoStack.length > 0;
		},
		canRedo() {
			return redoStack.length > 0;
		},
		isDirty() {
			return canonicalizePrompt(current()) !== savedCanonical;
		},
		markSaved() {
			savedCanonical = canonicalizePrompt(current());
		},
		transactions() {
			return log.history();
		},
	};
}

function applyMeta(
	doc: PromptDocument,
	meta: PromptLabMetaPatch,
): PromptDocument {
	const next = { ...doc } as PromptDocument & Record<string, unknown>;
	if (meta.title === undefined) delete next.title;
	else next.title = meta.title;
	if (meta.description === undefined) delete next.description;
	else next.description = meta.description;
	return next;
}

function metaEquals(a: PromptLabMetaPatch, b: PromptLabMetaPatch): boolean {
	return a.title === b.title && a.description === b.description;
}

/** Cheap synchronous content hash for browser hosts (transaction lineage only). */
function localPromptHash(doc: PromptDocument): string {
	const text = canonicalizePrompt(doc);
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
