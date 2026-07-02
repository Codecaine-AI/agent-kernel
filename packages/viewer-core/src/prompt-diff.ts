import type { PromptBlockNode, PromptDocument } from "@codecaine-ai/prompt-kit";

/**
 * Structural block-level diff between two PromptDocuments, keyed by stable
 * node id (no text diffing). Pure data, browser-safe.
 *
 * Classification:
 * - "inserted": id exists in `b` but not in `a`
 * - "removed":  id exists in `a` but not in `b`
 * - "moved":    same id in both, but a different parent, or a different
 *   position relative to the siblings the two documents have in common
 *   (so inserting/removing a sibling does not cascade "moved" onto every
 *   node below it)
 * - "edited":   same id in both, different canonical content — compared via
 *   stable JSON of the node minus its child-block collections
 *
 * A node that both moved and changed content yields two entries (one
 * "moved", one "edited").
 */
export type PromptBlockDiffKind = "inserted" | "removed" | "moved" | "edited";

export interface PromptBlockDiffEntry {
	kind: PromptBlockDiffKind;
	/** Stable node id shared across revisions. */
	id: string;
	nodeType: string;
	/** Short display label (tag, field label, ...). */
	label: string;
	/** Dotted path in document `a` (absent for "inserted"). */
	pathInA?: string;
	/** Dotted path in document `b` (absent for "removed"). */
	pathInB?: string;
}

interface WalkedNode {
	id: string;
	node: PromptBlockNode;
	/** Id of the parent block, or "" for document root. */
	parentId: string;
	/** Index among walked (id-bearing) siblings. */
	index: number;
	path: string;
	/** Document order. */
	order: number;
}

export function diffPromptDocuments(
	a: PromptDocument,
	b: PromptDocument,
): PromptBlockDiffEntry[] {
	const mapA = walkDocument(a);
	const mapB = walkDocument(b);
	const entries: PromptBlockDiffEntry[] = [];

	const movedIds = collectMovedIds(mapA, mapB);

	for (const entryB of inDocumentOrder(mapB)) {
		const entryA = mapA.get(entryB.id);
		if (!entryA) {
			entries.push(makeEntry("inserted", entryB, undefined, entryB.path));
			continue;
		}
		if (movedIds.has(entryB.id)) {
			entries.push(makeEntry("moved", entryB, entryA.path, entryB.path));
		}
		if (contentKey(entryA.node) !== contentKey(entryB.node)) {
			entries.push(makeEntry("edited", entryB, entryA.path, entryB.path));
		}
	}

	for (const entryA of inDocumentOrder(mapA)) {
		if (!mapB.has(entryA.id)) {
			entries.push(makeEntry("removed", entryA, entryA.path, undefined));
		}
	}

	return entries;
}

function makeEntry(
	kind: PromptBlockDiffKind,
	walked: WalkedNode,
	pathInA: string | undefined,
	pathInB: string | undefined,
): PromptBlockDiffEntry {
	return {
		kind,
		id: walked.id,
		nodeType: walked.node.type,
		label: labelForBlock(walked.node),
		...(pathInA !== undefined ? { pathInA } : {}),
		...(pathInB !== undefined ? { pathInB } : {}),
	};
}

function collectMovedIds(
	mapA: Map<string, WalkedNode>,
	mapB: Map<string, WalkedNode>,
): Set<string> {
	const moved = new Set<string>();
	// Parent changes are always moves.
	for (const [id, entryB] of mapB) {
		const entryA = mapA.get(id);
		if (entryA && entryA.parentId !== entryB.parentId) moved.add(id);
	}
	// Within each parent, compare the order of the siblings common to both
	// documents (and still under the same parent). Ids whose position in the
	// common sequence changed are moves; pure inserts/removals shift nothing.
	const parents = new Set<string>();
	for (const entry of mapA.values()) parents.add(entry.parentId);
	for (const parentId of parents) {
		const isCommon = (id: string) =>
			mapA.get(id)?.parentId === parentId && mapB.get(id)?.parentId === parentId;
		const seqA = siblingsOf(mapA, parentId).filter(isCommon);
		const seqB = siblingsOf(mapB, parentId).filter(isCommon);
		seqA.forEach((id, index) => {
			if (seqB[index] !== id) moved.add(id);
		});
	}
	return moved;
}

function siblingsOf(map: Map<string, WalkedNode>, parentId: string): string[] {
	return inDocumentOrder(map)
		.filter((entry) => entry.parentId === parentId)
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.id);
}

function inDocumentOrder(map: Map<string, WalkedNode>): WalkedNode[] {
	return [...map.values()].sort((left, right) => left.order - right.order);
}

function walkDocument(doc: PromptDocument): Map<string, WalkedNode> {
	const map = new Map<string, WalkedNode>();
	const counter = { order: 0 };
	walkBlocks(doc.nodes, "", "nodes", map, counter);
	return map;
}

function walkBlocks(
	nodes: readonly PromptBlockNode[],
	parentId: string,
	pathPrefix: string,
	map: Map<string, WalkedNode>,
	counter: { order: number },
): void {
	let walkedIndex = 0;
	nodes.forEach((node, rawIndex) => {
		// Nodes without a stable id cannot be tracked across revisions; skip
		// them (matches the editor tree, which requires ids to render).
		if (!node.id) return;
		const path = `${pathPrefix}.${rawIndex}`;
		map.set(node.id, {
			id: node.id,
			node,
			parentId,
			index: walkedIndex,
			path,
			order: counter.order,
		});
		counter.order += 1;
		walkedIndex += 1;

		for (const [key, children] of childCollections(node)) {
			walkBlocks(children, node.id, `${path}.${key}`, map, counter);
		}
	});
}

/**
 * Child-block collections the diff recurses into. List items stay part of
 * their list node's content (editing an item shows the list as "edited"),
 * matching the editor tree's granularity.
 */
function childCollections(
	node: PromptBlockNode,
): Array<[string, readonly PromptBlockNode[]]> {
	switch (node.type) {
		case "section":
		case "example":
			return [["children", node.children]];
		case "field":
			return node.children ? [["children", node.children]] : [];
		case "contextUsage":
			return [["instructions", node.instructions]];
		default:
			return [];
	}
}

/** Stable JSON of the node minus its recursed-into child collections. */
function contentKey(node: PromptBlockNode): string {
	const record = node as unknown as Record<string, unknown>;
	const stripped: Record<string, unknown> = {};
	const childKeys = new Set(childCollections(node).map(([key]) => key));
	for (const key of Object.keys(record)) {
		if (childKeys.has(key)) continue;
		if (record[key] === undefined) continue;
		stripped[key] = record[key];
	}
	return stableStringify(stripped);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const parts = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
	return `{${parts.join(",")}}`;
}

function labelForBlock(node: PromptBlockNode): string {
	switch (node.type) {
		case "section":
			return `<${node.tag}>`;
		case "paragraph":
			return "Paragraph";
		case "bulletList":
			return "Bullet list";
		case "orderedList":
			return "Ordered list";
		case "field":
			return node.label;
		case "codeBlock":
			return node.language ? `Code: ${node.language}` : "Code block";
		case "example":
			return node.title ? `Example: ${node.title}` : "Example";
		case "raw":
			return "Raw";
		case "contextUsage":
			return `Context: ${node.contextId || "unnamed"}`;
	}
}
