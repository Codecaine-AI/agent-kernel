/**
 * context-set.ts — the L2 set behind section ②.
 *
 * Section ② is REBUILT, not accumulated in the transcript. The kernel holds an
 * id → content set and renders it into ONE context message each request.
 * Adding a skill mid-run adds an entry; losing one removes it. Nothing stale
 * can linger, because nothing is pinned to history.
 */

import type { ContextImage } from "../context";
import { kernelContextMessage, type KernelMessageBlock } from "./kernel-messages";
import type { AgentMessage } from "./types";

export interface ContextEntry {
	/** Stable identity — re-adding the same id replaces the entry in place. */
	id: string;
	content: string;
	/** Optional XML tag wrapped around `content` in the rendered message. */
	label?: string;
	/** Images that ride along with this entry's text. */
	images?: ReadonlyArray<ContextImage>;
	/** Sort key; entries with equal order keep insertion order. */
	order?: number;
}

export interface ContextSet {
	add(entry: ContextEntry): void;
	remove(id: string): boolean;
	has(id: string): boolean;
	get(id: string): ContextEntry | null;
	/** Entries in render order. */
	list(): ContextEntry[];
	clear(): void;
	readonly size: number;
	/** The whole set as one context message; null when the set is empty. */
	render(): AgentMessage | null;
}

interface Slot {
	entry: ContextEntry;
	inserted: number;
}

export const CONTEXT_MESSAGE_OPEN = "<context>";
export const CONTEXT_MESSAGE_CLOSE = "</context>";

function renderEntryText(entry: ContextEntry): string {
	if (!entry.label) return entry.content;
	return `<${entry.label}>\n${entry.content}\n</${entry.label}>`;
}

export function createContextSet(initial: ContextEntry[] = []): ContextSet {
	const slots = new Map<string, Slot>();
	let counter = 0;

	function ordered(): ContextEntry[] {
		return [...slots.values()]
			.sort((a, b) => {
				const oa = a.entry.order ?? 0;
				const ob = b.entry.order ?? 0;
				if (oa !== ob) return oa - ob;
				return a.inserted - b.inserted;
			})
			.map((slot) => slot.entry);
	}

	const set: ContextSet = {
		add(entry: ContextEntry): void {
			const existing = slots.get(entry.id);
			slots.set(entry.id, {
				entry,
				inserted: existing ? existing.inserted : counter++,
			});
		},
		remove(id: string): boolean {
			return slots.delete(id);
		},
		has(id: string): boolean {
			return slots.has(id);
		},
		get(id: string): ContextEntry | null {
			return slots.get(id)?.entry ?? null;
		},
		list(): ContextEntry[] {
			return ordered();
		},
		clear(): void {
			slots.clear();
		},
		get size(): number {
			return slots.size;
		},
		render(): AgentMessage | null {
			const entries = ordered();
			if (entries.length === 0) return null;
			const text = [
				CONTEXT_MESSAGE_OPEN,
				...entries.map(renderEntryText),
				CONTEXT_MESSAGE_CLOSE,
			].join("\n");
			const content: KernelMessageBlock[] = [{ type: "text", text }];
			for (const entry of entries) {
				for (const image of entry.images ?? []) {
					content.push({
						type: "image",
						data: image.data,
						mimeType: image.mimeType,
					});
				}
			}
			return kernelContextMessage(content);
		},
	};

	for (const entry of initial) set.add(entry);
	return set;
}
